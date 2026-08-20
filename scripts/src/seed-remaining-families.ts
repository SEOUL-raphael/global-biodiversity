/**
 * seed-remaining-families.ts
 * seed-gbif-expanded에서 완료된 Muridae 이후 나머지 family 적재
 * (Cervidae, Bovidae, 조류, 파충류, 양서류, 어류, 균류, 식물 추가분)
 */
import { db, gbifTaxa } from "@workspace/db";
import { searchSpecies, type GbifTaxon as GbifApiTaxon } from "@workspace/gbif-client";
import { sql } from "drizzle-orm";

const REMAINING_FAMILIES: Array<{ name: string; key: number }> = [
  // 포유류 (Muridae는 이미 완료)
  { name: "Cervidae",        key: 5298  },
  { name: "Bovidae",         key: 9614  },
  { name: "Rhinocerotidae",  key: 9415  },
  { name: "Suidae",          key: 5302  },
  { name: "Equidae",         key: 5479  },
  { name: "Otariidae",       key: 5309  },
  { name: "Phocidae",        key: 5310  },
  { name: "Pteropodidae",    key: 9367  },
  { name: "Vespertilionidae",key: 9368  },
  { name: "Lemuridae",       key: 5485  },
  { name: "Callitrichidae",  key: 9620  },
  { name: "Cercopithecidae", key: 9622  },
  { name: "Delphinidae",     key: 5314  },
  { name: "Balaenopteridae", key: 5313  },
  // 조류
  { name: "Falconidae",      key: 5240  },
  { name: "Psittacidae",     key: 9340  },
  { name: "Strigidae",       key: 9348  },
  { name: "Ardeidae",        key: 3685  },
  { name: "Anatidae",        key: 2986  },
  { name: "Corvidae",        key: 5235  },
  { name: "Spheniscidae",    key: 5284  },
  { name: "Gruidae",         key: 9313  },
  { name: "Columbidae",      key: 5233  },
  { name: "Trochilidae",     key: 5289  },
  { name: "Picidae",         key: 9333  },
  // 파충류
  { name: "Crocodylidae",    key: 5685  },
  { name: "Viperidae",       key: 5024  },
  { name: "Colubridae",      key: 6172  },
  { name: "Gekkonidae",      key: 5666  },
  { name: "Cheloniidae",     key: 9413  },
  { name: "Testudinidae",    key: 9618  },
  // 양서류
  { name: "Ranidae",         key: 6746  },
  { name: "Bufonidae",       key: 6727  },
  { name: "Hylidae",         key: 6735  },
  { name: "Salamandridae",   key: 6750  },
  // 어류
  { name: "Scombridae",      key: 8596  },
  { name: "Cichlidae",       key: 8522  },
  { name: "Carcharhinidae",  key: 2211  },
  // 균류
  { name: "Amanitaceae",     key: 4171  },
  { name: "Boletaceae",      key: 8789  },
  { name: "Polyporaceae",    key: 3286  },
  // 식물 추가
  { name: "Lamiaceae",       key: 2497  },
  { name: "Apiaceae",        key: 6720  },
  { name: "Solanaceae",      key: 7717  },
  { name: "Pinaceae",        key: 3925  },
  { name: "Cactaceae",       key: 2519  },
  { name: "Euphorbiaceae",   key: 4691  },
  { name: "Ranunculaceae",   key: 2410  },
  { name: "Liliaceae",       key: 7699  },
  { name: "Moraceae",        key: 6640  },
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
        kingdom: sql`excluded.kingdom`,
        phylum: sql`excluded.phylum`,
        class: sql`excluded.class`,
        order: sql`excluded.order`,
        family: sql`excluded.family`,
        genus: sql`excluded.genus`,
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
      process.stderr.write(`\n  Error ${family.name} offset ${offset}: ${msg.slice(0, 80)}\n`);
      await new Promise((r) => setTimeout(r, 2000));
      if (offset === 0) break;
    }
  }

  process.stdout.write(`${total} species\n`);
  return total;
}

async function seedFungi(): Promise<number> {
  process.stdout.write("\n[Fungi kingdom] Loading up to 10000 species...\n");
  let total = 0;
  let offset = 0;

  while (offset < 10000) {
    try {
      const page = await searchSpecies({
        highertaxonKey: 5,
        rank: "SPECIES",
        status: "ACCEPTED",
        limit: 100,
        offset,
      });

      for (const taxon of page.results) {
        await upsertTaxon(taxon);
        total++;
      }

      if (total % 1000 === 0 && total > 0) process.stdout.write(`  ${total} Fungi...\n`);
      if (page.endOfRecords || page.results.length === 0) break;
      offset += 100;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") || msg.includes("400")) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  process.stdout.write(`  Done: ${total} Fungi species\n`);
  return total;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
  process.stdout.write("=== Remaining Families Seeding ===\n\n");

  let total = 0;
  for (const family of REMAINING_FAMILIES) {
    total += await seedFamily(family);
  }
  process.stdout.write(`\nFamilies done: ${total} species\n`);

  await seedFungi();

  const stats = await db.execute<{ taxa: string }>(sql`
    SELECT count(*)::text AS taxa FROM gbif_taxa
  `);
  process.stdout.write(`\n=== Done: total taxa=${stats.rows[0]?.taxa} ===\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
