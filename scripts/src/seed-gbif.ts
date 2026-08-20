import { db, gbifTaxa, gbifOccurrences, gbifRegions, gbifSyncLog } from "@workspace/db";
import {
  searchSpecies,
  searchOccurrences,
  type GbifTaxon as GbifApiTaxon,
} from "@workspace/gbif-client";
import { eq, sql, desc, and, gt } from "drizzle-orm";

const MAJOR_KINGDOMS: Array<{ name: string; key: number }> = [
  { name: "Animalia", key: 1 },
  { name: "Plantae", key: 6 },
  { name: "Fungi", key: 5 },
  { name: "Chromista", key: 4 },
  { name: "Protozoa", key: 7 },
  { name: "Bacteria", key: 3 },
  { name: "Archaea", key: 44 },
  { name: "Viruses", key: 8 },
];

const CHECKPOINT_FILE = "/tmp/gbif_seed_checkpoint.json";
const OCCURRENCE_MIN_RECORDS = 10;
const TAXA_RANKS = ["PHYLUM", "CLASS", "ORDER", "FAMILY", "GENUS", "SPECIES"] as const;

interface KingdomRankOffset {
  kingdom: string;
  rank: string;
  offset: number;
}

interface Checkpoint {
  processedKingdoms: string[];
  currentPosition: KingdomRankOffset | null;
  occurrencesSeeded: number[];
}

async function loadCheckpoint(): Promise<Checkpoint> {
  try {
    const { readFile } = await import("fs/promises");
    const raw = await readFile(CHECKPOINT_FILE, "utf-8");
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return { processedKingdoms: [], currentPosition: null, occurrencesSeeded: [] };
  }
}

async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  const { writeFile } = await import("fs/promises");
  await writeFile(CHECKPOINT_FILE, JSON.stringify(cp), "utf-8");
}

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

async function seedKingdom(
  kingdom: { name: string; key: number },
  checkpoint: Checkpoint,
): Promise<number> {
  console.log(`\n[${kingdom.name}] Seeding taxa...`);
  let total = 0;
  const pageSize = 100;

  for (const rank of TAXA_RANKS) {
    const resumeOffset =
      checkpoint.currentPosition?.kingdom === kingdom.name &&
      checkpoint.currentPosition?.rank === rank
        ? checkpoint.currentPosition.offset
        : 0;

    console.log(`  Fetching ${rank} level taxa for ${kingdom.name}${resumeOffset > 0 ? ` (resuming at offset ${resumeOffset})` : ""}...`);
    let offset = resumeOffset;

    while (true) {
      try {
        const page = await searchSpecies({
          highertaxonKey: kingdom.key,
          rank: rank as NonNullable<GbifApiTaxon["rank"]>,
          status: "ACCEPTED",
          limit: pageSize,
          offset,
        });

        for (const taxon of page.results) {
          await upsertTaxon(taxon);
          total++;
        }

        if (total % 500 === 0 && total > 0) {
          console.log(`  Progress: ${total} taxa saved so far...`);
          checkpoint.currentPosition = { kingdom: kingdom.name, rank, offset };
          await saveCheckpoint(checkpoint);
        }

        if (page.endOfRecords || offset + pageSize >= 200_000) break;
        offset += pageSize;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("404")) {
          console.log(`  Reached end of records (404) for ${rank} in ${kingdom.name} at offset ${offset}`);
          break;
        }
        console.error(`  Error fetching ${rank} for ${kingdom.name} at offset ${offset}:`, err);
        checkpoint.currentPosition = { kingdom: kingdom.name, rank, offset };
        await saveCheckpoint(checkpoint);
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  }

  checkpoint.currentPosition = null;
  return total;
}

async function seedOccurrenceSummary(taxonKey: number): Promise<void> {
  const countryStats: Record<string, number> = {};

  try {
    let offset = 0;
    while (offset < 3000) {
      const page = await searchOccurrences({
        taxonKey,
        hasCoordinate: true,
        limit: 300,
        offset,
      });

      for (const occ of page.results) {
        if (!occ.countryCode || !occ.key) continue;
        countryStats[occ.countryCode] = (countryStats[occ.countryCode] ?? 0) + 1;

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
      offset += 300;
    }

    for (const [code, cnt] of Object.entries(countryStats)) {
      await db
        .insert(gbifRegions)
        .values({
          countryCode: code,
          countryName: code,
          occurrenceCount: cnt,
          speciesCount: 1,
          lastSynced: new Date(),
        })
        .onConflictDoUpdate({
          target: gbifRegions.countryCode,
          set: {
            occurrenceCount: sql`${gbifRegions.occurrenceCount} + ${cnt}`,
            speciesCount: sql`${gbifRegions.speciesCount} + 1`,
            lastSynced: sql`NOW()`,
          },
        });
    }
  } catch (err) {
    console.error(`  Error fetching occurrences for taxon ${taxonKey}:`, err);
  }
}

async function seedOccurrencesForHighValueSpecies(
  checkpoint: Checkpoint,
  syncLogId: number,
  totalTaxa: number,
): Promise<number> {
  console.log("\n[Occurrences] Seeding occurrence records for species with significant records...");

  const batchSize = 50;
  let occOffset = 0;
  let occTotal = 0;

  while (true) {
    const speciesBatch = await db
      .select({ taxonKey: gbifTaxa.taxonKey })
      .from(gbifTaxa)
      .where(
        and(
          eq(gbifTaxa.rank, "SPECIES"),
          gt(gbifTaxa.numOccurrences, OCCURRENCE_MIN_RECORDS),
        ),
      )
      .orderBy(desc(gbifTaxa.numOccurrences))
      .limit(batchSize)
      .offset(occOffset);

    if (speciesBatch.length === 0) break;

    for (const { taxonKey } of speciesBatch) {
      if (checkpoint.occurrencesSeeded.includes(taxonKey)) continue;
      await seedOccurrenceSummary(taxonKey);
      checkpoint.occurrencesSeeded.push(taxonKey);
      occTotal++;

      if (occTotal % 100 === 0) {
        console.log(`  Occurrence progress: ${occTotal} species processed...`);
        await saveCheckpoint(checkpoint);
        await db
          .update(gbifSyncLog)
          .set({ recordsProcessed: totalTaxa + occTotal, checkpoint: JSON.stringify(checkpoint) })
          .where(eq(gbifSyncLog.id, syncLogId));
      }
    }

    occOffset += batchSize;
  }

  return occTotal;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }

  console.log("=== GBIF Data Seeding Pipeline ===");

  const [syncLog] = await db
    .insert(gbifSyncLog)
    .values({
      syncType: "full_taxonomy",
      status: "running",
      recordsProcessed: 0,
    })
    .returning();

  const checkpoint = await loadCheckpoint();
  console.log(`Checkpoint: processed kingdoms: [${checkpoint.processedKingdoms.join(", ")}]`);
  console.log(`Checkpoint: current position: ${JSON.stringify(checkpoint.currentPosition ?? "none")}`);
  console.log(`Checkpoint: occurrence species seeded: ${checkpoint.occurrencesSeeded.length}`);

  let totalTaxa = 0;

  try {
    for (const kingdom of MAJOR_KINGDOMS) {
      if (checkpoint.processedKingdoms.includes(kingdom.name)) {
        console.log(`Skipping ${kingdom.name} (already processed)`);
        continue;
      }

      const count = await seedKingdom(kingdom, checkpoint);
      totalTaxa += count;
      console.log(`[${kingdom.name}] Done: ${count} taxa`);

      checkpoint.processedKingdoms.push(kingdom.name);
      await saveCheckpoint(checkpoint);

      await db
        .update(gbifSyncLog)
        .set({ recordsProcessed: totalTaxa, checkpoint: JSON.stringify(checkpoint) })
        .where(eq(gbifSyncLog.id, syncLog.id));
    }

    const occTotal = await seedOccurrencesForHighValueSpecies(checkpoint, syncLog.id, totalTaxa);
    console.log(`\n[Occurrences] Done: ${occTotal} species processed`);

    await db
      .update(gbifSyncLog)
      .set({
        status: "completed",
        recordsProcessed: totalTaxa + occTotal,
        finishedAt: new Date(),
        checkpoint: null,
      })
      .where(eq(gbifSyncLog.id, syncLog.id));

    console.log(`\n=== Seeding complete. Taxa: ${totalTaxa}, Occurrence batches: ${occTotal} ===`);
  } catch (err) {
    console.error("Seeding failed:", err);
    await db
      .update(gbifSyncLog)
      .set({
        status: "failed",
        recordsProcessed: totalTaxa,
        errorMessage: String(err),
        finishedAt: new Date(),
      })
      .where(eq(gbifSyncLog.id, syncLog.id));
    process.exit(1);
  }
}

main();
