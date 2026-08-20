import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { gbifOccurrences, gbifRegions } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { searchOccurrences } from "@workspace/gbif-client";
import { ingestOnce } from "../jobs/ingest";

const router: IRouter = Router();

const MAX_BATCH = 60;
const COOLDOWN_MS = 30_000;
const IP_MAP_MAX = 500;
const lastRunByIp = new Map<string, number>();

const ADMIN_TOKEN = process.env["ADMIN_TOKEN"];
const INGEST_CRON_TOKEN = process.env["INGEST_CRON_TOKEN"];

function checkToken(req: Request, res: Response): boolean {
  if (!ADMIN_TOKEN) return true;
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : req.query["token"];
  if (token !== ADMIN_TOKEN) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

function checkIngestToken(req: Request, res: Response): boolean {
  const configuredTokens = [ADMIN_TOKEN, INGEST_CRON_TOKEN].filter(
    (token): token is string => Boolean(token),
  );
  if (configuredTokens.length === 0) {
    res.status(503).json({ error: "ingest_scheduler_token_not_configured" });
    return false;
  }

  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : req.query["token"];
  if (!configuredTokens.includes(String(token))) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

router.post("/admin/ingest-batch", async (req: Request, res: Response) => {
  if (!checkIngestToken(req, res)) return;

  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const last = lastRunByIp.get(ip) ?? 0;
  if (now - last < COOLDOWN_MS) {
    res.status(429).json({ error: "cooldown", retryAfterMs: COOLDOWN_MS - (now - last) });
    return;
  }

  if (lastRunByIp.size >= IP_MAP_MAX) {
    const oldest = [...lastRunByIp.entries()].sort((a, b) => a[1] - b[1]).slice(0, 50);
    for (const [k] of oldest) lastRunByIp.delete(k);
  }
  lastRunByIp.set(ip, now);

  const rawN = req.query["count"] ?? req.body?.count;
  const parsed = Number.parseInt(String(rawN ?? "10"), 10);
  const n = Math.max(1, Math.min(MAX_BATCH, Number.isFinite(parsed) ? parsed : 10));

  const startedAt = Date.now();
  let completed = 0;
  let stopReason: string | undefined;
  for (let i = 0; i < n; i++) {
    try {
      const result = await ingestOnce();
      if (!result.ran) {
        stopReason = result.reason;
        break;
      }
      completed += 1;
    } catch (err) {
      req.log.warn({ err, completed }, "[admin] ingest-batch tick failed");
      break;
    }
  }
  const elapsedMs = Date.now() - startedAt;
  req.log.info({ requested: n, completed, stopReason, elapsedMs }, "[admin] ingest-batch done");
  res.json({ requested: n, completed, stopReason, elapsedMs });
});

// Rebuild INHABITS edges for all species that currently have occurrences.
router.post("/admin/rebuild-kg-inhabits", async (req: Request, res: Response) => {
  if (!checkToken(req, res)) return;

  const startedAt = Date.now();
  try {
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

    const upserted = result.rows.length;
    const elapsedMs = Date.now() - startedAt;
    req.log.info({ upserted, elapsedMs }, "[admin] rebuild-kg-inhabits done");
    res.json({ ok: true, upserted, elapsedMs });
  } catch (err) {
    req.log.error({ err }, "[admin] rebuild-kg-inhabits failed");
    res.status(500).json({ error: String(err) });
  }
});

// Track in-flight ingest-threatened jobs so we don't double-run
let ingestThreatened_running = false;
let ingestThreatened_lastResult: Record<string, unknown> | null = null;

/**
 * Targeted ingest for threatened species.
 * Responds 202 immediately; processing runs in the background.
 * Safe to call repeatedly — already-ingested taxa are skipped.
 *
 * Query params:
 *   limit  — max threatened species per run (default 100, max 500)
 *   offset — skip the first N threatened taxa (for pagination across calls)
 */
router.post("/admin/ingest-threatened", async (req: Request, res: Response) => {
  if (!checkToken(req, res)) return;

  if (ingestThreatened_running) {
    res.status(202).json({
      ok: true,
      status: "already_running",
      last: ingestThreatened_lastResult,
    });
    return;
  }

  const rawLimit = req.query["limit"] ?? req.body?.limit;
  const limit = Math.max(1, Math.min(500, Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : 100));
  const rawOffset = req.query["offset"] ?? req.body?.offset;
  const offset = Math.max(0, Number.isFinite(Number(rawOffset)) ? Number(rawOffset) : 0);

  // Respond immediately — processing happens in background
  res.status(202).json({ ok: true, status: "started", limit, offset });

  ingestThreatened_running = true;
  const log = req.log;

  setImmediate(async () => {
    const startedAt = Date.now();
    log.info({ limit, offset }, "[admin] ingest-threatened start");

    try {
      // Find threatened taxa without any occurrences
      const threatened = await db.execute<{ taxon_key: number; canonical_name: string | null }>(sql`
        SELECT t.taxon_key, t.canonical_name
        FROM gbif_taxa t
        WHERE t.iucn_status IN (
          'CRITICALLY_ENDANGERED', 'ENDANGERED', 'VULNERABLE',
          'CR', 'EN', 'VU'
        )
        AND NOT EXISTS (
          SELECT 1 FROM gbif_occurrences o WHERE o.taxon_key = t.taxon_key
        )
        ORDER BY t.iucn_status, t.taxon_key
        LIMIT ${limit} OFFSET ${offset}
      `);

      const taxa = threatened.rows;
      log.info({ found: taxa.length }, "[admin] ingest-threatened: taxa without occurrences");

      let processedSpecies = 0;
      let totalOcc = 0;
      let skipped = 0;
      const countryStats = new Map<string, { occ: number; species: Set<number> }>();

      for (const row of taxa) {
        const taxonKey = Number(row.taxon_key);

        // Polite 300 ms delay between GBIF requests
        await sleep(300);

        let attempts = 0;
        let result = null;

        // Retry up to 3 times on 429 with exponential backoff
        while (attempts < 3) {
          try {
            result = await searchOccurrences({
              taxonKey,
              hasCoordinate: true,
              limit: 100,
              offset: 0,
            });
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("429") && attempts < 2) {
              attempts++;
              const backoffMs = 2000 * Math.pow(2, attempts);
              log.warn({ taxonKey, attempt: attempts, backoffMs }, "[admin] ingest-threatened: 429, backing off");
              await sleep(backoffMs);
            } else {
              log.warn({ err, taxonKey }, "[admin] ingest-threatened: fetch failed");
              skipped++;
              break;
            }
          }
        }

        if (!result) continue;

        for (const occ of result.results) {
          if (!occ.countryCode || !occ.key) continue;
          const cc = occ.countryCode.slice(0, 2);
          const stat = countryStats.get(cc) ?? { occ: 0, species: new Set<number>() };
          stat.occ++;
          stat.species.add(taxonKey);
          countryStats.set(cc, stat);
          totalOcc++;

          try {
            await db
              .insert(gbifOccurrences)
              .values({
                gbifKey: occ.key,
                taxonKey: occ.taxonKey ?? taxonKey,
                countryCode: cc,
                decimalLatitude: occ.decimalLatitude ?? null,
                decimalLongitude: occ.decimalLongitude ?? null,
                year: occ.year ?? null,
                month: occ.month ?? null,
                datasetKey: occ.datasetKey ?? null,
                basisOfRecord: occ.basisOfRecord ?? null,
              })
              .onConflictDoUpdate({
                target: gbifOccurrences.gbifKey,
                set: {
                  taxonKey: sql`excluded.taxon_key`,
                  countryCode: sql`excluded.country_code`,
                  decimalLatitude: sql`excluded.decimal_latitude`,
                  decimalLongitude: sql`excluded.decimal_longitude`,
                  year: sql`excluded.year`,
                  month: sql`excluded.month`,
                  datasetKey: sql`excluded.dataset_key`,
                  basisOfRecord: sql`excluded.basis_of_record`,
                },
              });
          } catch (dbErr) {
            log.warn({ dbErr, taxonKey }, "[admin] ingest-threatened: DB insert failed");
          }
        }
        processedSpecies++;
      }

      // Update region occurrence/species counts
      for (const [cc, stat] of countryStats.entries()) {
        try {
          await db
            .insert(gbifRegions)
            .values({
              countryCode: cc,
              countryName: cc,
              occurrenceCount: stat.occ,
              speciesCount: stat.species.size,
              lastSynced: new Date(),
            })
            .onConflictDoUpdate({
              target: gbifRegions.countryCode,
              set: {
                occurrenceCount: sql`${gbifRegions.occurrenceCount} + ${stat.occ}`,
                lastSynced: sql`NOW()`,
              },
            });
        } catch (dbErr) {
          log.warn({ dbErr, cc }, "[admin] ingest-threatened: region update failed");
        }
      }

      // Upsert INHABITS edges for all newly-ingested taxa
      if (taxa.length > 0) {
        const taxonKeys = taxa.map((r) => Number(r.taxon_key));
        try {
          await db.execute(sql`
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
              WHERE taxon_key = ANY(${sql.raw(`ARRAY[${taxonKeys.join(",")}]::bigint[]`)})
                AND country_code IS NOT NULL
              GROUP BY taxon_key, country_code
            ) agg
            JOIN gbif_kg_nodes tn ON tn.external_id = 'TAXON:' || agg.taxon_key
            JOIN gbif_kg_nodes rn ON rn.external_id = 'REGION:' || agg.country_code
            ON CONFLICT (from_node, to_node, edge_type) DO UPDATE SET
              weight     = EXCLUDED.weight,
              properties = EXCLUDED.properties
          `);
        } catch (kgErr) {
          log.warn({ kgErr }, "[admin] ingest-threatened: KG edge upsert failed");
        }
      }

      const elapsedMs = Date.now() - startedAt;
      const summary = { ok: true, found: taxa.length, processedSpecies, totalOcc, skipped, countries: countryStats.size, elapsedMs };
      log.info(summary, "[admin] ingest-threatened done");
      ingestThreatened_lastResult = summary;
    } catch (err) {
      log.error({ err }, "[admin] ingest-threatened failed");
      ingestThreatened_lastResult = { ok: false, error: String(err) };
    } finally {
      ingestThreatened_running = false;
    }
  });
});

// Check status of last ingest-threatened run
router.get("/admin/ingest-threatened/status", (req: Request, res: Response) => {
  if (!checkToken(req, res)) return;
  res.json({
    running: ingestThreatened_running,
    last: ingestThreatened_lastResult,
  });
});

export default router;
