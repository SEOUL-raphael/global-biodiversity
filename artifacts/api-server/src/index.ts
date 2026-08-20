import app from "./app";
import { logger } from "./lib/logger";
import { startBackgroundIngest } from "./jobs/ingest";
import { startBackgroundEnrich } from "./jobs/enrich";
import { ensureEncoderReady } from "./lib/embed";
import { pool, runMigrations } from "@workspace/db";
import path from "path";
import { fileURLToPath } from "url";

// Resolve migrations folder relative to this compiled bundle.
// Works in both tsx (dev) and esbuild output (prod) because
// import.meta.url always points to the current file's location.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "../../../lib/db/migrations");

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  void (async () => {
    // 1. Wake up DB endpoint (Neon auto-suspends after ~5 min of inactivity)
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const client = await pool.connect();
        await client.query("SELECT 1");
        client.release();
        logger.info({ attempt }, "[db] endpoint awake");
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ attempt, msg }, "[db] wake-up ping failed, retrying...");
        await new Promise((r) => setTimeout(r, 2_000 * attempt));
      }
    }

    // 2. Apply pending migrations — creates all tables on a fresh/empty DB,
    //    and is a no-op if all migrations have already been applied.
    try {
      await runMigrations(MIGRATIONS_DIR);
      logger.info("[db] migrations applied");
    } catch (err) {
      logger.error({ err }, "[db] migration failed — skipping background jobs");
      return;
    }

    // 3. Start background data jobs only after schema is confirmed ready
    startBackgroundIngest();
    startBackgroundEnrich();
  })();

  // Warm the sentence-embedding encoder eagerly so the first
  // /api/ai/ask call that uses semantic_search_species doesn't pay
  // the ~30s ONNX cold-start penalty inside the OpenAI tool loop.
  void ensureEncoderReady();
});
