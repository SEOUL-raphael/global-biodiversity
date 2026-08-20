import { db, gbifOccurrences, gbifRegions } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  console.log("=== Updating GBIF Regions from Occurrences ===");

  const stats = await db.execute(sql`
    SELECT
      country_code,
      COUNT(*) AS occ_count,
      COUNT(DISTINCT taxon_key) AS species_count
    FROM gbif_occurrences
    WHERE country_code IS NOT NULL AND length(country_code) = 2
    GROUP BY country_code
    ORDER BY occ_count DESC
  `);

  console.log(`Found ${stats.rows.length} countries in occurrence data`);

  for (const row of stats.rows) {
    const code = String(row.country_code);
    const occCount = Number(row.occ_count);
    const speciesCount = Number(row.species_count);

    await db
      .insert(gbifRegions)
      .values({
        countryCode: code,
        countryName: code,
        occurrenceCount: occCount,
        speciesCount: speciesCount,
        lastSynced: new Date(),
      })
      .onConflictDoUpdate({
        target: gbifRegions.countryCode,
        set: {
          occurrenceCount: occCount,
          speciesCount: speciesCount,
          lastSynced: new Date(),
        },
      });
  }

  console.log(`Updated ${stats.rows.length} regions`);
  console.log("=== Done ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
