/**
 * seed-occurrences-v2.ts
 * Animalia 전 종 + Plantae 주요 종 대상 발생 데이터 대량 적재
 * - numOccurrences 필터 없음 (DB값 전부 0이므로)
 * - Animalia 우선, 그 다음 Plantae 샘플
 * - 종당 최대 200건 (2 pages × 100)
 */
import { db, gbifTaxa, gbifOccurrences, gbifRegions } from "@workspace/db";
import { searchOccurrences } from "@workspace/gbif-client";
import { sql, eq, inArray } from "drizzle-orm";

const PAGES_PER_SPECIES = 2; // 종당 최대 200건

async function loadOccurrences(
  species: Array<{ taxonKey: number; canonicalName: string | null }>,
  label: string,
): Promise<{ occ: number; countries: Set<string> }> {
  const countryStats: Record<string, { occ: number; species: Set<number> }> = {};
  let processed = 0;
  let totalOcc = 0;
  let errors = 0;

  for (const { taxonKey, canonicalName } of species) {
    try {
      for (let pageIdx = 0; pageIdx < PAGES_PER_SPECIES; pageIdx++) {
        const result = await searchOccurrences({
          taxonKey,
          hasCoordinate: true,
          limit: 100,
          offset: pageIdx * 100,
        });

        for (const occ of result.results) {
          if (!occ.countryCode || !occ.key) continue;
          totalOcc++;
          const cc = occ.countryCode.slice(0, 2);
          if (!countryStats[cc]) countryStats[cc] = { occ: 0, species: new Set() };
          countryStats[cc].occ++;
          countryStats[cc].species.add(taxonKey);

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

        if (result.endOfRecords || result.results.length === 0) break;
      }

      processed++;
      if (processed % 200 === 0 || processed === species.length) {
        process.stdout.write(
          `  [${label}] ${processed}/${species.length} species, ${totalOcc} occ, ${Object.keys(countryStats).length} countries, err:${errors}\n`,
        );
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`  Error taxon ${taxonKey} (${canonicalName}): ${msg.slice(0, 80)}\n`);
      }
      if (errors > 150) {
        process.stderr.write("  Too many errors, stopping this batch\n");
        break;
      }
    }
  }

  // 지역 통계 업데이트
  for (const [code, stats] of Object.entries(countryStats)) {
    await db
      .insert(gbifRegions)
      .values({
        countryCode: code,
        countryName: code,
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

  process.stdout.write(`  [${label}] Done: ${processed} species, ${totalOcc} occ, ${Object.keys(countryStats).length} countries\n`);
  return { occ: totalOcc, countries: new Set(Object.keys(countryStats)) };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
  process.stdout.write("=== GBIF Occurrence Seeding V2 ===\n");

  // Animalia 전 종 (현재 7,689개)
  const animalia = await db
    .select({ taxonKey: gbifTaxa.taxonKey, canonicalName: gbifTaxa.canonicalName })
    .from(gbifTaxa)
    .where(eq(gbifTaxa.kingdom, "Animalia"));
  process.stdout.write(`Animalia: ${animalia.length} species\n`);

  const animaliaResult = await loadOccurrences(animalia, "Animalia");

  // Plantae 샘플 (taxonKey 기준 2000개 샘플 — 랜덤 대신 균등 분산)
  const plantaeSample = await db
    .select({ taxonKey: gbifTaxa.taxonKey, canonicalName: gbifTaxa.canonicalName })
    .from(gbifTaxa)
    .where(eq(gbifTaxa.kingdom, "Plantae"))
    .limit(2000);
  process.stdout.write(`\nPlantae sample: ${plantaeSample.length} species\n`);

  const plantaeResult = await loadOccurrences(plantaeSample, "Plantae");

  const totalOcc = animaliaResult.occ + plantaeResult.occ;
  const finalStats = await db.execute<{ occ: string; regions: string }>(sql`
    SELECT
      (SELECT count(*)::text FROM gbif_occurrences) AS occ,
      (SELECT count(*)::text FROM gbif_regions) AS regions
  `);
  const s = finalStats.rows[0];
  process.stdout.write(`\n=== Done: total_occ=${s?.occ}, regions=${s?.regions} ===\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
