import {
  pgTable,
  integer,
  bigserial,
  text,
  real,
  smallint,
  bigint,
  timestamp,
  index,
  char,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gbifTaxa = pgTable(
  "gbif_taxa",
  {
    taxonKey: integer("taxon_key").primaryKey(),
    parentKey: integer("parent_key"),
    rank: text("rank").notNull(),
    kingdom: text("kingdom"),
    phylum: text("phylum"),
    class: text("class"),
    order: text("order"),
    family: text("family"),
    genus: text("genus"),
    species: text("species"),
    scientificName: text("scientific_name").notNull(),
    canonicalName: text("canonical_name"),
    vernacularName: text("vernacular_name"),
    iucnStatus: text("iucn_status"),
    numOccurrences: bigint("num_occurrences", { mode: "number" })
      .notNull()
      .default(0),
    extinct: text("extinct"),
    description: text("description"),
    descriptionSource: text("description_source"),
    descriptionFetchedAt: timestamp("description_fetched_at"),
    embedding: jsonb("embedding").$type<number[]>(),
    embeddingModel: text("embedding_model"),
    embeddingUpdatedAt: timestamp("embedding_updated_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("gbif_taxa_parent_key_idx").on(t.parentKey),
    index("gbif_taxa_rank_idx").on(t.rank),
    index("gbif_taxa_canonical_name_idx").on(t.canonicalName),
    index("gbif_taxa_kingdom_idx").on(t.kingdom),
    index("gbif_taxa_iucn_status_idx").on(t.iucnStatus),
    index("gbif_taxa_desc_fetched_idx").on(t.descriptionFetchedAt),
    index("gbif_taxa_emb_updated_idx").on(t.embeddingUpdatedAt),
    index("gbif_taxa_num_occurrences_idx").on(t.numOccurrences),
  ],
);

export const gbifOccurrences = pgTable(
  "gbif_occurrences",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    gbifKey: bigint("gbif_key", { mode: "number" }).notNull(),
    taxonKey: bigint("taxon_key", { mode: "number" }).notNull(),
    countryCode: char("country_code", { length: 2 }),
    decimalLatitude: real("decimal_latitude"),
    decimalLongitude: real("decimal_longitude"),
    year: smallint("year"),
    month: smallint("month"),
    datasetKey: text("dataset_key"),
    basisOfRecord: text("basis_of_record"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gbif_occurrences_gbif_key_idx").on(t.gbifKey),
    index("gbif_occurrences_taxon_key_idx").on(t.taxonKey),
    index("gbif_occurrences_country_code_idx").on(t.countryCode),
    index("gbif_occurrences_year_idx").on(t.year),
  ],
);

export const gbifRegions = pgTable(
  "gbif_regions",
  {
    countryCode: char("country_code", { length: 2 }).primaryKey(),
    countryName: text("country_name").notNull(),
    occurrenceCount: bigint("occurrence_count", { mode: "number" })
      .notNull()
      .default(0),
    speciesCount: integer("species_count").notNull().default(0),
    lastSynced: timestamp("last_synced"),
  },
);

export const gbifSyncLog = pgTable("gbif_sync_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  syncType: text("sync_type").notNull(),
  status: text("status").notNull(),
  recordsProcessed: integer("records_processed").notNull().default(0),
  checkpoint: text("checkpoint"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

export const insertGbifTaxonSchema = createInsertSchema(gbifTaxa).omit({
  createdAt: true,
  updatedAt: true,
});
export const selectGbifTaxonSchema = createSelectSchema(gbifTaxa);
export type InsertGbifTaxon = z.infer<typeof insertGbifTaxonSchema>;
export type GbifTaxon = typeof gbifTaxa.$inferSelect;

export const insertGbifOccurrenceSchema = createInsertSchema(gbifOccurrences).omit({
  id: true,
  createdAt: true,
});
export type InsertGbifOccurrence = z.infer<typeof insertGbifOccurrenceSchema>;
export type GbifOccurrence = typeof gbifOccurrences.$inferSelect;

export const insertGbifRegionSchema = createInsertSchema(gbifRegions);
export type InsertGbifRegion = z.infer<typeof insertGbifRegionSchema>;
export type GbifRegion = typeof gbifRegions.$inferSelect;

export type GbifSyncLog = typeof gbifSyncLog.$inferSelect;
