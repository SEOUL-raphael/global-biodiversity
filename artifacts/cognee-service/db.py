import os
import json
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL", "")


def get_connection():
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def _rows_to_list(rows) -> list[dict]:
    result = []
    for row in rows:
        d = dict(row)
        for k, v in d.items():
            if isinstance(v, memoryview):
                d[k] = bytes(v).decode("utf-8")
        result.append(d)
    return result


def get_stats() -> dict:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS cnt FROM gbif_kg_nodes")
                node_count = int(cur.fetchone()["cnt"])
                cur.execute("SELECT COUNT(*) AS cnt FROM gbif_kg_edges")
                edge_count = int(cur.fetchone()["cnt"])
                cur.execute("SELECT COUNT(*) AS cnt FROM gbif_taxa")
                taxa_count = int(cur.fetchone()["cnt"])
                cur.execute("SELECT COUNT(*) AS cnt FROM gbif_occurrences")
                occ_count = int(cur.fetchone()["cnt"])
                cur.execute("SELECT COUNT(*) AS cnt FROM gbif_regions")
                region_count = int(cur.fetchone()["cnt"])
        return {
            "nodeCount": node_count,
            "edgeCount": edge_count,
            "taxaCount": taxa_count,
            "occurrenceCount": occ_count,
            "regionCount": region_count,
            "graphLoaded": node_count > 0,
        }
    except Exception as e:
        return {
            "error": str(e),
            "graphLoaded": False,
            "nodeCount": 0,
            "edgeCount": 0,
            "taxaCount": 0,
            "occurrenceCount": 0,
            "regionCount": 0,
        }


def search_taxa(q: str, limit: int = 20) -> list[dict]:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT taxon_key, scientific_name, canonical_name, rank, kingdom,
                           iucn_status, num_occurrences, extinct
                    FROM gbif_taxa
                    WHERE canonical_name ILIKE %s OR scientific_name ILIKE %s
                    ORDER BY num_occurrences DESC NULLS LAST
                    LIMIT %s
                    """,
                    (f"%{q}%", f"%{q}%", limit),
                )
                rows = cur.fetchall()
        return _rows_to_list(rows)
    except Exception:
        return []


def get_kg_context(taxon_key: int, hops: int = 2) -> dict:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT node_id, node_type, external_id, label, properties FROM gbif_kg_nodes WHERE external_id = %s",
                    (f"TAXON:{taxon_key}",),
                )
                root = cur.fetchone()
                if not root:
                    return {"found": False, "taxonKey": taxon_key}

                cur.execute(
                    """
                    WITH RECURSIVE traversal AS (
                        SELECT node_id, node_type, external_id, label, properties, 0 AS depth
                        FROM gbif_kg_nodes WHERE node_id = %s
                        UNION ALL
                        SELECT n.node_id, n.node_type, n.external_id, n.label, n.properties, t.depth + 1
                        FROM traversal t
                        JOIN gbif_kg_edges e ON (e.from_node = t.node_id OR e.to_node = t.node_id)
                        JOIN gbif_kg_nodes n ON n.node_id = CASE
                            WHEN e.from_node = t.node_id THEN e.to_node
                            ELSE e.from_node
                        END
                        WHERE t.depth < %s AND n.node_id != t.node_id
                    )
                    SELECT DISTINCT ON (node_id) node_id, node_type, external_id, label, MIN(depth) AS depth
                    FROM traversal
                    GROUP BY node_id, node_type, external_id, label
                    ORDER BY node_id, depth
                    LIMIT 100
                    """,
                    (root["node_id"], hops),
                )
                nodes = _rows_to_list(cur.fetchall())

                node_ids = [n["node_id"] for n in nodes]
                edges: list[dict] = []
                if len(node_ids) > 1:
                    cur.execute(
                        """
                        SELECT edge_id, from_node, to_node, edge_type, weight
                        FROM gbif_kg_edges
                        WHERE from_node = ANY(%s) AND to_node = ANY(%s)
                        """,
                        (node_ids, node_ids),
                    )
                    edges = _rows_to_list(cur.fetchall())

                return {
                    "found": True,
                    "taxonKey": taxon_key,
                    "rootLabel": root["label"],
                    "hops": hops,
                    "nodeCount": len(nodes),
                    "edgeCount": len(edges),
                    "nodes": nodes,
                    "edges": edges,
                }
    except Exception as e:
        return {"found": False, "taxonKey": taxon_key, "error": str(e)}


def get_endangered_hotspots(limit: int = 10) -> list[dict]:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        n_region.external_id AS country_code,
                        n_region.label AS region_label,
                        COUNT(DISTINCT n_taxon.node_id) AS endangered_count
                    FROM gbif_kg_nodes n_region
                    JOIN gbif_kg_edges e_inhabits ON e_inhabits.from_node = n_region.node_id
                        AND e_inhabits.edge_type = 'INHABITS'
                    JOIN gbif_kg_nodes n_taxon ON n_taxon.node_id = e_inhabits.to_node
                        AND n_taxon.node_type = 'TAXON'
                    JOIN gbif_taxa t ON CAST(n_taxon.properties->>'taxonKey' AS integer) = t.taxon_key
                    WHERE n_region.node_type = 'REGION'
                        AND t.iucn_status IN ('CR', 'EN', 'VU', 'EW', 'EX')
                    GROUP BY n_region.node_id, n_region.external_id, n_region.label
                    ORDER BY endangered_count DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = cur.fetchall()
        result = []
        for row in rows:
            d = dict(row)
            d["countryCode"] = d.pop("country_code", "").replace("REGION:", "")
            d["regionLabel"] = d.pop("region_label", "")
            d["endangeredCount"] = int(d.pop("endangered_count", 0))
            result.append(d)
        return result
    except Exception:
        return []


def get_cooccurrence(country_code: str | None, min_jaccard: float, limit: int) -> list[dict]:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                if country_code:
                    cur.execute(
                        """
                        SELECT
                            CAST(na.properties->>'taxonKey' AS bigint) AS taxon_key_a,
                            na.label AS label_a,
                            CAST(nb.properties->>'taxonKey' AS bigint) AS taxon_key_b,
                            nb.label AS label_b,
                            e.weight AS jaccard_similarity,
                            COALESCE(e.properties->>'shared_regions', '[]') AS shared_regions
                        FROM gbif_kg_edges e
                        JOIN gbif_kg_nodes na ON na.node_id = e.from_node AND na.node_type = 'TAXON'
                        JOIN gbif_kg_nodes nb ON nb.node_id = e.to_node AND nb.node_type = 'TAXON'
                        WHERE e.edge_type = 'CO_OCCURS_WITH'
                            AND e.weight >= %s
                            AND e.properties->'shared_regions' @> %s::jsonb
                        ORDER BY e.weight DESC
                        LIMIT %s
                        """,
                        (min_jaccard, json.dumps([country_code.upper()]), limit),
                    )
                else:
                    cur.execute(
                        """
                        SELECT
                            CAST(na.properties->>'taxonKey' AS bigint) AS taxon_key_a,
                            na.label AS label_a,
                            CAST(nb.properties->>'taxonKey' AS bigint) AS taxon_key_b,
                            nb.label AS label_b,
                            e.weight AS jaccard_similarity,
                            COALESCE(e.properties->>'shared_regions', '[]') AS shared_regions
                        FROM gbif_kg_edges e
                        JOIN gbif_kg_nodes na ON na.node_id = e.from_node AND na.node_type = 'TAXON'
                        JOIN gbif_kg_nodes nb ON nb.node_id = e.to_node AND nb.node_type = 'TAXON'
                        WHERE e.edge_type = 'CO_OCCURS_WITH' AND e.weight >= %s
                        ORDER BY e.weight DESC
                        LIMIT %s
                        """,
                        (min_jaccard, limit),
                    )
                rows = cur.fetchall()

        result = []
        for row in rows:
            d = dict(row)
            try:
                d["shared_regions"] = json.loads(d.get("shared_regions") or "[]")
            except Exception:
                d["shared_regions"] = []
            result.append(d)
        return result
    except Exception:
        return []


def get_taxonomy_gaps(limit: int = 20) -> list[dict]:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    WITH family_stats AS (
                        SELECT p.taxon_key, COALESCE(p.canonical_name, p.scientific_name) AS label,
                               p.kingdom, COUNT(c.taxon_key) AS total_species,
                               COALESCE(SUM(c.num_occurrences), 0) AS occurrence_count
                        FROM gbif_taxa p
                        JOIN gbif_taxa c ON c.parent_key = p.taxon_key AND c.rank = 'SPECIES'
                        WHERE p.rank = 'FAMILY'
                        GROUP BY p.taxon_key, p.canonical_name, p.scientific_name, p.kingdom
                        HAVING COUNT(c.taxon_key) > 0
                    ),
                    order_stats AS (
                        SELECT o.taxon_key, COALESCE(o.canonical_name, o.scientific_name) AS label,
                               o.kingdom, SUM(f.total_species) AS total_species,
                               SUM(f.occurrence_count) AS occurrence_count
                        FROM gbif_taxa o
                        JOIN gbif_taxa fam ON fam.parent_key = o.taxon_key AND fam.rank = 'FAMILY'
                        JOIN family_stats f ON f.taxon_key = fam.taxon_key
                        WHERE o.rank = 'ORDER'
                        GROUP BY o.taxon_key, o.canonical_name, o.scientific_name, o.kingdom
                        HAVING SUM(f.total_species) > 0
                    ),
                    combined AS (
                        SELECT 'FAMILY' AS rank, taxon_key, label, kingdom, total_species, occurrence_count FROM family_stats
                        UNION ALL
                        SELECT 'ORDER' AS rank, taxon_key, label, kingdom, total_species, occurrence_count FROM order_stats
                    )
                    SELECT rank, taxon_key, label, kingdom,
                           total_species::integer,
                           occurrence_count::integer,
                           ROUND((occurrence_count::numeric / NULLIF(total_species,0)), 2)::float AS occ_per_species
                    FROM combined
                    ORDER BY occ_per_species ASC, total_species DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = cur.fetchall()
        return _rows_to_list(rows)
    except Exception:
        return []
