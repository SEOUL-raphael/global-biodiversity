import { db, gbifTaxa, gbifOccurrences, gbifRegions } from "@workspace/db";
import {
  searchSpecies,
  searchOccurrences,
  type GbifTaxon as GbifApiTaxon,
} from "@workspace/gbif-client";
import { eq, sql, desc, and, gt, inArray } from "drizzle-orm";

const PRIORITY_FAMILIES = [
  { name: "Felidae", key: 9703 },
  { name: "Canidae", key: 9701 },
  { name: "Ursidae", key: 9754 },
  { name: "Elephantidae", key: 9783 },
  { name: "Hominidae", key: 9676 },
  { name: "Cetacea", key: 7193 },
  { name: "Accipitridae", key: 2964 },
  { name: "Orchidaceae", key: 7717 },
  { name: "Asteraceae", key: 3065 },
  { name: "Rosaceae", key: 3753 },
  { name: "Fabaceae", key: 5386 },
  { name: "Poaceae", key: 3073 },
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

async function seedSpeciesForFamily(
  family: { name: string; key: number },
): Promise<number> {
  let total = 0;
  let offset = 0;
  const pageSize = 100;

  console.log(`  Seeding species for ${family.name}...`);
  while (true) {
    try {
      const page = await searchSpecies({
        highertaxonKey: family.key,
        rank: "SPECIES",
        status: "ACCEPTED",
        limit: pageSize,
        offset,
      });

      for (const taxon of page.results) {
        await upsertTaxon(taxon);
        total++;
      }

      if (page.endOfRecords || offset + pageSize >= 10000) break;
      offset += pageSize;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404")) break;
      console.error(`  Error at offset ${offset}:`, msg);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  console.log(`    -> ${total} species loaded for ${family.name}`);
  return total;
}

async function seedBroadSpecies(): Promise<number> {
  console.log("\n[Broad Species] Fetching SPECIES across Animalia & Plantae...");
  let total = 0;

  for (const kingdomKey of [1, 6]) {
    const kingdomName = kingdomKey === 1 ? "Animalia" : "Plantae";
    let offset = 0;

    while (offset < 5000) {
      try {
        const page = await searchSpecies({
          highertaxonKey: kingdomKey,
          rank: "SPECIES",
          status: "ACCEPTED",
          limit: 100,
          offset,
        });

        for (const taxon of page.results) {
          await upsertTaxon(taxon);
          total++;
        }

        if (page.endOfRecords) break;
        offset += 100;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("404")) break;
        console.error(`  Error at ${kingdomName} offset ${offset}:`, msg);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    console.log(`  ${kingdomName}: loaded up to offset ${offset}`);
  }

  return total;
}

async function seedOccurrencesForTopSpecies(): Promise<void> {
  console.log("\n[Occurrences] Fetching for top species...");

  const topSpecies = await db
    .select({ taxonKey: gbifTaxa.taxonKey, canonicalName: gbifTaxa.canonicalName })
    .from(gbifTaxa)
    .where(
      and(
        eq(gbifTaxa.rank, "SPECIES"),
        gt(gbifTaxa.numOccurrences, 100),
      ),
    )
    .orderBy(desc(gbifTaxa.numOccurrences))
    .limit(200);

  console.log(`  Processing ${topSpecies.length} top species...`);

  const countryStats: Record<string, { occ: number; species: Set<number> }> = {};

  for (const { taxonKey, canonicalName } of topSpecies) {
    try {
      let offset = 0;
      let fetched = 0;
      while (offset < 300) {
        const page = await searchOccurrences({
          taxonKey,
          hasCoordinate: true,
          limit: 100,
          offset,
        });

        for (const occ of page.results) {
          if (!occ.countryCode || !occ.key) continue;
          fetched++;

          if (!countryStats[occ.countryCode]) {
            countryStats[occ.countryCode] = { occ: 0, species: new Set() };
          }
          countryStats[occ.countryCode].occ++;
          countryStats[occ.countryCode].species.add(taxonKey);

          await db
            .insert(gbifOccurrences)
            .values({
              gbifKey: occ.key,
              taxonKey: occ.taxonKey ?? taxonKey,
              countryCode: occ.countryCode ?? null,
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

        if (page.endOfRecords) break;
        offset += 100;
      }

      if (fetched > 0) {
        process.stdout.write(".");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("404")) {
        console.error(`  Error for taxon ${taxonKey} (${canonicalName}):`, msg);
      }
    }
  }

  console.log("\n  Updating region statistics...");
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
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  console.log("=== GBIF Targeted Species Seeding ===");

  console.log("\n[Priority Families] Loading key species...");
  let familyTotal = 0;
  for (const family of PRIORITY_FAMILIES) {
    familyTotal += await seedSpeciesForFamily(family);
  }
  console.log(`\nPriority families done: ${familyTotal} species`);

  const broadTotal = await seedBroadSpecies();
  console.log(`\nBroad species done: ${broadTotal} additional species`);

  await seedOccurrencesForTopSpecies();

  console.log("\n=== Targeted seeding complete ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
