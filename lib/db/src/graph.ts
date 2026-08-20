import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface GraphNode {
  nodeId: number;
  nodeType: string;
  externalId: string;
  label: string;
  properties: unknown;
}

export interface GraphEdge {
  edgeId: number;
  fromNode: number;
  toNode: number;
  edgeType: string;
  weight: number;
  properties: unknown;
}

export interface GraphContext {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface CooccurrenceCluster {
  taxonKeyA: number;
  labelA: string;
  taxonKeyB: number;
  labelB: string;
  jaccardSimilarity: number;
  sharedRegions: string[];
}

export interface EndangeredHotspot {
  countryCode: string;
  regionLabel: string;
  endangeredCount: number;
  iucnStatuses: string[];
  topSpecies: Array<{ taxonKey: number; label: string; iucnStatus: string }>;
}

export interface TaxonomyGap {
  rank: string;
  taxonKey: number;
  label: string;
  kingdom: string | null;
  totalSpeciesCount: number;
  occurrenceCount: number;
  occurrencePerSpecies: number;
}

type AnyDb = NodePgDatabase<Record<string, unknown>>;

export async function nHopNeighbors(
  db: AnyDb,
  nodeId: number,
  maxHops = 2,
): Promise<GraphContext> {
  const rows = await db.execute<{
    node_id: number;
    node_type: string;
    external_id: string;
    label: string;
    properties: unknown;
    depth: number;
  }>(sql`
    WITH RECURSIVE traversal AS (
      SELECT
        n.node_id, n.node_type, n.external_id, n.label, n.properties, 0 AS depth
      FROM gbif_kg_nodes n
      WHERE n.node_id = ${nodeId}

      UNION ALL

      SELECT
        n.node_id, n.node_type, n.external_id, n.label, n.properties, t.depth + 1
      FROM traversal t
      JOIN gbif_kg_edges e ON (e.from_node = t.node_id OR e.to_node = t.node_id)
      JOIN gbif_kg_nodes n ON n.node_id = CASE
        WHEN e.from_node = t.node_id THEN e.to_node
        ELSE e.from_node
      END
      WHERE t.depth < ${maxHops}
        AND n.node_id != t.node_id
    )
    SELECT DISTINCT node_id, node_type, external_id, label, properties, MIN(depth) AS depth
    FROM traversal
    GROUP BY node_id, node_type, external_id, label, properties
    ORDER BY depth, node_id
    LIMIT 200
  `);

  const nodeIds = rows.rows.map((r) => r.node_id);
  if (nodeIds.length === 0) return { nodes: [], edges: [] };

  const edgeRows = await db.execute<{
    edge_id: number;
    from_node: number;
    to_node: number;
    edge_type: string;
    weight: number;
    properties: unknown;
  }>(sql`
    SELECT edge_id, from_node, to_node, edge_type, weight, properties
    FROM gbif_kg_edges
    WHERE from_node = ANY(${sql.raw(`ARRAY[${nodeIds.join(",")}]::bigint[]`)})
      AND to_node = ANY(${sql.raw(`ARRAY[${nodeIds.join(",")}]::bigint[]`)})
    LIMIT 500
  `);

  return {
    nodes: rows.rows.map((r) => ({
      nodeId: r.node_id,
      nodeType: r.node_type,
      externalId: r.external_id,
      label: r.label,
      properties: r.properties,
    })),
    edges: edgeRows.rows.map((r) => ({
      edgeId: r.edge_id,
      fromNode: r.from_node,
      toNode: r.to_node,
      edgeType: r.edge_type,
      weight: r.weight,
      properties: r.properties,
    })),
  };
}

export async function getCooccurrenceClusters(
  db: AnyDb,
  countryCode?: string,
  minJaccard = 0.1,
  limit = 20,
): Promise<CooccurrenceCluster[]> {
  const countryFilter = countryCode
    ? sql`AND e.properties->'shared_regions' @> ${JSON.stringify([countryCode.toUpperCase()])}::jsonb`
    : sql``;

  const rows = await db.execute<{
    taxon_key_a: number;
    label_a: string;
    taxon_key_b: number;
    label_b: string;
    weight: number;
    shared_regions: string;
  }>(sql`
    SELECT
      CAST(na.properties->>'taxonKey' AS bigint) AS taxon_key_a,
      na.label AS label_a,
      CAST(nb.properties->>'taxonKey' AS bigint) AS taxon_key_b,
      nb.label AS label_b,
      e.weight,
      COALESCE(e.properties->>'shared_regions', '[]') AS shared_regions
    FROM gbif_kg_edges e
    JOIN gbif_kg_nodes na ON na.node_id = e.from_node AND na.node_type = 'TAXON'
    JOIN gbif_kg_nodes nb ON nb.node_id = e.to_node AND nb.node_type = 'TAXON'
    WHERE e.edge_type = 'CO_OCCURS_WITH'
      AND e.weight >= ${minJaccard}
      ${countryFilter}
    ORDER BY
      e.weight DESC,
      jsonb_array_length(COALESCE(e.properties->'shared_regions', '[]'::jsonb)) DESC,
      LEAST(na.label, nb.label) ASC,
      GREATEST(na.label, nb.label) ASC
    LIMIT ${limit}
  `);

  return rows.rows.map((r) => {
    let sharedRegions: string[] = [];
    try {
      sharedRegions = JSON.parse(r.shared_regions) as string[];
    } catch {
      sharedRegions = [];
    }
    return {
      taxonKeyA: Number(r.taxon_key_a),
      labelA: r.label_a,
      taxonKeyB: Number(r.taxon_key_b),
      labelB: r.label_b,
      jaccardSimilarity: r.weight,
      sharedRegions,
    };
  });
}

export async function getEndangeredHotspots(
  db: AnyDb,
  limit = 10,
): Promise<EndangeredHotspot[]> {
  const rows = await db.execute<{
    country_code: string;
    region_label: string;
    endangered_count: number;
    iucn_statuses: string;
    top_species: string;
  }>(sql`
    SELECT
      n_region.external_id AS country_code,
      n_region.label AS region_label,
      COUNT(DISTINCT n_taxon.node_id) AS endangered_count,
      ARRAY_TO_JSON(ARRAY_AGG(DISTINCT t.iucn_status)) AS iucn_statuses,
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'taxonKey', CAST(n_taxon.properties->>'taxonKey' AS integer),
          'label', n_taxon.label,
          'iucnStatus', t.iucn_status
        )
        ORDER BY t.num_occurrences DESC
      ) FILTER (WHERE n_taxon.node_id IS NOT NULL) AS top_species
    FROM gbif_kg_nodes n_region
    JOIN gbif_kg_edges e_inhabits ON e_inhabits.from_node = n_region.node_id
      AND e_inhabits.edge_type = 'INHABITS'
    JOIN gbif_kg_nodes n_taxon ON n_taxon.node_id = e_inhabits.to_node
      AND n_taxon.node_type = 'TAXON'
    JOIN gbif_taxa t ON CAST(n_taxon.properties->>'taxonKey' AS integer) = t.taxon_key
    WHERE n_region.node_type = 'REGION'
      AND t.iucn_status IN (
        'CR', 'EN', 'VU', 'EW', 'EX',
        'CRITICALLY_ENDANGERED', 'ENDANGERED', 'VULNERABLE',
        'EXTINCT_IN_THE_WILD', 'EXTINCT', 'REGIONALLY_EXTINCT'
      )
    GROUP BY n_region.node_id, n_region.external_id, n_region.label
    ORDER BY endangered_count DESC
    LIMIT ${limit}
  `);

  return rows.rows.map((r) => {
    // node-postgres may return JSON/array columns already parsed or as strings
    const parseJsonField = <T>(val: unknown, fallback: T): T => {
      if (val == null) return fallback;
      if (typeof val === "string") {
        try { return JSON.parse(val) as T; } catch { return fallback; }
      }
      return val as T;
    };
    const iucnStatuses = parseJsonField<string[]>(r.iucn_statuses, []);
    const topSpecies = (parseJsonField<EndangeredHotspot["topSpecies"]>(r.top_species, [])).slice(0, 5);
    return {
      countryCode: (r.country_code ?? "").replace("REGION:", ""),
      regionLabel: r.region_label,
      endangeredCount: Number(r.endangered_count),
      iucnStatuses,
      topSpecies,
    };
  });
}

export interface ShortestPathResult {
  path: GraphNode[];
  edges: GraphEdge[];
  hopCount: number;
}

/**
 * BFS shortest path between two KG nodes.
 * Note: connected-component analysis is deferred to Cognee KG engine (Task #4).
 */
export async function shortestPath(
  db: AnyDb,
  fromNodeId: number,
  toNodeId: number,
  maxHops = 4,
): Promise<ShortestPathResult | null> {
  const rows = await db.execute<{
    node_id: number;
    node_type: string;
    external_id: string;
    label: string;
    properties: unknown;
    prev_node_id: number | null;
    depth: number;
  }>(sql`
    WITH RECURSIVE bfs AS (
      SELECT
        n.node_id, n.node_type, n.external_id, n.label, n.properties,
        NULL::bigint AS prev_node_id, 0 AS depth
      FROM gbif_kg_nodes n
      WHERE n.node_id = ${fromNodeId}

      UNION ALL

      SELECT
        n.node_id, n.node_type, n.external_id, n.label, n.properties,
        t.node_id AS prev_node_id, t.depth + 1
      FROM bfs t
      JOIN gbif_kg_edges e ON (e.from_node = t.node_id OR e.to_node = t.node_id)
      JOIN gbif_kg_nodes n ON n.node_id = CASE
        WHEN e.from_node = t.node_id THEN e.to_node
        ELSE e.from_node
      END
      WHERE t.depth < ${maxHops}
        AND n.node_id != t.node_id
    )
    SELECT DISTINCT ON (node_id) node_id, node_type, external_id, label, properties, prev_node_id, depth
    FROM bfs
    ORDER BY node_id, depth
  `);

  const target = rows.rows.find((r) => r.node_id === toNodeId);
  if (!target) return null;

  const nodeMap = new Map(rows.rows.map((r) => [r.node_id, r]));
  const pathNodes: typeof rows.rows = [];
  let cur: (typeof rows.rows)[0] | undefined = target;
  while (cur) {
    pathNodes.unshift(cur);
    cur = cur.prev_node_id != null ? nodeMap.get(cur.prev_node_id) : undefined;
  }

  if (pathNodes.length < 2) return null;

  const nodeIds = pathNodes.map((n) => n.node_id);
  const edgeRows = await db.execute<{
    edge_id: number;
    from_node: number;
    to_node: number;
    edge_type: string;
    weight: number;
    properties: unknown;
  }>(sql`
    SELECT edge_id, from_node, to_node, edge_type, weight, properties
    FROM gbif_kg_edges
    WHERE from_node = ANY(${sql.raw(`ARRAY[${nodeIds.join(",")}]::bigint[]`)})
      AND to_node = ANY(${sql.raw(`ARRAY[${nodeIds.join(",")}]::bigint[]`)})
  `);

  return {
    path: pathNodes.map((r) => ({
      nodeId: r.node_id,
      nodeType: r.node_type,
      externalId: r.external_id,
      label: r.label,
      properties: r.properties,
    })),
    edges: edgeRows.rows.map((r) => ({
      edgeId: r.edge_id,
      fromNode: r.from_node,
      toNode: r.to_node,
      edgeType: r.edge_type,
      weight: r.weight,
      properties: r.properties,
    })),
    hopCount: target.depth,
  };
}

// ─── Spatial Query Types ────────────────────────────────────────────────────

export interface SpatialSpeciesResult {
  taxonKey: number;
  canonicalName: string;
  kingdom: string | null;
  iucnStatus: string | null;
  occurrenceCount: number;
  closestDistanceKm: number;
  closestLat: number;
  closestLon: number;
  countryCode: string | null;
}

export interface OccurrenceHotspot {
  cellLat: number;
  cellLon: number;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  occurrenceCount: number;
  speciesCount: number;
  topSpecies: Array<{ taxonKey: number; canonicalName: string; count: number }>;
}

/**
 * Haversine-based search: find species with occurrences within radius_km of (lat, lon).
 * Uses the 6371 km Earth mean radius approximation.
 */
export async function searchSpeciesByLocation(
  db: AnyDb,
  lat: number,
  lon: number,
  radiusKm = 50,
  limit = 20,
): Promise<SpatialSpeciesResult[]> {
  const clampedRadius = Math.min(Math.max(radiusKm, 1), 5000);
  const clampedLimit = Math.min(Math.max(limit, 1), 100);

  const rows = await db.execute<{
    taxon_key: number;
    canonical_name: string;
    kingdom: string | null;
    iucn_status: string | null;
    occ_count: number;
    min_dist_km: number;
    closest_lat: number;
    closest_lon: number;
    country_code: string | null;
  }>(sql`
    WITH ranked AS (
      SELECT
        o.taxon_key,
        o.decimal_latitude,
        o.decimal_longitude,
        o.country_code,
        (2 * 6371 * ASIN(SQRT(
          POWER(SIN(RADIANS((o.decimal_latitude  - ${lat})  / 2)), 2) +
          COS(RADIANS(${lat})) * COS(RADIANS(o.decimal_latitude)) *
          POWER(SIN(RADIANS((o.decimal_longitude - ${lon}) / 2)), 2)
        ))) AS dist_km
      FROM gbif_occurrences o
      WHERE o.decimal_latitude  IS NOT NULL
        AND o.decimal_longitude IS NOT NULL
        AND o.decimal_latitude  BETWEEN ${lat - clampedRadius / 111.0} AND ${lat + clampedRadius / 111.0}
        AND o.decimal_longitude BETWEEN ${lon - clampedRadius / (111.0 * Math.cos((lat * Math.PI) / 180))} AND ${lon + clampedRadius / (111.0 * Math.cos((lat * Math.PI) / 180))}
    ),
    filtered AS (
      SELECT * FROM ranked WHERE dist_km <= ${clampedRadius}
    ),
    agg AS (
      SELECT
        taxon_key,
        COUNT(*)::integer       AS occ_count,
        MIN(dist_km)            AS min_dist_km,
        (ARRAY_AGG(decimal_latitude  ORDER BY dist_km ASC))[1] AS closest_lat,
        (ARRAY_AGG(decimal_longitude ORDER BY dist_km ASC))[1] AS closest_lon,
        (ARRAY_AGG(country_code      ORDER BY dist_km ASC))[1] AS country_code
      FROM filtered
      GROUP BY taxon_key
    )
    SELECT
      a.taxon_key,
      COALESCE(t.canonical_name, t.scientific_name, '')  AS canonical_name,
      t.kingdom,
      t.iucn_status,
      a.occ_count,
      ROUND(a.min_dist_km::numeric, 2)::float            AS min_dist_km,
      a.closest_lat,
      a.closest_lon,
      a.country_code
    FROM agg a
    JOIN gbif_taxa t ON t.taxon_key = a.taxon_key
    ORDER BY a.min_dist_km ASC
    LIMIT ${clampedLimit}
  `);

  return rows.rows.map((r) => ({
    taxonKey: Number(r.taxon_key),
    canonicalName: r.canonical_name,
    kingdom: r.kingdom,
    iucnStatus: r.iucn_status,
    occurrenceCount: Number(r.occ_count),
    closestDistanceKm: Number(r.min_dist_km),
    closestLat: Number(r.closest_lat),
    closestLon: Number(r.closest_lon),
    countryCode: r.country_code,
  }));
}

/**
 * Grid-based occurrence density: aggregate occurrences into lat/lon grid cells.
 * resolution = grid cell size in degrees (e.g. 2 = 2°×2° cells ≈ 222 km).
 */
export async function getOccurrenceHotspots(
  db: AnyDb,
  resolution = 2,
  bbox?: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  limit = 20,
): Promise<OccurrenceHotspot[]> {
  const res = Math.min(Math.max(resolution, 0.5), 20);
  const clampedLimit = Math.min(Math.max(limit, 1), 200);

  const bboxFilter = bbox
    ? sql`AND o.decimal_latitude  BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
          AND o.decimal_longitude BETWEEN ${bbox.minLon} AND ${bbox.maxLon}`
    : sql``;

  const rows = await db.execute<{
    cell_lat: number;
    cell_lon: number;
    occ_count: number;
    species_count: number;
    top_species: string;
  }>(sql`
    WITH cells AS (
      SELECT
        FLOOR(o.decimal_latitude  / ${res})::integer AS cell_lat_idx,
        FLOOR(o.decimal_longitude / ${res})::integer AS cell_lon_idx,
        o.taxon_key
      FROM gbif_occurrences o
      WHERE o.decimal_latitude IS NOT NULL AND o.decimal_longitude IS NOT NULL
        ${bboxFilter}
    ),
    cell_agg AS (
      SELECT
        cell_lat_idx,
        cell_lon_idx,
        COUNT(*)::integer              AS occ_count,
        COUNT(DISTINCT taxon_key)::integer AS species_count
      FROM cells
      GROUP BY cell_lat_idx, cell_lon_idx
    ),
    top_sp AS (
      SELECT
        cell_lat_idx,
        cell_lon_idx,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'taxonKey', t.taxon_key,
            'canonicalName', COALESCE(t.canonical_name, t.scientific_name, ''),
            'count', sp_count
          )
          ORDER BY sp_count DESC
        ) AS top_species
      FROM (
        SELECT
          cell_lat_idx, cell_lon_idx, taxon_key,
          COUNT(*)::integer AS sp_count
        FROM cells
        GROUP BY cell_lat_idx, cell_lon_idx, taxon_key
        ORDER BY sp_count DESC
      ) sc
      JOIN gbif_taxa t ON t.taxon_key = sc.taxon_key
      GROUP BY cell_lat_idx, cell_lon_idx
    )
    SELECT
      (ca.cell_lat_idx * ${res} + ${res / 2})::float AS cell_lat,
      (ca.cell_lon_idx * ${res} + ${res / 2})::float AS cell_lon,
      ca.occ_count,
      ca.species_count,
      COALESCE(ts.top_species::text, '[]') AS top_species
    FROM cell_agg ca
    LEFT JOIN top_sp ts USING (cell_lat_idx, cell_lon_idx)
    ORDER BY ca.occ_count DESC
    LIMIT ${clampedLimit}
  `);

  return rows.rows.map((r) => {
    let topSpecies: OccurrenceHotspot["topSpecies"] = [];
    try {
      const parsed = typeof r.top_species === "string"
        ? JSON.parse(r.top_species)
        : r.top_species;
      topSpecies = (Array.isArray(parsed) ? parsed : []).slice(0, 5) as OccurrenceHotspot["topSpecies"];
    } catch { /* ignore */ }

    const cellLat = Number(r.cell_lat);
    const cellLon = Number(r.cell_lon);
    return {
      cellLat,
      cellLon,
      latMin: cellLat - res / 2,
      latMax: cellLat + res / 2,
      lonMin: cellLon - res / 2,
      lonMax: cellLon + res / 2,
      occurrenceCount: Number(r.occ_count),
      speciesCount: Number(r.species_count),
      topSpecies,
    };
  });
}

export async function getTaxonomyGaps(
  db: AnyDb,
  limit = 20,
  kingdom?: string,
): Promise<TaxonomyGap[]> {
  // 모든 taxa가 SPECIES 랭크이므로, family 컬럼 기준으로 집계
  const rows = await db.execute<{
    rank: string;
    taxon_key: number;
    label: string;
    kingdom: string | null;
    total_species: number;
    occurrence_count: number;
    occ_per_species: number;
  }>(sql`
    WITH family_agg AS (
      SELECT
        t.family                                AS label,
        t.kingdom,
        MIN(t.taxon_key)                        AS rep_taxon_key,
        COUNT(DISTINCT t.taxon_key)             AS total_species,
        COUNT(DISTINCT o.gbif_key)              AS occurrence_count
      FROM gbif_taxa t
      LEFT JOIN gbif_occurrences o ON o.taxon_key = t.taxon_key
      WHERE t.family IS NOT NULL AND t.rank = 'SPECIES'
        ${kingdom ? sql`AND t.kingdom = ${kingdom}` : sql``}
      GROUP BY t.family, t.kingdom
      HAVING COUNT(DISTINCT t.taxon_key) >= 2
    )
    SELECT
      'FAMILY'                    AS rank,
      rep_taxon_key::integer      AS taxon_key,
      label,
      kingdom,
      total_species::integer,
      occurrence_count::integer,
      ROUND((occurrence_count::numeric / NULLIF(total_species, 0)), 2)::float AS occ_per_species
    FROM family_agg
    ORDER BY occ_per_species ASC, total_species DESC
    LIMIT ${limit}
  `);

  return rows.rows.map((r) => ({
    rank: r.rank,
    taxonKey: r.taxon_key,
    label: r.label,
    kingdom: r.kingdom,
    totalSpeciesCount: Number(r.total_species),
    occurrenceCount: Number(r.occurrence_count),
    occurrencePerSpecies: Number(r.occ_per_species),
  }));
}

export interface ThreatStatusBucket {
  status: string;
  count: number;
}

export interface KingdomThreatBreakdown {
  kingdom: string;
  total: number;
  threatened: number;
  notEvaluated: number;
  byStatus: Record<string, number>;
}

export interface FamilyThreatItem {
  family: string;
  kingdom: string | null;
  totalSpecies: number;
  threatenedSpecies: number;
  threatRatio: number;
}

export interface ThreatDistributionResponse {
  totalClassified: number;
  totalSpecies: number;
  byStatus: ThreatStatusBucket[];
  byKingdom: KingdomThreatBreakdown[];
  topThreatenedFamilies: FamilyThreatItem[];
}

// Normalize verbose IUCN names from DB to short codes used by the UI.
const IUCN_NORMALIZE: Record<string, string> = {
  CRITICALLY_ENDANGERED: "CR",
  ENDANGERED: "EN",
  VULNERABLE: "VU",
  NEAR_THREATENED: "NT",
  LEAST_CONCERN: "LC",
  DATA_DEFICIENT: "DD",
  NOT_EVALUATED: "NE",
  NOT_APPLICABLE: "NA",
  EXTINCT: "EX",
  EXTINCT_IN_THE_WILD: "EW",
  REGIONALLY_EXTINCT: "RE",
};
function normIucn(v: string | null | undefined): string {
  if (!v) return "UNKNOWN";
  return IUCN_NORMALIZE[v] ?? v;
}
const THREATENED = new Set(["CR", "EN", "VU"]);
const NOT_EVALUATED_SET = new Set(["UNKNOWN", "NE", "NA", "DD"]);

export async function getThreatDistribution(
  db: AnyDb,
  topFamilies = 10,
): Promise<ThreatDistributionResponse> {
  const statusRows = await db.execute<{
    iucn_status: string | null;
    cnt: number;
  }>(sql`
    SELECT COALESCE(iucn_status, 'UNKNOWN') AS iucn_status, COUNT(*)::integer AS cnt
    FROM gbif_taxa
    WHERE rank = 'SPECIES'
    GROUP BY iucn_status
    ORDER BY cnt DESC
  `);

  const kingdomRows = await db.execute<{
    kingdom: string | null;
    iucn_status: string | null;
    cnt: number;
  }>(sql`
    SELECT kingdom, iucn_status, COUNT(*)::integer AS cnt
    FROM gbif_taxa
    WHERE rank = 'SPECIES' AND kingdom IS NOT NULL
    GROUP BY kingdom, iucn_status
  `);

  const familyRows = await db.execute<{
    family: string;
    kingdom: string | null;
    total: number;
    threatened: number;
  }>(sql`
    SELECT
      family,
      MIN(kingdom) AS kingdom,
      COUNT(*)::integer AS total,
      SUM(CASE WHEN iucn_status IN ('CRITICALLY_ENDANGERED','ENDANGERED','VULNERABLE') THEN 1 ELSE 0 END)::integer AS threatened
    FROM gbif_taxa
    WHERE rank = 'SPECIES' AND family IS NOT NULL
    GROUP BY family
    HAVING SUM(CASE WHEN iucn_status IN ('CRITICALLY_ENDANGERED','ENDANGERED','VULNERABLE') THEN 1 ELSE 0 END) > 0
       AND COUNT(*) >= 3
    ORDER BY (SUM(CASE WHEN iucn_status IN ('CRITICALLY_ENDANGERED','ENDANGERED','VULNERABLE') THEN 1 ELSE 0 END)::numeric / COUNT(*)) DESC,
             threatened DESC
    LIMIT ${topFamilies}
  `);

  const aggStatus = new Map<string, number>();
  for (const r of statusRows.rows) {
    const s = normIucn(r.iucn_status);
    aggStatus.set(s, (aggStatus.get(s) ?? 0) + Number(r.cnt));
  }
  const byStatus: ThreatStatusBucket[] = Array.from(aggStatus.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  const totalSpecies = byStatus.reduce((s, r) => s + r.count, 0);
  const totalClassified = byStatus
    .filter((b) => !NOT_EVALUATED_SET.has(b.status))
    .reduce((s, r) => s + r.count, 0);

  const kingdomMap = new Map<string, KingdomThreatBreakdown>();
  for (const r of kingdomRows.rows) {
    const k = r.kingdom ?? "Unknown";
    if (!kingdomMap.has(k)) {
      kingdomMap.set(k, { kingdom: k, total: 0, threatened: 0, notEvaluated: 0, byStatus: {} });
    }
    const entry = kingdomMap.get(k)!;
    const status = normIucn(r.iucn_status);
    const cnt = Number(r.cnt);
    entry.total += cnt;
    entry.byStatus[status] = (entry.byStatus[status] ?? 0) + cnt;
    if (THREATENED.has(status)) entry.threatened += cnt;
    if (NOT_EVALUATED_SET.has(status)) entry.notEvaluated += cnt;
  }
  const byKingdom = Array.from(kingdomMap.values()).sort((a, b) => b.total - a.total);

  const topThreatenedFamilies: FamilyThreatItem[] = familyRows.rows.map((r) => ({
    family: r.family,
    kingdom: r.kingdom,
    totalSpecies: Number(r.total),
    threatenedSpecies: Number(r.threatened),
    threatRatio: Number(r.total) > 0 ? Number(r.threatened) / Number(r.total) : 0,
  }));

  return {
    totalClassified,
    totalSpecies,
    byStatus,
    byKingdom,
    topThreatenedFamilies,
  };
}

export interface YearOccurrencePoint {
  year: number;
  count: number;
}

export interface CountryYearSeries {
  countryCode: string;
  total: number;
  series: YearOccurrencePoint[];
}

export interface OccurrenceTrendsResponse {
  yearMin: number;
  yearMax: number;
  totalWithYear: number;
  totalWithoutYear: number;
  yearly: YearOccurrencePoint[];
  topCountries: CountryYearSeries[];
}

export async function getOccurrenceTrends(
  db: AnyDb,
  fromYear = 1980,
  topCountries = 5,
): Promise<OccurrenceTrendsResponse> {
  const yearlyRows = await db.execute<{ year: number; cnt: number }>(sql`
    SELECT year::integer AS year, COUNT(*)::integer AS cnt
    FROM gbif_occurrences
    WHERE year IS NOT NULL AND year >= ${fromYear} AND year <= EXTRACT(YEAR FROM NOW())::int
    GROUP BY year
    ORDER BY year ASC
  `);

  const noYearRow = await db.execute<{ cnt: number }>(sql`
    SELECT COUNT(*)::integer AS cnt
    FROM gbif_occurrences
    WHERE year IS NULL
  `);

  const topCountryRows = await db.execute<{ country_code: string; cnt: number }>(sql`
    SELECT country_code, COUNT(*)::integer AS cnt
    FROM gbif_occurrences
    WHERE country_code IS NOT NULL AND year IS NOT NULL AND year >= ${fromYear}
    GROUP BY country_code
    ORDER BY cnt DESC
    LIMIT ${topCountries}
  `);

  const codes = topCountryRows.rows.map((r) => r.country_code);
  let countrySeries: CountryYearSeries[] = [];

  if (codes.length > 0) {
    const inList = sql.raw(codes.map((c) => `'${c.replace(/'/g, "''")}'`).join(","));
    const seriesRows = await db.execute<{
      country_code: string;
      year: number;
      cnt: number;
    }>(sql`
      SELECT country_code, year::integer AS year, COUNT(*)::integer AS cnt
      FROM gbif_occurrences
      WHERE country_code IN (${inList})
        AND year IS NOT NULL AND year >= ${fromYear}
      GROUP BY country_code, year
      ORDER BY country_code, year
    `);

    const map = new Map<string, YearOccurrencePoint[]>();
    for (const r of seriesRows.rows) {
      const arr = map.get(r.country_code) ?? [];
      arr.push({ year: Number(r.year), count: Number(r.cnt) });
      map.set(r.country_code, arr);
    }
    countrySeries = topCountryRows.rows.map((r) => ({
      countryCode: r.country_code,
      total: Number(r.cnt),
      series: map.get(r.country_code) ?? [],
    }));
  }

  const yearly = yearlyRows.rows.map((r) => ({ year: Number(r.year), count: Number(r.cnt) }));
  const totalWithYear = yearly.reduce((s, p) => s + p.count, 0);
  const totalWithoutYear = Number(noYearRow.rows[0]?.cnt ?? 0);

  return {
    yearMin: yearly[0]?.year ?? fromYear,
    yearMax: yearly[yearly.length - 1]?.year ?? fromYear,
    totalWithYear,
    totalWithoutYear,
    yearly,
    topCountries: countrySeries,
  };
}
