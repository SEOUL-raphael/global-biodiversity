import { db, gbifTaxa, gbifOccurrences, gbifRegions } from "@workspace/db";
import { searchOccurrences } from "@workspace/gbif-client";
import { eq, sql } from "drizzle-orm";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  console.log("=== GBIF Occurrence Seeding ===");

  const allSpecies = await db
    .select({ taxonKey: gbifTaxa.taxonKey, canonicalName: gbifTaxa.canonicalName })
    .from(gbifTaxa)
    .where(eq(gbifTaxa.rank, "SPECIES"))
    .limit(800);

  console.log(`Processing ${allSpecies.length} species...`);

  const countryStats: Record<string, { occ: number; species: Set<number> }> = {};
  let processed = 0;
  let totalOcc = 0;
  let errors = 0;

  for (const { taxonKey, canonicalName } of allSpecies) {
    try {
      const page = await searchOccurrences({
        taxonKey,
        hasCoordinate: true,
        limit: 100,
        offset: 0,
      });

      for (const occ of page.results) {
        if (!occ.countryCode || !occ.key) continue;
        totalOcc++;

        if (!countryStats[occ.countryCode]) {
          countryStats[occ.countryCode] = { occ: 0, species: new Set() };
        }
        countryStats[occ.countryCode].occ++;
        countryStats[occ.countryCode].species.add(taxonKey);

        await db
          .insert(gbifOccurrences)
          .values({
            gbifKey: occ.key,
            taxonKey,
            countryCode: occ.countryCode.slice(0, 2),
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

      processed++;
      if (processed % 100 === 0) {
        console.log(`  ${processed}/${allSpecies.length} species, ${totalOcc} occurrences, ${Object.keys(countryStats).length} countries`);
      }
    } catch (err) {
      errors++;
      if (errors <= 3) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Error for ${taxonKey} (${canonicalName}):`, msg.slice(0, 120));
      }
    }
  }

  console.log(`\nDone: ${processed} species, ${totalOcc} occurrences, ${errors} errors`);
  console.log(`Updating ${Object.keys(countryStats).length} country regions...`);

  for (const [code, stats] of Object.entries(countryStats)) {
    const safeCode = code.slice(0, 2);
    await db
      .insert(gbifRegions)
      .values({
        countryCode: safeCode,
        countryName: safeCode,
        occurrenceCount: stats.occ,
        speciesCount: stats.species.size,
        lastSynced: new Date(),
      })
      .onConflictDoUpdate({
        target: gbifRegions.countryCode,
        set: {
          occurrenceCount: sql`${gbifRegions.occurrenceCount} + ${stats.occ}`,
          speciesCount: sql`${gbifRegions.speciesCount} + ${stats.species.size}`,
          lastSynced: sql`NOW()`,
        },
      });
  }

  console.log(`\n=== Done. ${Object.keys(countryStats).length} regions updated ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
