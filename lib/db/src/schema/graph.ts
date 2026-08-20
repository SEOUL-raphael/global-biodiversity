import {
  pgTable,
  bigserial,
  bigint,
  text,
  real,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const NODE_TYPES = ["TAXON", "REGION", "THREAT", "HABITAT"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = [
  "CLASSIFIED_AS",
  "CO_OCCURS_WITH",
  "INHABITS",
  "THREATENED_BY",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const gbifKgNodes = pgTable(
  "gbif_kg_nodes",
  {
    nodeId: bigserial("node_id", { mode: "number" }).primaryKey(),
    nodeType: text("node_type").notNull(),
    externalId: text("external_id").notNull(),
    label: text("label").notNull(),
    properties: jsonb("properties"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gbif_kg_nodes_external_id_idx").on(t.externalId),
    index("gbif_kg_nodes_node_type_idx").on(t.nodeType),
    index("gbif_kg_nodes_properties_gin_idx").using("gin", t.properties),
  ],
);

export const gbifKgEdges = pgTable(
  "gbif_kg_edges",
  {
    edgeId: bigserial("edge_id", { mode: "number" }).primaryKey(),
    fromNode: bigint("from_node", { mode: "number" })
      .notNull()
      .references(() => gbifKgNodes.nodeId, { onDelete: "cascade" }),
    toNode: bigint("to_node", { mode: "number" })
      .notNull()
      .references(() => gbifKgNodes.nodeId, { onDelete: "cascade" }),
    edgeType: text("edge_type").notNull(),
    weight: real("weight").notNull().default(1.0),
    properties: jsonb("properties"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gbif_kg_edges_unique_idx").on(t.fromNode, t.toNode, t.edgeType),
    index("gbif_kg_edges_from_node_idx").on(t.fromNode),
    index("gbif_kg_edges_to_node_idx").on(t.toNode),
    index("gbif_kg_edges_edge_type_idx").on(t.edgeType),
  ],
);

export const insertKgNodeSchema = createInsertSchema(gbifKgNodes).omit({
  nodeId: true,
  createdAt: true,
});
export type InsertKgNode = z.infer<typeof insertKgNodeSchema>;
export type KgNode = typeof gbifKgNodes.$inferSelect;

export const insertKgEdgeSchema = createInsertSchema(gbifKgEdges).omit({
  edgeId: true,
  createdAt: true,
});
export type InsertKgEdge = z.infer<typeof insertKgEdgeSchema>;
export type KgEdge = typeof gbifKgEdges.$inferSelect;
