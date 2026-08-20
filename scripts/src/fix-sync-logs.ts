import { db, gbifSyncLog, gbifTaxa } from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");

  const [taxaRow] = await db.select({ count: count() }).from(gbifTaxa);
  const taxaCount = Number(taxaRow?.count ?? 0);

  await db
    .update(gbifSyncLog)
    .set({
      status: "completed",
      recordsProcessed: taxaCount,
      finishedAt: new Date(),
    })
    .where(eq(gbifSyncLog.status, "running"));

  console.log(`Marked all running sync logs as completed. Taxa count: ${taxaCount}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
