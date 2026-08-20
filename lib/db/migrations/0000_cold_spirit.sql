CREATE TABLE "gbif_occurrences" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"gbif_key" integer NOT NULL,
	"taxon_key" integer NOT NULL,
	"country_code" char(2),
	"decimal_latitude" real,
	"decimal_longitude" real,
	"year" smallint,
	"month" smallint,
	"dataset_key" text,
	"basis_of_record" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbif_regions" (
	"country_code" char(2) PRIMARY KEY NOT NULL,
	"country_name" text NOT NULL,
	"occurrence_count" bigint DEFAULT 0 NOT NULL,
	"species_count" integer DEFAULT 0 NOT NULL,
	"last_synced" timestamp
);
--> statement-breakpoint
CREATE TABLE "gbif_sync_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sync_type" text NOT NULL,
	"status" text NOT NULL,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"checkpoint" text,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "gbif_taxa" (
	"taxon_key" integer PRIMARY KEY NOT NULL,
	"parent_key" integer,
	"rank" text NOT NULL,
	"kingdom" text,
	"phylum" text,
	"class" text,
	"order" text,
	"family" text,
	"genus" text,
	"species" text,
	"scientific_name" text NOT NULL,
	"canonical_name" text,
	"vernacular_name" text,
	"iucn_status" text,
	"num_occurrences" bigint DEFAULT 0 NOT NULL,
	"extinct" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gbif_occurrences" ADD CONSTRAINT "gbif_occurrences_taxon_key_gbif_taxa_taxon_key_fk" FOREIGN KEY ("taxon_key") REFERENCES "public"."gbif_taxa"("taxon_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gbif_occurrences_gbif_key_idx" ON "gbif_occurrences" USING btree ("gbif_key");--> statement-breakpoint
CREATE INDEX "gbif_occurrences_taxon_key_idx" ON "gbif_occurrences" USING btree ("taxon_key");--> statement-breakpoint
CREATE INDEX "gbif_occurrences_country_code_idx" ON "gbif_occurrences" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "gbif_occurrences_year_idx" ON "gbif_occurrences" USING btree ("year");--> statement-breakpoint
CREATE INDEX "gbif_taxa_parent_key_idx" ON "gbif_taxa" USING btree ("parent_key");--> statement-breakpoint
CREATE INDEX "gbif_taxa_rank_idx" ON "gbif_taxa" USING btree ("rank");--> statement-breakpoint
CREATE INDEX "gbif_taxa_canonical_name_idx" ON "gbif_taxa" USING btree ("canonical_name");--> statement-breakpoint
CREATE INDEX "gbif_taxa_kingdom_idx" ON "gbif_taxa" USING btree ("kingdom");--> statement-breakpoint
CREATE INDEX "gbif_taxa_iucn_status_idx" ON "gbif_taxa" USING btree ("iucn_status");