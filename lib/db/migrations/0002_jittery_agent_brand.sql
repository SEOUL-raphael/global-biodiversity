ALTER TABLE "gbif_occurrences" DROP CONSTRAINT "gbif_occurrences_taxon_key_gbif_taxa_taxon_key_fk";
--> statement-breakpoint
ALTER TABLE "gbif_occurrences" ALTER COLUMN "gbif_key" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "gbif_occurrences" ALTER COLUMN "taxon_key" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "gbif_taxa" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "gbif_taxa" ADD COLUMN "description_source" text;--> statement-breakpoint
ALTER TABLE "gbif_taxa" ADD COLUMN "description_fetched_at" timestamp;--> statement-breakpoint
ALTER TABLE "gbif_taxa" ADD COLUMN "embedding" jsonb;--> statement-breakpoint
ALTER TABLE "gbif_taxa" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "gbif_taxa" ADD COLUMN "embedding_updated_at" timestamp;--> statement-breakpoint
CREATE INDEX "gbif_taxa_desc_fetched_idx" ON "gbif_taxa" USING btree ("description_fetched_at");--> statement-breakpoint
CREATE INDEX "gbif_taxa_emb_updated_idx" ON "gbif_taxa" USING btree ("embedding_updated_at");--> statement-breakpoint
CREATE INDEX "gbif_taxa_num_occurrences_idx" ON "gbif_taxa" USING btree ("num_occurrences");