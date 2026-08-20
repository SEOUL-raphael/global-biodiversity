import { db, withDbRetry } from "@workspace/db";
import {
  gbifTaxa,
  gbifOccurrences,
  gbifRegions,
  gbifSyncLog,
} from "@workspace/db/schema";
import { searchOccurrences } from "@workspace/gbif-client";
import { sql, asc, gt } from "drizzle-orm";
import { logger } from "../lib/logger";

// --- Budget & rate-limit ------------------------------------------------
// Development (default):  MAX_TICKS_PER_DAY=0  → unlimited, fast fill
// Production: BG_INGEST_MAX_TICKS_PER_DAY limits all workers collectively.
// The quota and cursor are read from gbif_sync_log, so they survive an
// Autoscale sleep/restart and scheduled HTTP invocations.
//   480 × 3 species × ~100 occ = ≤ 144 k occurrence upserts/day
//   ≤ 1 440 GBIF API requests/day (~1 req/min) — polite for public API
//
// Dev and production each have their own Replit Postgres database.
// Run POST /api/admin/ingest-threatened on the production server to
// fast-track occurrence data for threatened species before the cursor
// reaches them naturally (can take weeks at 3 species/tick).
//
// Override any value via env vars without code changes:
//   BG_INGEST_INTERVAL_MS      default 30 000 ms
//   BG_INGEST_SPECIES_PER_TICK default 3
//   BG_INGEST_MAX_TICKS_PER_DAY default 0 (= unlimited)
const TICK_INTERVAL_MS = Number(process.env["BG_INGEST_INTERVAL_MS"] ?? 30_000);
const SPECIES_PER_TICK = Number(process.env["BG_INGEST_SPECIES_PER_TICK"] ?? 3);
const MAX_TICKS_PER_DAY = Number(process.env["BG_INGEST_MAX_TICKS_PER_DAY"] ?? 0);
const PAGE_SIZE = 100;
const STARTUP_DELAY_MS = 30_000;
const BACKGROUND_MODE = process.env["BG_INGEST_MODE"] ?? "interval";

let timer: NodeJS.Timeout | null = null;
let running = false;

export type IngestResult =
  | { ran: true; processedSpecies: number; totalOccurrences: number }
  | {
      ran: false;
      reason: "already_running" | "daily_quota_reached" | "database_unavailable";
    };

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function parseCursor(checkpoint: string | null): number {
  if (!checkpoint) return 0;

  if (checkpoint.startsWith("v2:")) {
    try {
      const state = JSON.parse(checkpoint.slice(3)) as { cursor?: unknown };
      const cursor = Number(state.cursor);
      return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
    } catch {
      return 0;
    }
  }

  // Preserve progress from logs written before the durable state format.
  const legacyMatch = checkpoint.match(/^\s*(\d+)/);
  return legacyMatch ? Number(legacyMatch[1]) : 0;
}

async function loadPersistentState(): Promise<{ cursor: number; dailyTicks: number }> {
  const [cursorResult, quotaResult] = await Promise.all([
    db.execute<{ checkpoint: string | null }>(sql`
      SELECT checkpoint
      FROM gbif_sync_log
      WHERE sync_type = 'background_occurrences'
        AND status = 'success'
      ORDER BY id DESC
      LIMIT 1
    `),
    db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM gbif_sync_log
      WHERE sync_type = 'background_occurrences'
        AND started_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
        AND status IN ('running', 'success', 'error')
    `),
  ]);

  return {
    cursor: parseCursor(cursorResult.rows[0]?.checkpoint ?? null),
    dailyTicks: Number(quotaResult.rows[0]?.count ?? 0),
  };
}

export async function ingestOnce(): Promise<IngestResult> {
  if (running) return { ran: false, reason: "already_running" };

  const day = utcDayKey(new Date());
  let state: { cursor: number; dailyTicks: number };
  try {
    state = await withDbRetry(loadPersistentState);
  } catch (err) {
    logger.warn({ err }, "[ingest] could not load persistent ingest state");
    return { ran: false, reason: "database_unavailable" };
  }

  if (MAX_TICKS_PER_DAY > 0 && state.dailyTicks >= MAX_TICKS_PER_DAY) {
    logger.info(
      { day, maxTicksPerDay: MAX_TICKS_PER_DAY },
      "[ingest] persistent daily quota reached",
    );
    return { ran: false, reason: "daily_quota_reached" };
  }

  running = true;
  const dailyTick = state.dailyTicks + 1;
  let cursor = state.cursor;

  const startedAt = new Date();
  let logId: number | undefined;
  let processedSpecies = 0;
  let totalOcc = 0;
  const countryStats = new Map<string, { occ: number; species: Set<number> }>();

  try {
    // Create the log row inside try/catch — if Neon endpoint is suspended on
    // first query the error must be caught here, not bubble up as an unhandled
    // rejection that would crash the process.
    try {
      const [logRow] = await withDbRetry(() =>
        db
          .insert(gbifSyncLog)
          .values({
            syncType: "background_occurrences",
            status: "running",
            checkpoint: `v2:${JSON.stringify({ cursor, day, tick: dailyTick })}`,
            startedAt,
          })
          .returning({ id: gbifSyncLog.id }),
      );
      logId = logRow?.id;
    } catch (logErr) {
      logger.warn({ err: logErr }, "[ingest] could not create log row, continuing tick without log");
    }
    const species = await db
      .select({
        taxonKey: gbifTaxa.taxonKey,
        canonicalName: gbifTaxa.canonicalName,
      })
      .from(gbifTaxa)
      .where(gt(gbifTaxa.taxonKey, cursor))
      .orderBy(asc(gbifTaxa.taxonKey))
      .limit(SPECIES_PER_TICK);

    if (species.length === 0) {
      cursor = 0;
      logger.info("[ingest] reached end, restarting from cursor 0");
    } else {
      cursor = species[species.length - 1]!.taxonKey;
    }

    for (const { taxonKey } of species) {
      try {
        const result = await searchOccurrences({
          taxonKey,
          hasCoordinate: true,
          limit: PAGE_SIZE,
          offset: 0,
        });

        for (const occ of result.results) {
          if (!occ.countryCode || !occ.key) continue;
          const cc = occ.countryCode.slice(0, 2);
          const stat = countryStats.get(cc) ?? { occ: 0, species: new Set<number>() };
          stat.occ++;
          stat.species.add(taxonKey);
          countryStats.set(cc, stat);
          totalOcc++;

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
        }
        processedSpecies++;
      } catch (err) {
        logger.warn(
          { err, taxonKey },
          "[ingest] failed to fetch occurrences for taxon",
        );
      }
    }

    for (const [cc, stat] of countryStats.entries()) {
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
    }

    // Incrementally upsert INHABITS edges for species processed in this tick.
    // This keeps the KG in sync with occurrence data as ingest runs, so
    // endangered-hotspot queries stay accurate without a full KG rebuild.
    if (species.length > 0) {
      const taxonKeys = species.map((s) => s.taxonKey);
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
    }

    if (logId !== undefined) {
      const stateCheckpoint = `v2:${JSON.stringify({
        cursor,
        day,
        tick: dailyTick,
      })}`;
      await db.execute(sql`
        UPDATE gbif_sync_log
        SET status = 'success',
            records_processed = ${totalOcc},
            checkpoint = ${stateCheckpoint},
            finished_at = NOW()
        WHERE id = ${logId}
      `);
    }
    logger.info(
      {
        processedSpecies,
        totalOcc,
        cursor,
        countries: countryStats.size,
        dailyTicks: dailyTick,
        maxTicksPerDay: MAX_TICKS_PER_DAY,
      },
      "[ingest] tick complete",
    );

    if (MAX_TICKS_PER_DAY > 0 && dailyTick === MAX_TICKS_PER_DAY) {
      logger.info(
        { day, maxTicksPerDay: MAX_TICKS_PER_DAY },
        "[ingest] daily free-tier budget reached — sleeping until UTC midnight",
      );
      await db
        .insert(gbifSyncLog)
        .values({
          syncType: "background_occurrences",
          status: "budget_exhausted",
            checkpoint: `daily cap ${MAX_TICKS_PER_DAY} reached on ${day}`,
          startedAt: new Date(),
          finishedAt: new Date(),
        })
        .catch(() => undefined);
    }
    return {
      ran: true,
      processedSpecies,
      totalOccurrences: totalOcc,
    };
  } catch (err) {
    logger.error({ err }, "[ingest] tick failed");
    if (logId !== undefined) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .execute(
          sql`
          UPDATE gbif_sync_log
          SET status = 'error',
              error_message = ${message.slice(0, 500)},
              finished_at = NOW()
          WHERE id = ${logId}
        `,
        )
        .catch(() => undefined);
    }
    return {
      ran: true,
      processedSpecies,
      totalOccurrences: totalOcc,
    };
  } finally {
    running = false;
  }
}

export function startBackgroundIngest(): void {
  if (timer) return;
  if (process.env["DISABLE_BG_INGEST"] !== "0") {
    logger.info("[ingest] disabled by default (set DISABLE_BG_INGEST=0 to enable)");
    return;
  }
  if (BACKGROUND_MODE === "scheduled") {
    logger.info(
      "[ingest] scheduled mode enabled — waiting for authenticated /api/admin/ingest-batch calls",
    );
    return;
  }

  logger.info(
    {
      intervalMs: TICK_INTERVAL_MS,
      mode: BACKGROUND_MODE,
      speciesPerTick: SPECIES_PER_TICK,
      maxTicksPerDay: MAX_TICKS_PER_DAY,
      estMaxRequestsPerDay: MAX_TICKS_PER_DAY * SPECIES_PER_TICK,
      estMaxOccurrencesPerDay: MAX_TICKS_PER_DAY * SPECIES_PER_TICK * PAGE_SIZE,
    },
    "[ingest] background occurrence ingestion scheduled (free-tier capped)",
  );

  setTimeout(() => {
    void ingestOnce();
    timer = setInterval(() => {
      void ingestOnce();
    }, TICK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

export function stopBackgroundIngest(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
