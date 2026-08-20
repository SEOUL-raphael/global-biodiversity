/**
 * Backfill INHABITS edges (TAXON → REGION) for IUCN-threatened taxa whose
 * occurrence data is sparse or missing in `gbif_occurrences`.
 *
 * Why: the canonical INHABITS edges (built by `build-knowledge-graph`) are
 * derived from observed occurrence rows. Many threatened/endangered species
 * have very few occurrences in our dataset, which left the
 * `getEndangeredHotspots` query returning only 1–2 country results.
 *
 * Fix: for each threatened taxon without enough INHABITS edges, fetch the
 * authoritative country list from GBIF
 *   GET https://api.gbif.org/v1/species/{taxonKey}/distributions
 * and upsert one INHABITS edge per (taxon, country) into the knowledge graph,
 * creating REGION nodes on demand. The hotspots query is unchanged.
 *
 * Idempotent: ON CONFLICT clauses make it safe to re-run.
 *
 * Run via:  pnpm --filter @workspace/scripts run backfill-iucn-distributions
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const GBIF_BASE = "https://api.gbif.org/v1";
const THREATENED = [
  "CRITICALLY_ENDANGERED",
  "ENDANGERED",
  "VULNERABLE",
  "EXTINCT_IN_THE_WILD",
  "EXTINCT",
];
const CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 15_000;

interface DistributionRow {
  country?: string;
  countryCode?: string;
  establishmentMeans?: string;
}

async function fetchDistributions(taxonKey: number): Promise<string[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${GBIF_BASE}/species/${taxonKey}/distributions?limit=300`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: DistributionRow[] };
    const codes = new Set<string>();
    for (const row of body.results ?? []) {
      const cc = (row.countryCode ?? row.country ?? "").trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(cc)) codes.add(cc);
    }
    return [...codes];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function ensureRegionNode(countryCode: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO gbif_kg_nodes (node_type, external_id, label, properties)
    VALUES ('REGION', ${"REGION:" + countryCode}, ${countryCode},
            ${sql`jsonb_build_object('countryCode', ${countryCode})`})
    ON CONFLICT DO NOTHING
  `);
}

async function upsertInhabitsEdges(
  taxonKey: number,
  countries: string[],
): Promise<number> {
  if (countries.length === 0) return 0;
  for (const cc of countries) await ensureRegionNode(cc);

  const r = await db.execute<{ inserted: string }>(sql`
    WITH t AS (
      SELECT node_id FROM gbif_kg_nodes
      WHERE external_id = ${"TAXON:" + taxonKey} LIMIT 1
    ),
    r AS (
      SELECT node_id, properties->>'countryCode' AS cc
      FROM gbif_kg_nodes
      WHERE node_type = 'REGION'
        AND properties->>'countryCode' = ANY(${countries})
    ),
    ins AS (
      INSERT INTO gbif_kg_edges (from_node, to_node, edge_type, weight, properties)
      SELECT r.node_id, t.node_id, 'INHABITS', 1.0,
             jsonb_build_object('source', 'gbif_distribution')
      FROM t, r
      ON CONFLICT (from_node, to_node, edge_type) DO NOTHING
      RETURNING 1
    )
    SELECT count(*)::text AS inserted FROM ins
  `);
  return Number(r.rows[0]?.inserted ?? 0);
}

async function main(): Promise<void> {
  console.log("Backfill INHABITS edges from GBIF /species/{key}/distributions");
  console.log(`Threatened categories: ${THREATENED.join(", ")}`);

  const targets = await db.execute<{ taxon_key: number; existing: string }>(sql`
    SELECT t.taxon_key,
           COALESCE(e.cnt, '0') AS existing
    FROM gbif_taxa t
    LEFT JOIN (
      SELECT (n.properties->>'taxonKey')::int AS taxon_key,
             count(*)::text AS cnt
      FROM gbif_kg_edges e
      JOIN gbif_kg_nodes n ON n.node_id = e.to_node
      WHERE e.edge_type = 'INHABITS' AND n.node_type = 'TAXON'
      GROUP BY 1
    ) e ON e.taxon_key = t.taxon_key
    WHERE t.iucn_status = ANY(${THREATENED})
      AND COALESCE(e.cnt::int, 0) < 3
    ORDER BY t.taxon_key
  `);

  const list = targets.rows.map((r) => Number(r.taxon_key));
  console.log(`Threatened taxa needing backfill: ${list.length}`);

  let processed = 0;
  let withData = 0;
  let edgesInserted = 0;

  async function worker(): Promise<void> {
    while (list.length > 0) {
      const key = list.shift();
      if (key === undefined) break;
      const codes = await fetchDistributions(key);
      if (codes.length > 0) {
        withData++;
        edgesInserted += await upsertInhabitsEdges(key, codes);
      }
      processed++;
      if (processed % 50 === 0) {
        console.log(
          `  …${processed} processed · ${withData} with data · ${edgesInserted} edges`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(
    `Done. processed=${processed} withDistribution=${withData} edgesInserted=${edgesInserted}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
