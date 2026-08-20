CREATE TABLE "gbif_kg_edges" (
	"edge_id" bigserial PRIMARY KEY NOT NULL,
	"from_node" bigint NOT NULL,
	"to_node" bigint NOT NULL,
	"edge_type" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"properties" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbif_kg_nodes" (
	"node_id" bigserial PRIMARY KEY NOT NULL,
	"node_type" text NOT NULL,
	"external_id" text NOT NULL,
	"label" text NOT NULL,
	"properties" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gbif_kg_edges" ADD CONSTRAINT "gbif_kg_edges_from_node_gbif_kg_nodes_node_id_fk" FOREIGN KEY ("from_node") REFERENCES "public"."gbif_kg_nodes"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbif_kg_edges" ADD CONSTRAINT "gbif_kg_edges_to_node_gbif_kg_nodes_node_id_fk" FOREIGN KEY ("to_node") REFERENCES "public"."gbif_kg_nodes"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gbif_kg_edges_unique_idx" ON "gbif_kg_edges" USING btree ("from_node","to_node","edge_type");--> statement-breakpoint
CREATE INDEX "gbif_kg_edges_from_node_idx" ON "gbif_kg_edges" USING btree ("from_node");--> statement-breakpoint
CREATE INDEX "gbif_kg_edges_to_node_idx" ON "gbif_kg_edges" USING btree ("to_node");--> statement-breakpoint
CREATE INDEX "gbif_kg_edges_edge_type_idx" ON "gbif_kg_edges" USING btree ("edge_type");--> statement-breakpoint
CREATE UNIQUE INDEX "gbif_kg_nodes_external_id_idx" ON "gbif_kg_nodes" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "gbif_kg_nodes_node_type_idx" ON "gbif_kg_nodes" USING btree ("node_type");--> statement-breakpoint
CREATE INDEX "gbif_kg_nodes_properties_gin_idx" ON "gbif_kg_nodes" USING gin ("properties");