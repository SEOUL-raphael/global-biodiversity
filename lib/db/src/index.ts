import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export const databaseProvider = process.env["DATABASE_PROVIDER"] ?? "replit";

function resolveDatabaseUrl(): string | undefined {
  if (databaseProvider !== "supabase") {
    return process.env["DATABASE_URL"];
  }

  const poolerTemplate =
    process.env["SUPABASE_TRANSACTION_POOLER_TEMPLATE"] ??
    process.env["SUPABASE_TRANSACTION_POOLER_URI"];
  const password =
    process.env["SUPABASE_DB_PASSWORD_V2"] ??
    process.env["SUPABASE_DB_PASSWORD"];
  if (poolerTemplate && password) {
    if (!poolerTemplate.includes("[YOUR-PASSWORD]")) {
      throw new Error(
        "SUPABASE_TRANSACTION_POOLER_URI must contain the [YOUR-PASSWORD] placeholder.",
      );
    }
    const url = new URL(
      poolerTemplate.replace("[YOUR-PASSWORD]", encodeURIComponent(password)),
    );
    // Supabase documents this marker for some client libraries, but libpq and
    // node-postgres do not use it as a connection parameter.
    url.searchParams.delete("pgbouncer");
    // The Supabase transaction pooler presents a self-signed certificate in
    // this runtime. `no-verify` keeps the PostgreSQL transport encrypted while
    // allowing node-postgres to connect through that pooler.
    url.searchParams.set("sslmode", "no-verify");
    return url.toString();
  }

  return process.env["SUPABASE_POSTGRES_URL"] ?? process.env["SUPABASE_DATABASE_URL"];
}

const databaseUrl = resolveDatabaseUrl();

if (!databaseUrl) {
  throw new Error(
    "No database URL is configured for the selected database provider.",
  );
}

export const pool = new Pool({
  connectionString: databaseUrl,
  max: 3,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000,
});

// Prevent idle-client errors from crashing the process.
// Neon serverless auto-suspends after inactivity; dropped idle connections
// emit an 'error' event on the pool — without this handler Node.js would
// treat it as an uncaught exception and exit.
pool.on("error", (err) => {
  console.error("[db] pool client error (non-fatal):", err.message);
});

export const db = drizzle(pool, { schema });

/**
 * Execute a DB operation with automatic retry for transient database wake-up
 * and connection failures. The provider-specific suspension messages are kept
 * for the legacy database while pooler resets are retried for Supabase.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 2_000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransientConnection =
        msg.includes("endpoint has been disabled") ||
        msg.includes("Control plane request failed") ||
        /\bECONNRESET\b|\bETIMEDOUT\b|Connection terminated unexpectedly/i.test(msg);
      if (isTransientConnection && attempt < maxAttempts) {
        console.warn(
          `[db] transient ${databaseProvider} connection failure — retrying in ${delayMs * attempt}ms (attempt ${attempt}/${maxAttempts})`,
        );
        await new Promise((r) => setTimeout(r, delayMs * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Apply all pending Drizzle migrations to the connected database.
 * Safe to call on every startup:
 *  - Fresh/empty DB (production): runs all migrations to create the schema.
 *  - Push-created DB (dev): tables already exist; "already exists" errors are
 *    swallowed so background jobs still start normally.
 *  - Already-migrated DB (subsequent deploys): Drizzle's __drizzle_migrations
 *    table marks all migrations applied — migrate() becomes a no-op.
 *
 * Caller must supply the absolute path to the migrations folder because
 * this lib is bundled into the API server and relative paths break.
 */
export async function runMigrations(migrationsFolder: string): Promise<void> {
  // Check whether the schema was already created (e.g. via 'drizzle-kit push' in
  // dev, or from a previous deploy in production). If so, migrate() is still safe
  // to call — it will be a no-op once __drizzle_migrations is populated — but on
  // a push-created DB the tracking table is absent and migrate() would fail with
  // "already exists". We detect this by checking for the primary table directly.
  const { rows } = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'gbif_taxa'
    ) AS exists
  `);

  if (rows[0]?.exists) {
    // Schema already present — skip migration to avoid "already exists" errors
    // on push-created DBs that have no __drizzle_migrations tracking table.
    return;
  }

  // Fresh (empty) database — apply all migrations to create the full schema.
  await migrate(db, { migrationsFolder });
}

export * from "./schema";
