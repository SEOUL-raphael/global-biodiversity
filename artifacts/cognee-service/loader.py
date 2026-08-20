"""
GBIF taxa loader that ingests data into Cognee's knowledge graph
using cognee.tasks.storage.add_data_points() with LanceDB + Kuzu backends.
No LLM required — structured data is inserted directly.
"""
import os
import asyncio
import logging
import urllib.request
import urllib.error
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from uuid import UUID

import psycopg2
import psycopg2.extras

from cognee.tasks.storage import add_data_points
from models import GBIFTaxon, TaxonomicRankNode

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "")
TAXA_LIMIT = int(os.environ.get("COGNEE_TAXA_LIMIT", "15000"))
GBIF_API_BASE = "https://api.gbif.org/v1"
DP_BATCH_SIZE = 200

# IUCN/distribution enrichment from GBIF per-species endpoints.
# These add ~2 extra HTTP calls per taxon, so we cap and use concurrency.
IUCN_ENRICH_LIMIT = int(os.environ.get("COGNEE_IUCN_ENRICH_LIMIT", "8000"))
IUCN_ENRICH_CONCURRENCY = int(os.environ.get("COGNEE_IUCN_ENRICH_CONCURRENCY", "16"))
IUCN_HTTP_TIMEOUT = int(os.environ.get("COGNEE_IUCN_HTTP_TIMEOUT", "10"))


_IUCN_CATEGORY_TO_CODE = {
    "CRITICALLY_ENDANGERED": "CR",
    "ENDANGERED": "EN",
    "VULNERABLE": "VU",
    "NEAR_THREATENED": "NT",
    "LEAST_CONCERN": "LC",
    "EXTINCT": "EX",
    "EXTINCT_IN_THE_WILD": "EW",
    "DATA_DEFICIENT": "DD",
    "NOT_EVALUATED": "NE",
}


_IUCN_LABELS = {
    "CR": "Critically Endangered",
    "EN": "Endangered",
    "VU": "Vulnerable",
    "NT": "Near Threatened",
    "LC": "Least Concern",
    "EX": "Extinct",
    "EW": "Extinct in the Wild",
    "DD": "Data Deficient",
}


def _make_description(td: dict) -> str:
    """Build a rich text description for semantic embedding."""
    parts = []
    name = td.get("canonical_name") or td.get("scientific_name", "Unknown")
    rank = (td.get("rank") or "taxon").lower()
    parts.append(f"{name} is a {rank}")

    for field in ["kingdom", "phylum", "class", "order", "family", "genus"]:
        val = td.get(field)
        if val:
            parts.append(f"{field} {val}")

    if td.get("vernacular_name"):
        parts.append(f"common name {td['vernacular_name']}")

    if td.get("iucn_status"):
        label = _IUCN_LABELS.get(td["iucn_status"], td["iucn_status"])
        parts.append(f"IUCN status {label}")

    geo = td.get("geographic_range") or []
    if geo:
        parts.append(f"found in {', '.join(geo[:8])}")

    if td.get("scientific_name") and td.get("scientific_name") != name:
        parts.append(f"scientific name {td['scientific_name']}")

    if td.get("num_occurrences"):
        parts.append(f"GBIF occurrences {td['num_occurrences']}")

    return ". ".join(parts) + "."


def _gbif_get_json(path: str, timeout: int = IUCN_HTTP_TIMEOUT) -> Optional[dict]:
    url = f"{GBIF_API_BASE}{path}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CogneeKGService/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        return None
    except Exception:
        return None


def _fetch_iucn_status(taxon_key: int) -> Optional[str]:
    data = _gbif_get_json(f"/species/{taxon_key}/iucnRedListCategory")
    if not data:
        return None
    code = data.get("code")
    if code:
        return code
    return _IUCN_CATEGORY_TO_CODE.get(data.get("category", ""))


def _fetch_distributions(taxon_key: int, max_localities: int = 12) -> List[str]:
    data = _gbif_get_json(f"/species/{taxon_key}/distributions?limit=50")
    if not data:
        return []
    localities: List[str] = []
    seen = set()
    for r in data.get("results", []):
        loc = r.get("locality") or r.get("country") or r.get("locationId")
        if not loc or not isinstance(loc, str):
            continue
        loc = loc.strip()
        if not loc or loc in seen:
            continue
        seen.add(loc)
        localities.append(loc)
        if len(localities) >= max_localities:
            break
    return localities


def _enrich_one(taxon_key: int, need_iucn: bool, need_geo: bool) -> Tuple[int, Optional[str], List[str]]:
    iucn = _fetch_iucn_status(taxon_key) if need_iucn else None
    geo = _fetch_distributions(taxon_key) if need_geo else []
    return taxon_key, iucn, geo


class GbifCogneeLoader:
    """
    Loads GBIF taxa into Cognee's knowledge graph.
    Uses cognee.tasks.storage.add_data_points() to write structured
    DataPoint instances directly into Kuzu (graph) and LanceDB (vector).
    """

    def __init__(self, snapshot_path: Optional[str] = None):
        self.taxa_loaded: int = 0
        self.node_count: int = 0
        self.edge_count: int = 0
        self.taxa_by_key: Dict[int, GBIFTaxon] = {}
        self.rank_nodes: Dict[str, TaxonomicRankNode] = {}
        self.uuid_to_taxon: Dict[str, GBIFTaxon] = {}
        self.uuid_to_rank_node: Dict[str, TaxonomicRankNode] = {}
        self.snapshot_path: Optional[Path] = (
            Path(snapshot_path) if snapshot_path else None
        )

    async def _fetch_taxa(self) -> List[dict]:
        db_count = await asyncio.get_event_loop().run_in_executor(
            None, self._get_db_taxa_count
        )
        if db_count >= 100:
            logger.info("Loading %d taxa from PostgreSQL", db_count)
            return await asyncio.get_event_loop().run_in_executor(
                None, self._fetch_taxa_from_db
            )
        logger.info("DB has %d taxa — falling back to GBIF public API", db_count)
        return await asyncio.get_event_loop().run_in_executor(
            None, self._fetch_taxa_from_api
        )

    async def load_all(self):
        await asyncio.sleep(3)
        logger.info("Starting GBIF → Cognee ingestion pipeline")
        try:
            taxa_list = await self._fetch_taxa()
            await asyncio.get_event_loop().run_in_executor(
                None, self._enrich_with_iucn_and_distributions, taxa_list
            )
            await self._ingest_to_cognee(taxa_list)
            self._write_snapshot(taxa_list)
            logger.info(
                "Cognee ingestion complete: %d taxa, %d total nodes, %d edges",
                self.taxa_loaded,
                self.node_count,
                self.edge_count,
            )
        except Exception as exc:
            logger.error("GBIF Cognee load failed: %s", exc, exc_info=True)
            raise

    async def warm_load(self):
        """
        Restore in-memory caches from a persisted snapshot file written at the
        end of the last successful ingestion. No DB or GBIF API access is
        performed. Raises if the snapshot is missing or unreadable; the caller
        should treat that as "needs full /reload?force=true".
        """
        if not self.snapshot_path or not self.snapshot_path.exists():
            raise RuntimeError(
                f"Cannot warm-start: snapshot missing at {self.snapshot_path}. "
                "Call POST /reload?force=true to rebuild the graph."
            )
        logger.info("Warm start: loading snapshot %s", self.snapshot_path)
        try:
            data = await asyncio.get_event_loop().run_in_executor(
                None, self._read_snapshot
            )
            self._build_in_memory_caches(data["taxa"])
            logger.info(
                "Warm start complete (no DB/API fetch): %d taxa, %d rank nodes, %d edges",
                self.taxa_loaded,
                len(self.rank_nodes),
                self.edge_count,
            )
        except Exception as exc:
            logger.error("Cognee warm load failed: %s", exc, exc_info=True)
            raise

    def _read_snapshot(self) -> dict:
        with self.snapshot_path.open("r", encoding="utf-8") as f:
            return json.load(f)

    def _write_snapshot(self, taxa_list: List[dict]) -> None:
        if not self.snapshot_path:
            return
        self.snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.snapshot_path.with_suffix(self.snapshot_path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump({"version": 1, "taxa": taxa_list}, f)
        tmp.replace(self.snapshot_path)
        logger.info(
            "Wrote warm-start snapshot (%d taxa) to %s",
            len(taxa_list),
            self.snapshot_path,
        )

    def _build_in_memory_caches(self, taxa_list: List[dict]):
        """Recreate DataPoint instances and edge counts without writing to Cognee."""
        rank_node_map: Dict[str, TaxonomicRankNode] = {}
        for td in taxa_list:
            for rank in ["kingdom", "phylum", "class", "order", "family", "genus"]:
                val = td.get(rank)
                if not val:
                    continue
                rank_id = f"{rank}:{val}"
                if rank_id not in rank_node_map:
                    rank_node_map[rank_id] = TaxonomicRankNode(
                        rank_id=rank_id,
                        rank=rank,
                        name=val,
                        description=f"{val} is a {rank} in the taxonomic hierarchy",
                    )
        self.rank_nodes = rank_node_map
        self.uuid_to_rank_node = {str(n.id): n for n in rank_node_map.values()}

        total_edges = 0
        for td in taxa_list:
            key = td["taxon_key"]
            canonical = td.get("canonical_name") or td.get("scientific_name") or "Unknown"
            taxon = GBIFTaxon(
                taxon_id=str(key),
                taxon_key=key,
                canonical_name=canonical,
                scientific_name=td.get("scientific_name") or "",
                rank=td.get("rank") or "SPECIES",
                kingdom=td.get("kingdom"),
                phylum=td.get("phylum"),
                class_name=td.get("class"),
                order=td.get("order"),
                family=td.get("family"),
                genus=td.get("genus"),
                vernacular_name=td.get("vernacular_name"),
                iucn_status=td.get("iucn_status"),
                geographic_range=list(td.get("geographic_range") or []),
                num_occurrences=int(td.get("num_occurrences") or 0),
                description=_make_description(td),
            )
            self.taxa_by_key[key] = taxon
            self.uuid_to_taxon[str(taxon.id)] = taxon
            self.taxa_loaded += 1
            for rank in ["kingdom", "phylum", "class", "order", "family", "genus"]:
                if td.get(rank):
                    total_edges += 1

        self.node_count = len(self.rank_nodes) + self.taxa_loaded
        self.edge_count = total_edges

    def _enrich_with_iucn_and_distributions(self, taxa_list: List[dict]) -> None:
        """
        For taxa missing iucn_status or geographic_range, call GBIF's per-species
        endpoints concurrently to enrich them. Capped by IUCN_ENRICH_LIMIT to keep
        startup time bounded.
        """
        if not taxa_list:
            return

        candidates = []
        for td in taxa_list:
            need_iucn = not td.get("iucn_status")
            need_geo = not td.get("geographic_range")
            if not (need_iucn or need_geo):
                continue
            key = td.get("taxon_key")
            if not key:
                continue
            candidates.append((td, int(key), need_iucn, need_geo))
            if len(candidates) >= IUCN_ENRICH_LIMIT:
                break

        if not candidates:
            logger.info("IUCN/distribution enrichment skipped (all taxa already enriched)")
            return

        logger.info(
            "Enriching %d taxa with IUCN status and geographic range from GBIF (concurrency=%d)...",
            len(candidates), IUCN_ENRICH_CONCURRENCY,
        )

        td_by_key = {key: td for (td, key, _ni, _ng) in candidates}
        iucn_hits = 0
        geo_hits = 0
        done = 0

        with ThreadPoolExecutor(max_workers=IUCN_ENRICH_CONCURRENCY) as ex:
            futs = [
                ex.submit(_enrich_one, key, ni, ng)
                for (_td, key, ni, ng) in candidates
            ]
            for fut in as_completed(futs):
                try:
                    key, iucn, geo = fut.result()
                except Exception:
                    continue
                td = td_by_key.get(key)
                if td is None:
                    continue
                if iucn:
                    td["iucn_status"] = iucn
                    iucn_hits += 1
                if geo:
                    td["geographic_range"] = geo
                    geo_hits += 1
                done += 1
                if done % 250 == 0:
                    logger.info(
                        "IUCN/distribution enrichment: %d/%d (iucn=%d, geo=%d)",
                        done, len(candidates), iucn_hits, geo_hits,
                    )

        logger.info(
            "IUCN/distribution enrichment complete: %d taxa enriched (iucn=%d, geo=%d)",
            done, iucn_hits, geo_hits,
        )

    def _get_db_taxa_count(self) -> int:
        if not DATABASE_URL:
            return 0
        try:
            conn = psycopg2.connect(DATABASE_URL)
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM gbif_taxa")
            count = cur.fetchone()[0]
            conn.close()
            return count
        except Exception:
            return 0

    def _fetch_taxa_from_db(self) -> List[dict]:
        conn = psycopg2.connect(DATABASE_URL)
        try:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                """
                SELECT taxon_key, rank, kingdom, phylum, class, "order",
                       family, genus, scientific_name, canonical_name,
                       vernacular_name, iucn_status, num_occurrences
                FROM gbif_taxa
                ORDER BY taxon_key
                LIMIT %s
                """,
                (TAXA_LIMIT,),
            )
            rows = cur.fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def _fetch_taxa_from_api(self) -> List[dict]:
        kingdoms = [
            "Animalia", "Plantae", "Fungi", "Bacteria",
            "Archaea", "Chromista", "Protozoa",
        ]
        taxa: List[dict] = []
        target = 12000

        for kingdom in kingdoms:
            if len(taxa) >= target:
                break
            offset = 0
            while len(taxa) < target:
                url = (
                    f"{GBIF_API_BASE}/species?kingdom={kingdom}"
                    f"&rank=SPECIES&limit=100&offset={offset}"
                )
                try:
                    req = urllib.request.Request(
                        url, headers={"User-Agent": "CogneeKGService/1.0"}
                    )
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        data = json.loads(resp.read())
                except Exception as e:
                    logger.warning("GBIF API error for %s offset %d: %s", kingdom, offset, e)
                    break

                results = data.get("results", [])
                if not results:
                    break

                for sp in results:
                    key = sp.get("key") or sp.get("nubKey")
                    if not key:
                        continue
                    taxa.append(
                        {
                            "taxon_key": key,
                            "rank": sp.get("rank", "SPECIES"),
                            "kingdom": sp.get("kingdom"),
                            "phylum": sp.get("phylum"),
                            "class": sp.get("class"),
                            "order": sp.get("order"),
                            "family": sp.get("family"),
                            "genus": sp.get("genus"),
                            "scientific_name": sp.get("scientificName", ""),
                            "canonical_name": sp.get("canonicalName"),
                            "vernacular_name": None,
                            "iucn_status": None,
                            "num_occurrences": sp.get("numDescendants", 0),
                        }
                    )

                if len(taxa) % 1000 < 100:
                    logger.info("GBIF API: fetched %d taxa so far...", len(taxa))

                if data.get("endOfRecords", True):
                    break
                offset += 100

        logger.info("GBIF API fetch complete: %d taxa", len(taxa))
        return taxa

    async def _ingest_to_cognee(self, taxa_list: List[dict]):
        """
        Write GBIF taxa into Cognee's infrastructure via add_data_points().
        This uses:
          - cognee.tasks.storage.add_data_points()  (the Cognee ingestion API)
          - LanceDB for vector storage (FastEmbed embeddings of description field)
          - Kuzu for graph storage (nodes + taxonomic edges)
        No LLM is involved — structured DataPoints are inserted directly.
        """
        logger.info("Ingesting %d taxa into Cognee (Kuzu graph + LanceDB vectors)...", len(taxa_list))

        # --- Step 1: Build unique rank nodes ---
        rank_node_map: Dict[str, TaxonomicRankNode] = {}
        for td in taxa_list:
            for rank in ["kingdom", "phylum", "class", "order", "family", "genus"]:
                val = td.get(rank)
                if not val:
                    continue
                rank_id = f"{rank}:{val}"
                if rank_id not in rank_node_map:
                    rank_node_map[rank_id] = TaxonomicRankNode(
                        rank_id=rank_id,
                        rank=rank,
                        name=val,
                        description=f"{val} is a {rank} in the taxonomic hierarchy",
                    )

        # --- Step 2: Add rank nodes to Cognee in batches ---
        rank_list = list(rank_node_map.values())
        logger.info("Adding %d taxonomic rank nodes to Cognee...", len(rank_list))
        for i in range(0, len(rank_list), DP_BATCH_SIZE):
            batch = rank_list[i : i + DP_BATCH_SIZE]
            await add_data_points(batch)

        self.rank_nodes = rank_node_map
        self.uuid_to_rank_node = {str(n.id): n for n in rank_list}

        # --- Step 3: Add GBIFTaxon DataPoints + edges to Cognee in batches ---
        logger.info("Adding GBIFTaxon DataPoints with taxonomic edges to Cognee...")
        total_edges = 0

        for i in range(0, len(taxa_list), DP_BATCH_SIZE):
            batch_dicts = taxa_list[i : i + DP_BATCH_SIZE]
            taxon_dps: List[GBIFTaxon] = []
            custom_edges: List[Tuple] = []

            for td in batch_dicts:
                key = td["taxon_key"]
                canonical = td.get("canonical_name") or td.get("scientific_name") or "Unknown"

                taxon = GBIFTaxon(
                    taxon_id=str(key),
                    taxon_key=key,
                    canonical_name=canonical,
                    scientific_name=td.get("scientific_name") or "",
                    rank=td.get("rank") or "SPECIES",
                    kingdom=td.get("kingdom"),
                    phylum=td.get("phylum"),
                    class_name=td.get("class"),
                    order=td.get("order"),
                    family=td.get("family"),
                    genus=td.get("genus"),
                    vernacular_name=td.get("vernacular_name"),
                    iucn_status=td.get("iucn_status"),
                    geographic_range=list(td.get("geographic_range") or []),
                    num_occurrences=int(td.get("num_occurrences") or 0),
                    description=_make_description(td),
                )
                taxon_dps.append(taxon)
                self.taxa_by_key[key] = taxon
                self.uuid_to_taxon[str(taxon.id)] = taxon

                for rank in ["kingdom", "phylum", "class", "order", "family", "genus"]:
                    val = td.get(rank)
                    if not val:
                        continue
                    rank_id = f"{rank}:{val}"
                    rank_node = rank_node_map.get(rank_id)
                    if rank_node:
                        custom_edges.append(
                            (
                                taxon.id,
                                rank_node.id,
                                f"BELONGS_TO_{rank.upper()}",
                                {"weight": 1.0},
                            )
                        )
                        total_edges += 1

            await add_data_points(taxon_dps, custom_edges=custom_edges)
            self.taxa_loaded += len(taxon_dps)

            if self.taxa_loaded % 2000 < DP_BATCH_SIZE:
                logger.info(
                    "Cognee ingestion progress: %d/%d taxa", self.taxa_loaded, len(taxa_list)
                )

        self.node_count = len(self.rank_nodes) + self.taxa_loaded
        self.edge_count = total_edges

    def get_species_context(self, taxon_key: int) -> Optional[dict]:
        """Return the KG context for a taxon using in-memory data."""
        taxon = self.taxa_by_key.get(taxon_key)
        if not taxon:
            return None

        nodes = []
        edges = []
        seen = set()

        taxon_ext_id = f"TAXON:{taxon_key}"
        nodes.append(
            {
                "externalId": taxon_ext_id,
                "nodeType": "taxon",
                "label": taxon.canonical_name,
                "properties": {
                    "taxonKey": taxon.taxon_key,
                    "rank": taxon.rank,
                    "kingdom": taxon.kingdom,
                    "phylum": taxon.phylum,
                    "class": taxon.class_name,
                    "order": taxon.order,
                    "family": taxon.family,
                    "genus": taxon.genus,
                    "scientificName": taxon.scientific_name,
                    "canonicalName": taxon.canonical_name,
                    "vernacularName": taxon.vernacular_name,
                    "iucnStatus": taxon.iucn_status,
                    "geographicRange": list(taxon.geographic_range or []),
                    "numOccurrences": taxon.num_occurrences,
                    "extinct": None,
                },
            }
        )
        seen.add(taxon_ext_id)

        for loc in (taxon.geographic_range or []):
            loc_ext_id = f"REGION:{loc}"
            if loc_ext_id not in seen:
                nodes.append(
                    {
                        "externalId": loc_ext_id,
                        "nodeType": "region",
                        "label": loc,
                        "properties": {"name": loc},
                    }
                )
                seen.add(loc_ext_id)
            edges.append(
                {
                    "from": taxon_ext_id,
                    "to": loc_ext_id,
                    "edgeType": "FOUND_IN",
                    "weight": 1.0,
                }
            )

        rank_fields = [
            ("kingdom", taxon.kingdom),
            ("phylum", taxon.phylum),
            ("class", taxon.class_name),
            ("order", taxon.order),
            ("family", taxon.family),
            ("genus", taxon.genus),
        ]

        for rank, val in rank_fields:
            if not val:
                continue
            rank_ext_id = f"{rank.upper()}:{val}"
            if rank_ext_id not in seen:
                nodes.append(
                    {
                        "externalId": rank_ext_id,
                        "nodeType": rank,
                        "label": val,
                        "properties": {"rank": rank, "name": val},
                    }
                )
                seen.add(rank_ext_id)
            edges.append(
                {
                    "from": taxon_ext_id,
                    "to": rank_ext_id,
                    "edgeType": f"BELONGS_TO_{rank.upper()}",
                    "weight": 1.0,
                }
            )

        return {
            "taxonKey": taxon_key,
            "label": taxon.canonical_name,
            "nodeType": "taxon",
            "properties": nodes[0]["properties"],
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "nodes": nodes,
            "edges": edges,
        }

    def get_stats(self) -> dict:
        taxa = self.taxa_loaded
        ranks = len(self.rank_nodes)
        return {
            "nodeCount": taxa + ranks,
            "edgeCount": self.edge_count,
            "taxaLoaded": taxa,
            "rankNodesLoaded": ranks,
        }
