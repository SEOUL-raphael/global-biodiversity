import { db, withDbRetry } from "@workspace/db";
import { gbifTaxa } from "@workspace/db/schema";
import { sql, eq, and, isNull, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { fetchDescription } from "../lib/description-source";
import { embed, EMBED_MODEL, ensureEncoderReady } from "../lib/embed";
import { invalidateSemanticCache } from "../lib/semantic-search";

// Free-tier safe pacing. Runs in parallel with the occurrence ingest job.
// Embedding uses a local CPU model (Xenova/all-MiniLM-L6-v2) — zero API cost.
// Description fetch hits Wikipedia/GBIF REST APIs: paced conservatively.
// 3 species per 5s → up to ~5 000/day (capped by MAX_PER_DAY).
const TICK_INTERVAL_MS = Number(process.env["BG_ENRICH_INTERVAL_MS"] ?? 5_000);
const PER_TICK = Number(process.env["BG_ENRICH_PER_TICK"] ?? 3);
const MAX_PER_DAY = Number(process.env["BG_ENRICH_MAX_PER_DAY"] ?? 5_000);
const STARTUP_DELAY_MS = 45_000;

let timer: NodeJS.Timeout | null = null;
let running = false;
let dailyCount = 0;
let dailyDateKey = utcDayKey(new Date());
let encoderReady = false;
let stats = {
  processed: 0,
  describedTotal: 0,
  embeddedTotal: 0,
  skipped: 0,
  failures: 0,
  lastTickAt: null as Date | null,
  lastError: null as string | null,
};

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function ensureDailyWindow(): void {
  const today = utcDayKey(new Date());
  if (today !== dailyDateKey) {
    dailyDateKey = today;
    dailyCount = 0;
    logger.info({ day: today }, "[enrich] daily quota window reset");
  }
}

async function pickCandidate(): Promise<{ taxonKey: number; canonicalName: string; description: string | null } | null> {
  // Priority: rows missing description first, then rows with description but no embedding.
  const rows = await withDbRetry(() => db
    .select({
      taxonKey: gbifTaxa.taxonKey,
      canonicalName: gbifTaxa.canonicalName,
      description: gbifTaxa.description,
      embedding: gbifTaxa.embedding,
    })
    .from(gbifTaxa)
    .where(
      and(
        sql`${gbifTaxa.canonicalName} IS NOT NULL AND length(${gbifTaxa.canonicalName}) > 1`,
        or(isNull(gbifTaxa.descriptionFetchedAt), isNull(gbifTaxa.embeddingUpdatedAt)),
        sql`${gbifTaxa.descriptionSource} IS DISTINCT FROM 'none'`,
      ),
    )
    .orderBy(
      sql`CASE WHEN ${gbifTaxa.descriptionFetchedAt} IS NULL THEN 0 ELSE 1 END`,
      sql`${gbifTaxa.numOccurrences} DESC`,
    )
    .limit(1));
  const r = rows[0];
  if (!r) return null;
  return {
    taxonKey: r.taxonKey,
    canonicalName: r.canonicalName ?? "",
    description: r.description,
  };
}

async function enrichOnce(): Promise<void> {
  if (running) return;
  ensureDailyWindow();
  if (dailyCount >= MAX_PER_DAY) return;
  if (!encoderReady) {
    encoderReady = await ensureEncoderReady();
    if (!encoderReady) return;
  }

  running = true;
  try {
    for (let i = 0; i < PER_TICK; i++) {
      if (dailyCount >= MAX_PER_DAY) break;
      const cand = await pickCandidate();
      if (!cand) {
        // Nothing left to do — stay idle until new taxa arrive.
        return;
      }

      let description = cand.description;
      let source: "gbif" | "wikipedia" | "existing" | null = description ? "existing" : null;

      if (!description) {
        const fetched = await fetchDescription(cand.taxonKey, cand.canonicalName);
        if (fetched) {
          description = fetched.text;
          source = fetched.source;
          await db
            .update(gbifTaxa)
            .set({
              description,
              descriptionSource: fetched.source,
              descriptionFetchedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(gbifTaxa.taxonKey, cand.taxonKey));
          stats.describedTotal++;
        } else {
          // No description available — stamp BOTH timestamps so this row
          // exits the candidate query and is not retried (it would burn
          // the daily quota with no chance of progress).
          const now = new Date();
          await db
            .update(gbifTaxa)
            .set({
              descriptionFetchedAt: now,
              descriptionSource: "none",
              embeddingUpdatedAt: now,
              embeddingModel: "none",
              updatedAt: now,
            })
            .where(eq(gbifTaxa.taxonKey, cand.taxonKey));
          stats.skipped++;
        }
      }

      if (description) {
        try {
          const corpus = `${cand.canonicalName}. ${description}`;
          const vec = await embed(corpus);
          await db
            .update(gbifTaxa)
            .set({
              embedding: vec,
              embeddingModel: EMBED_MODEL,
              embeddingUpdatedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(gbifTaxa.taxonKey, cand.taxonKey));
          stats.embeddedTotal++;
          invalidateSemanticCache();
        } catch (err) {
          stats.failures++;
          stats.lastError = err instanceof Error ? err.message : String(err);
          logger.warn({ err, taxonKey: cand.taxonKey }, "[enrich] embedding failed");
        }
      }

      stats.processed++;
      dailyCount++;
      stats.lastTickAt = new Date();
      logger.info(
        {
          taxonKey: cand.taxonKey,
          name: cand.canonicalName,
          source,
          described: !!description,
          dailyCount,
          maxPerDay: MAX_PER_DAY,
        },
        "[enrich] processed",
      );
    }
  } catch (err) {
    stats.failures++;
    stats.lastError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[enrich] tick failed");
  } finally {
    running = false;
  }
}

export function startBackgroundEnrich(): void {
  if (timer) return;
  if (process.env["DISABLE_BG_ENRICH"] !== "0") {
    logger.info("[enrich] disabled by default (set DISABLE_BG_ENRICH=0 to enable)");
    return;
  }
  if (!process.env["DATABASE_URL"]) {
    logger.warn("[enrich] DATABASE_URL not set — background enrich disabled");
    return;
  }
  logger.info(
    { intervalMs: TICK_INTERVAL_MS, perTick: PER_TICK, maxPerDay: MAX_PER_DAY },
    "[enrich] background description+embedding enrichment scheduled",
  );
  setTimeout(() => {
    void enrichOnce();
    timer = setInterval(() => void enrichOnce(), TICK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

export function getEnrichStats() {
  return { ...stats, dailyCount, maxPerDay: MAX_PER_DAY, model: EMBED_MODEL };
}

export function stopBackgroundEnrich(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
