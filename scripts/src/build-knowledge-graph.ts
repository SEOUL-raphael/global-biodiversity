import { db, gbifTaxa, gbifOccurrences, gbifKgNodes, gbifKgEdges, gbifSyncLog } from "@workspace/db";
import { sql, eq, isNotNull } from "drizzle-orm";

const CHECKPOINT_FILE = "/tmp/gbif_kg_checkpoint.json";

interface KgCheckpoint {
  taxonNodesCreated: boolean;
  regionNodesCreated: boolean;
  threatNodesCreated: boolean;
  classifiedAsEdgesCreated: boolean;
  inhabitsEdgesCreated: boolean;
  threatenedByEdgesCreated: boolean;
  cooccurrenceEdgesCreated: boolean;
}

async function loadCheckpoint(): Promise<KgCheckpoint> {
  try {
    const { readFile } = await import("fs/promises");
    const raw = await readFile(CHECKPOINT_FILE, "utf-8");
    return JSON.parse(raw) as KgCheckpoint;
  } catch {
    return {
      taxonNodesCreated: false,
      regionNodesCreated: false,
      threatNodesCreated: false,
      classifiedAsEdgesCreated: false,
      inhabitsEdgesCreated: false,
      threatenedByEdgesCreated: false,
      cooccurrenceEdgesCreated: false,
    };
  }
}

async function saveCheckpoint(cp: KgCheckpoint): Promise<void> {
  const { writeFile } = await import("fs/promises");
  await writeFile(CHECKPOINT_FILE, JSON.stringify(cp), "utf-8");
}

// ── Bulk: 모든 taxon 노드를 단일 SQL로 upsert ──────────────────────────
async function buildTaxonNodes(cp: KgCheckpoint): Promise<number> {
  if (cp.taxonNodesCreated) {
    console.log("  Skipping taxon nodes (already created)");
    const r = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM gbif_kg_nodes WHERE node_type='TAXON'`);
    return Number(r.rows[0]?.n ?? 0);
  }
  console.log("  Building TAXON nodes (bulk)...");

  const result = await db.execute<{ total: string }>(sql`
    INSERT INTO gbif_kg_nodes (node_type, external_id, label, properties)
    SELECT
      'TAXON',
      'TAXON:' || taxon_key,
      COALESCE(canonical_name, scientific_name),
      jsonb_build_object(
        'taxonKey',      taxon_key,
        'rank',          rank,
        'kingdom',       kingdom,
        'family',        family,
        'iucnStatus',    iucn_status,
        'numOccurrences',num_occurrences,
        'extinct',       extinct
      )
    FROM gbif_taxa
    ON CONFLICT (external_id) DO UPDATE SET
      label      = EXCLUDED.label,
      properties = EXCLUDED.properties
    RETURNING 1
  `);

  const total = result.rows.length;
  cp.taxonNodesCreated = true;
  await saveCheckpoint(cp);
  console.log(`  Done: ${total} TAXON nodes`);
  return total;
}

// ── Bulk: region 노드 ───────────────────────────────────────────────────
async function buildRegionNodes(cp: KgCheckpoint): Promise<number> {
  if (cp.regionNodesCreated) {
    console.log("  Skipping region nodes (already created)");
    return 0;
  }
  console.log("  Building REGION nodes (bulk)...");

  await db.execute(sql`
    INSERT INTO gbif_kg_nodes (node_type, external_id, label, properties)
    SELECT
      'REGION',
      'REGION:' || country_code,
      country_code,
      jsonb_build_object(
        'countryCode',    country_code,
        'occurrenceCount',occurrence_count,
        'speciesCount',   species_count
      )
    FROM gbif_regions
    WHERE country_code IS NOT NULL
    ON CONFLICT (external_id) DO UPDATE SET
      label      = EXCLUDED.label,
      properties = EXCLUDED.properties
  `);

  // occurrence 테이블에만 있는 국가 추가
  await db.execute(sql`
    INSERT INTO gbif_kg_nodes (node_type, external_id, label, properties)
    SELECT DISTINCT
      'REGION',
      'REGION:' || country_code,
      country_code,
      jsonb_build_object('countryCode', country_code)
    FROM gbif_occurrences
    WHERE country_code IS NOT NULL
    ON CONFLICT (external_id) DO NOTHING
  `);

  const r = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM gbif_kg_nodes WHERE node_type='REGION'`);
  const total = Number(r.rows[0]?.n ?? 0);

  cp.regionNodesCreated = true;
  await saveCheckpoint(cp);
  console.log(`  Done: ${total} REGION nodes`);
  return total;
}

// ── Threat 노드 (9개 고정) ──────────────────────────────────────────────
async function buildThreatNodes(cp: KgCheckpoint): Promise<number> {
  if (cp.threatNodesCreated) {
    console.log("  Skipping threat nodes (already created)");
    return 0;
  }
  console.log("  Building THREAT nodes...");

  const cats = [
    ["EX","Extinct"],["EW","Extinct in the Wild"],["CR","Critically Endangered"],
    ["EN","Endangered"],["VU","Vulnerable"],["NT","Near Threatened"],
    ["LC","Least Concern"],["DD","Data Deficient"],["NE","Not Evaluated"],
  ];

  for (const [code, label] of cats) {
    await db.execute(sql`
      INSERT INTO gbif_kg_nodes (node_type, external_id, label, properties)
      VALUES ('THREAT', ${"THREAT:" + code}, ${label},
              ${JSON.stringify({ iucnCode: code, category: label })}::jsonb)
      ON CONFLICT (external_id) DO NOTHING
    `);
  }

  cp.threatNodesCreated = true;
  await saveCheckpoint(cp);
  console.log(`  Done: ${cats.length} THREAT nodes`);
  return cats.length;
}

// ── CLASSIFIED_AS: 단일 JOIN SQL ────────────────────────────────────────
async function buildClassifiedAsEdges(cp: KgCheckpoint): Promise<number> {
  if (cp.classifiedAsEdgesCreated) {
    console.log("  Skipping CLASSIFIED_AS edges (already created)");
    const r = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM gbif_kg_edges WHERE edge_type='CLASSIFIED_AS'`);
    return Number(r.rows[0]?.n ?? 0);
  }
  console.log("  Building CLASSIFIED_AS edges (bulk JOIN)...");

  const result = await db.execute<{ total: string }>(sql`
    INSERT INTO gbif_kg_edges (from_node, to_node, edge_type, weight, properties)
    SELECT
      c.node_id,
      p.node_id,
      'CLASSIFIED_AS',
      1.0,
      '{}'::jsonb
    FROM gbif_taxa t
    JOIN gbif_kg_nodes c ON c.external_id = 'TAXON:' || t.taxon_key
    JOIN gbif_kg_nodes p ON p.external_id = 'TAXON:' || t.parent_key
    WHERE t.parent_key IS NOT NULL
    ON CONFLICT (from_node, to_node, edge_type) DO NOTHING
    RETURNING 1
  `);

  const total = result.rows.length;
  cp.classifiedAsEdgesCreated = true;
  await saveCheckpoint(cp);
  console.log(`  Done: ${total} CLASSIFIED_AS edges`);
  return total;
}

// ── INHABITS: taxon → region ────────────────────────────────────────────
async function buildInhabitsEdges(cp: KgCheckpoint): Promise<number> {
  if (cp.inhabitsEdgesCreated) {
    console.log("  Skipping INHABITS edges (already created)");
    const r = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM gbif_kg_edges WHERE edge_type='INHABITS'`);
    return Number(r.rows[0]?.n ?? 0);
  }
  console.log("  Building INHABITS edges (bulk JOIN)...");

  const result = await db.execute<{ total: string }>(sql`
    INSERT INTO gbif_kg_edges (from_node, to_node, edge_type, weight, properties)
    SELECT
      rn.node_id,
      tn.node_id,
      'INHABITS',
      1.0,
      jsonb_build_object('occurrenceCount', agg.occ_count)
    FROM (
      SELECT taxon_key, country_code, COUNT(*) AS occ_count
      FROM gbif_occurrences
      WHERE country_code IS NOT NULL
      GROUP BY taxon_key, country_code
    ) agg
    JOIN gbif_kg_nodes tn ON tn.external_id = 'TAXON:' || agg.taxon_key
    JOIN gbif_kg_nodes rn ON rn.external_id = 'REGION:' || agg.country_code
    ON CONFLICT (from_node, to_node, edge_type) DO UPDATE SET
      weight     = EXCLUDED.weight,
      properties = EXCLUDED.properties
    RETURNING 1
  `);

  const total = result.rows.length;
  cp.inhabitsEdgesCreated = true;
  await saveCheckpoint(cp);
  console.log(`  Done: ${total} INHABITS edges`);
  return total;
}

// IUCN 정규화 매핑
const IUCN_NORMALIZE: Record<string, string> = {
  EXTINCT: "EX", EXTINCT_IN_THE_WILD: "EW", CRITICALLY_ENDANGERED: "CR",
  ENDANGERED: "EN", VULNERABLE: "VU", NEAR_THREATENED: "NT",
  LEAST_CONCERN: "LC", DATA_DEFICIENT: "DD", NOT_EVALUATED: "NE",
  NOT_APPLICABLE: "NE", REGIONALLY_EXTINCT: "EX",
  EX: "EX", EW: "EW", CR: "CR", EN: "EN",
  VU: "VU", NT: "NT", LC: "LC", DD: "DD", NE: "NE",
};

// ── THREATENED_BY: taxon → IUCN threat ─────────────────────────────────
async function buildThreatenedByEdges(cp: KgCheckpoint): Promise<number> {
  if (cp.threatenedByEdgesCreated) {
    console.log("  Skipping THREATENED_BY edges (already created)");
    const r = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM gbif_kg_edges WHERE edge_type='THREATENED_BY'`);
    return Number(r.rows[0]?.n ?? 0);
  }
  console.log("  Building THREATENED_BY edges (bulk)...");

  // 정규화 맵핑 테이블 생성 후 JOIN
  const normalizeCases = Object.entries(IUCN_NORMALIZE)
    .map(([k, v]) => `WHEN UPPER(iucn_status) = '${k}' THEN '${v}'`)
    .join(" ");

  const result = await db.execute<{ total: string }>(sql`
    INSERT INTO gbif_kg_edges (from_node, to_node, edge_type, weight, properties)
    SELECT
      tn.node_id,
      thr.node_id,
      'THREATENED_BY',
      1.0,
      jsonb_build_object('iucnStatus', norm_code, 'iucnStatusRaw', t.iucn_status)
    FROM (
      SELECT taxon_key, iucn_status,
             CASE ${sql.raw(normalizeCases)} ELSE NULL END AS norm_code
      FROM gbif_taxa
      WHERE iucn_status IS NOT NULL AND iucn_status != ''
    ) t
    JOIN gbif_kg_nodes tn  ON tn.external_id  = 'TAXON:'  || t.taxon_key
    JOIN gbif_kg_nodes thr ON thr.external_id = 'THREAT:' || t.norm_code
    WHERE t.norm_code IS NOT NULL
      AND t.norm_code NOT IN ('LC','NE')
    ON CONFLICT (from_node, to_node, edge_type) DO NOTHING
    RETURNING 1
  `);

  const total = result.rows.length;
  cp.threatenedByEdgesCreated = true;
  await saveCheckpoint(cp);
  console.log(`  Done: ${total} THREATENED_BY edges`);
  return total;
}

// ── CO_OCCURS_WITH: Jaccard 유사도 ─────────────────────────────────────
async function buildCooccurrenceEdges(cp: KgCheckpoint): Promise<number> {
  if (cp.cooccurrenceEdgesCreated) {
    console.log("  Skipping CO_OCCURS_WITH edges (already created)");
    const r = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM gbif_kg_edges WHERE edge_type='CO_OCCURS_WITH'`);
    return Number(r.rows[0]?.n ?? 0);
  }
  console.log("  Building CO_OCCURS_WITH edges (Jaccard, bulk JOIN)...");

  const result = await db.execute<{ total: string }>(sql`
    INSERT INTO gbif_kg_edges (from_node, to_node, edge_type, weight, properties)
    WITH taxon_region_decades AS (
      SELECT
        taxon_key,
        country_code || ':' || COALESCE(((year / 10) * 10)::text, 'ALL') AS slot,
        country_code
      FROM gbif_occurrences
      WHERE country_code IS NOT NULL
      GROUP BY taxon_key, country_code, COALESCE(((year / 10) * 10)::text, 'ALL')
    ),
    taxon_slots AS (
      SELECT
        taxon_key,
        ARRAY_AGG(DISTINCT slot ORDER BY slot)         AS slots,
        ARRAY_AGG(DISTINCT country_code ORDER BY country_code) AS regions
      FROM taxon_region_decades
      GROUP BY taxon_key
      HAVING COUNT(DISTINCT slot) >= 2
    ),
    pairs AS (
      SELECT
        a.taxon_key AS ka,
        b.taxon_key AS kb,
        ROUND(
          CAST(ARRAY_LENGTH(
            ARRAY(SELECT UNNEST(a.slots) INTERSECT SELECT UNNEST(b.slots)), 1
          ) AS numeric) /
          NULLIF(ARRAY_LENGTH(
            ARRAY(SELECT UNNEST(a.slots) UNION SELECT UNNEST(b.slots)), 1
          ), 0),
          4
        ) AS jaccard,
        ARRAY_TO_JSON(ARRAY(
          SELECT UNNEST(a.regions) INTERSECT SELECT UNNEST(b.regions)
        ))::text AS shared_regions
      FROM taxon_slots a
      JOIN taxon_slots b ON a.taxon_key < b.taxon_key
      WHERE ARRAY_LENGTH(
        ARRAY(SELECT UNNEST(a.slots) INTERSECT SELECT UNNEST(b.slots)), 1
      ) >= 2
      ORDER BY jaccard DESC
      LIMIT 5000
    )
    SELECT
      na.node_id,
      nb.node_id,
      'CO_OCCURS_WITH',
      p.jaccard,
      jsonb_build_object(
        'jaccardSimilarity', p.jaccard,
        'shared_regions',    p.shared_regions::jsonb
      )
    FROM pairs p
    JOIN gbif_kg_nodes na ON na.external_id = 'TAXON:' || p.ka
    JOIN gbif_kg_nodes nb ON nb.external_id = 'TAXON:' || p.kb
    ON CONFLICT (from_node, to_node, edge_type) DO UPDATE SET
      weight     = EXCLUDED.weight,
      properties = EXCLUDED.properties
    RETURNING 1
  `);

  const total = result.rows.length;
  cp.cooccurrenceEdgesCreated = true;
  await saveCheckpoint(cp);
  console.log(`  Done: ${total} CO_OCCURS_WITH edges`);
  return total;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");

  console.log("=== GBIF Knowledge Graph Builder (optimized) ===");

  const [syncLog] = await db
    .insert(gbifSyncLog)
    .values({ syncType: "knowledge_graph", status: "running", recordsProcessed: 0 })
    .returning();

  const cp = await loadCheckpoint();
  let totalEdges = 0;

  try {
    console.log("\n[Phase 1] Building nodes...");
    const taxonCount  = await buildTaxonNodes(cp);
    const regionCount = await buildRegionNodes(cp);
    const threatCount = await buildThreatNodes(cp);
    const nodeTotal   = taxonCount + regionCount + threatCount;

    console.log("\n[Phase 2] Building edges...");
    const classifiedAs  = await buildClassifiedAsEdges(cp);
    const inhabits      = await buildInhabitsEdges(cp);
    const threatenedBy  = await buildThreatenedByEdges(cp);
    const cooccurrence  = await buildCooccurrenceEdges(cp);

    totalEdges = classifiedAs + inhabits + threatenedBy + cooccurrence;

    await db
      .update(gbifSyncLog)
      .set({ status: "completed", recordsProcessed: nodeTotal + totalEdges, finishedAt: new Date(), checkpoint: null })
      .where(eq(gbifSyncLog.id, syncLog.id));

    console.log(`\n=== Knowledge Graph complete ===`);
    console.log(`  Nodes: ${nodeTotal} (taxa: ${taxonCount}, regions: ${regionCount}, threats: ${threatCount})`);
    console.log(`  Edges: ${totalEdges} (classified: ${classifiedAs}, inhabits: ${inhabits}, threatened: ${threatenedBy}, co-occurs: ${cooccurrence})`);
  } catch (err) {
    console.error("Graph build failed:", err);
    await db
      .update(gbifSyncLog)
      .set({ status: "failed", errorMessage: String(err), finishedAt: new Date() })
      .where(eq(gbifSyncLog.id, syncLog.id));
    process.exit(1);
  }
}

main();
