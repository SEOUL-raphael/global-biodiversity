/**
 * seed-gbif-expanded.ts
 * 추가 적재: 주요 척추동물/균류/식물 family + 대량 발생 데이터
 * 실행 순서: seed-gbif-targeted 이후
 */
import { db, gbifTaxa, gbifOccurrences, gbifRegions } from "@workspace/db";
import {
  searchSpecies,
  searchOccurrences,
  type GbifTaxon as GbifApiTaxon,
} from "@workspace/gbif-client";
import { sql, desc, and, gt } from "drizzle-orm";

// GBIF API로 검증된 family key 목록
const EXTRA_FAMILIES: Array<{ name: string; key: number }> = [
  // 포유류
  { name: "Muridae",         key: 5510  }, // 쥐과
  { name: "Cervidae",        key: 5298  }, // 사슴과
  { name: "Bovidae",         key: 9614  }, // 소과
  { name: "Rhinocerotidae",  key: 9415  }, // 코뿔소과
  { name: "Suidae",          key: 5302  }, // 돼지과
  { name: "Equidae",         key: 5479  }, // 말과
  { name: "Otariidae",       key: 5309  }, // 바다사자과
  { name: "Phocidae",        key: 5310  }, // 물범과
  { name: "Pteropodidae",    key: 9367  }, // 과일박쥐과
  { name: "Vespertilionidae",key: 9368  }, // 애기박쥐과
  { name: "Lemuridae",       key: 5485  }, // 여우원숭이과
  { name: "Callitrichidae",  key: 9620  }, // 마모셋과
  { name: "Cercopithecidae", key: 9622  }, // 구세계원숭이과
  { name: "Delphinidae",     key: 5314  }, // 돌고래과
  { name: "Balaenopteridae", key: 5313  }, // 수염고래과
  // 조류
  { name: "Falconidae",      key: 5240  }, // 매과
  { name: "Psittacidae",     key: 9340  }, // 앵무새과
  { name: "Strigidae",       key: 9348  }, // 올빼미과
  { name: "Ardeidae",        key: 3685  }, // 왜가리과
  { name: "Anatidae",        key: 2986  }, // 오리과
  { name: "Corvidae",        key: 5235  }, // 까마귀과
  { name: "Spheniscidae",    key: 5284  }, // 펭귄과
  { name: "Gruidae",         key: 9313  }, // 두루미과
  { name: "Columbidae",      key: 5233  }, // 비둘기과
  { name: "Trochilidae",     key: 5289  }, // 벌새과
  { name: "Picidae",         key: 9333  }, // 딱따구리과
  // 파충류
  { name: "Crocodylidae",    key: 5685  }, // 악어과
  { name: "Viperidae",       key: 5024  }, // 살모사과
  { name: "Colubridae",      key: 6172  }, // 뱀과
  { name: "Gekkonidae",      key: 5666  }, // 도마뱀붙이과
  { name: "Cheloniidae",     key: 9413  }, // 바다거북과
  { name: "Testudinidae",    key: 9618  }, // 육지거북과
  // 양서류
  { name: "Ranidae",         key: 6746  }, // 개구리과
  { name: "Bufonidae",       key: 6727  }, // 두꺼비과
  { name: "Hylidae",         key: 6735  }, // 청개구리과
  { name: "Salamandridae",   key: 6750  }, // 도롱뇽과
  // 어류
  { name: "Scombridae",      key: 8596  }, // 고등어과 (참치)
  { name: "Cichlidae",       key: 8522  }, // 시클리드과
  { name: "Carcharhinidae",  key: 2211  }, // 흉상어과
  // 균류
  { name: "Amanitaceae",     key: 4171  }, // 광대버섯과
  { name: "Boletaceae",      key: 8789  }, // 그물버섯과
  { name: "Polyporaceae",    key: 3286  }, // 구멍장이버섯과
  // 식물 추가
  { name: "Lamiaceae",       key: 2497  }, // 꿀풀과
  { name: "Apiaceae",        key: 6720  }, // 미나리과
  { name: "Solanaceae",      key: 7717  }, // 가지과
  { name: "Pinaceae",        key: 3925  }, // 소나무과
  { name: "Cactaceae",       key: 2519  }, // 선인장과
  { name: "Euphorbiaceae",   key: 4691  }, // 대극과
  { name: "Ranunculaceae",   key: 2410  }, // 미나리아재비과
  { name: "Liliaceae",       key: 7699  }, // 백합과
  { name: "Moraceae",        key: 6640  }, // 뽕나무과
];

async function upsertTaxon(taxon: GbifApiTaxon): Promise<void> {
  const iucnStatus = taxon.iucnRedListCategory ?? (taxon.threatStatuses?.[0] ?? null);
  await db
    .insert(gbifTaxa)
    .values({
      taxonKey: taxon.key,
      parentKey: taxon.parentKey ?? null,
      rank: taxon.rank ?? "UNRANKED",
      kingdom: taxon.kingdom ?? null,
      phylum: taxon.phylum ?? null,
      class: taxon.class ?? null,
      order: taxon.order ?? null,
      family: taxon.family ?? null,
      genus: taxon.genus ?? null,
      species: taxon.species ?? null,
      scientificName: taxon.scientificName,
      canonicalName: taxon.canonicalName ?? null,
      vernacularName: taxon.vernacularName ?? null,
      iucnStatus: iucnStatus ?? null,
      numOccurrences: taxon.numOccurrences ?? 0,
      extinct: taxon.extinct != null ? String(taxon.extinct) : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: gbifTaxa.taxonKey,
      set: {
        parentKey: sql`excluded.parent_key`,
        rank: sql`excluded.rank`,
        kingdom: sql`excluded.kingdom`,
        phylum: sql`excluded.phylum`,
        class: sql`excluded.class`,
        order: sql`excluded.order`,
        family: sql`excluded.family`,
        genus: sql`excluded.genus`,
        species: sql`excluded.species`,
        scientificName: sql`excluded.scientific_name`,
        canonicalName: sql`excluded.canonical_name`,
        vernacularName: sql`excluded.vernacular_name`,
        iucnStatus: sql`excluded.iucn_status`,
        numOccurrences: sql`excluded.num_occurrences`,
        extinct: sql`excluded.extinct`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

async function seedFamily(family: { name: string; key: number }): Promise<number> {
  let total = 0;
  let offset = 0;
  process.stdout.write(`  [${family.name}] `);

  while (offset < 5000) {
    try {
      const page = await searchSpecies({
        highertaxonKey: family.key,
        rank: "SPECIES",
        status: "ACCEPTED",
        limit: 100,
        offset,
      });

      for (const taxon of page.results) {
        await upsertTaxon(taxon);
        total++;
      }

      if (page.endOfRecords || page.results.length === 0) break;
      offset += 100;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") || msg.includes("400")) break;
      console.error(`\n  Error at ${family.name} offset ${offset}:`, msg.slice(0, 80));
      await new Promise((r) => setTimeout(r, 2000));
      if (offset === 0) break;
    }
  }

  console.log(`${total} species`);
  return total;
}

async function seedFungi(): Promise<number> {
  console.log("\n[Fungi kingdom] Fetching up to 10000 species...");
  let total = 0;
  let offset = 0;

  while (offset < 10000) {
    try {
      const page = await searchSpecies({
        highertaxonKey: 5, // Fungi kingdom
        rank: "SPECIES",
        status: "ACCEPTED",
        limit: 100,
        offset,
      });

      for (const taxon of page.results) {
        await upsertTaxon(taxon);
        total++;
      }

      if (total % 1000 === 0 && total > 0) process.stdout.write(`${total}... `);
      if (page.endOfRecords || page.results.length === 0) break;
      offset += 100;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") || msg.includes("400")) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`\n  Done: ${total} Fungi species`);
  return total;
}

// 발생 데이터 대량 적재 — numOccurrences > 50인 종 대상, 각 종 최대 300건
async function seedOccurrencesBulk(): Promise<void> {
  console.log("\n[Occurrences] Bulk seeding (numOccurrences > 50, up to 300 per species)...");

  const targetSpecies = await db
    .select({ taxonKey: gbifTaxa.taxonKey, canonicalName: gbifTaxa.canonicalName })
    .from(gbifTaxa)
    .where(and(gt(gbifTaxa.numOccurrences, 50)))
    .orderBy(desc(gbifTaxa.numOccurrences))
    .limit(5000);

  console.log(`  Target: ${targetSpecies.length} species`);

  const countryStats: Record<string, { occ: number; species: Set<number> }> = {};
  let processed = 0;
  let totalOcc = 0;
  let errors = 0;

  for (const { taxonKey, canonicalName } of targetSpecies) {
    try {
      for (let pageIdx = 0; pageIdx < 3; pageIdx++) {
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
      if (processed % 250 === 0) {
        console.log(`  [${processed}/${targetSpecies.length}] ${totalOcc} occurrences, ${Object.keys(countryStats).length} countries`);
      }
    } catch (err) {
      errors++;
      if (errors <= 5) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n  Error for ${taxonKey} (${canonicalName}):`, msg.slice(0, 80));
      }
      if (errors > 100) {
        console.error("  Too many errors, stopping");
        break;
      }
    }
  }

  console.log(`\n  Done: ${processed} species processed, ${totalOcc} occurrences, ${errors} errors`);

  // 지역 통계 upsert
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
  console.log(`  Regions updated: ${Object.keys(countryStats).length} countries`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");

  console.log("=== GBIF Expanded Seeding ===");

  // Phase 1: 추가 family 종 데이터
  console.log("\n[Phase 1] Extra families...");
  let familyTotal = 0;
  for (const family of EXTRA_FAMILIES) {
    familyTotal += await seedFamily(family);
  }
  console.log(`Phase 1 done: ${familyTotal} additional species`);

  // Phase 2: Fungi 왕국
  await seedFungi();

  // Phase 3: 발생 데이터 대량 적재
  await seedOccurrencesBulk();

  // 최종 통계
  const stats = await db.execute<{ taxa: string; occ: string; regions: string }>(sql`
    SELECT
      (SELECT count(*)::text FROM gbif_taxa) AS taxa,
      (SELECT count(*)::text FROM gbif_occurrences) AS occ,
      (SELECT count(*)::text FROM gbif_regions) AS regions
  `);
  const s = stats.rows[0];
  console.log(`\n=== Complete: taxa=${s?.taxa}, occurrences=${s?.occ}, regions=${s?.regions} ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
