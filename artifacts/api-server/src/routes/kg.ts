import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { gbifKgNodes, gbifKgEdges } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  nHopNeighbors,
  getCooccurrenceClusters,
  getEndangeredHotspots,
  getTaxonomyGaps,
  getThreatDistribution,
  getOccurrenceTrends,
} from "@workspace/db/graph";

const router: IRouter = Router();

function parsePositiveInt(val: unknown, defaultVal: number): number | null {
  if (val === undefined || val === null || val === "") return defaultVal;
  const n = parseInt(String(val), 10);
  if (isNaN(n) || n < 0) return null;
  return n;
}

router.get("/kg/species/:taxonKey/context", async (req, res) => {
  const taxonKey = parseInt(req.params.taxonKey, 10);
  if (isNaN(taxonKey) || taxonKey <= 0) {
    res.status(400).json({ error: "bad_request", message: "Invalid taxon key" });
    return;
  }

  const rawHops = parsePositiveInt(req.query.hops, 2);
  if (rawHops === null || rawHops < 1) {
    res.status(400).json({ error: "bad_request", message: "hops must be 1 or 2" });
    return;
  }
  const hops = Math.min(Math.max(rawHops, 1), 2);

  try {
    const externalId = `TAXON:${taxonKey}`;
    const [node] = await db
      .select()
      .from(gbifKgNodes)
      .where(eq(gbifKgNodes.externalId, externalId))
      .limit(1);

    if (!node) {
      res.status(404).json({ error: "not_found", message: "Species not found in knowledge graph" });
      return;
    }

    const context = await nHopNeighbors(
      db as Parameters<typeof nHopNeighbors>[0],
      node.nodeId,
      hops,
    );

    res.json({
      rootNode: {
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        externalId: node.externalId,
        label: node.label,
        properties: node.properties,
      },
      hops,
      nodes: context.nodes,
      edges: context.edges,
    });
  } catch (err) {
    req.log.error(err, "Failed to get KG species context");
    res.status(500).json({ error: "internal_error", message: "Failed to get species context" });
  }
});

router.get("/kg/nodes/:nodeId/context", async (req, res) => {
  const nodeId = parseInt(req.params.nodeId, 10);
  if (isNaN(nodeId) || nodeId <= 0) {
    res.status(400).json({ error: "bad_request", message: "Invalid node id" });
    return;
  }

  const rawHops = parsePositiveInt(req.query.hops, 1);
  if (rawHops === null || rawHops < 1) {
    res.status(400).json({ error: "bad_request", message: "hops must be 1 or 2" });
    return;
  }
  const hops = Math.min(Math.max(rawHops, 1), 2);

  try {
    const [node] = await db
      .select()
      .from(gbifKgNodes)
      .where(eq(gbifKgNodes.nodeId, nodeId))
      .limit(1);

    if (!node) {
      res.status(404).json({ error: "not_found", message: "Node not found in knowledge graph" });
      return;
    }

    const context = await nHopNeighbors(
      db as Parameters<typeof nHopNeighbors>[0],
      node.nodeId,
      hops,
    );

    res.json({
      rootNode: {
        nodeId: node.nodeId,
        nodeType: node.nodeType,
        externalId: node.externalId,
        label: node.label,
        properties: node.properties,
      },
      hops,
      nodes: context.nodes,
      edges: context.edges,
    });
  } catch (err) {
    req.log.error(err, "Failed to get KG node context");
    res.status(500).json({ error: "internal_error", message: "Failed to get node context" });
  }
});

router.get("/kg/insights/cooccurrence", async (req, res) => {
  const region =
    typeof req.query.region === "string"
      ? req.query.region.toUpperCase().slice(0, 2)
      : undefined;

  const rawLimit = parsePositiveInt(req.query.limit, 20);
  if (rawLimit === null) {
    res.status(400).json({ error: "bad_request", message: "limit must be a non-negative integer" });
    return;
  }
  const limit = Math.min(rawLimit, 100);

  const minJaccardRaw = req.query.minJaccard !== undefined
    ? parseFloat(String(req.query.minJaccard))
    : 0.1;
  if (isNaN(minJaccardRaw) || minJaccardRaw < 0 || minJaccardRaw > 1) {
    res.status(400).json({ error: "bad_request", message: "minJaccard must be between 0 and 1" });
    return;
  }

  try {
    const clusters = await getCooccurrenceClusters(
      db as Parameters<typeof getCooccurrenceClusters>[0],
      region,
      minJaccardRaw,
      limit,
    );
    res.json({ region: region ?? null, minJaccard: minJaccardRaw, count: clusters.length, clusters });
  } catch (err) {
    req.log.error(err, "Failed to get co-occurrence clusters");
    res.status(500).json({ error: "internal_error", message: "Failed to get co-occurrence clusters" });
  }
});

router.get("/kg/insights/endangered-hotspots", async (req, res) => {
  const rawLimit = parsePositiveInt(req.query.limit, 10);
  if (rawLimit === null) {
    res.status(400).json({ error: "bad_request", message: "limit must be a non-negative integer" });
    return;
  }
  const limit = Math.min(rawLimit, 50);

  try {
    const hotspots = await getEndangeredHotspots(
      db as Parameters<typeof getEndangeredHotspots>[0],
      limit,
    );
    res.json({ count: hotspots.length, hotspots });
  } catch (err) {
    req.log.error(err, "Failed to get endangered hotspots");
    res.status(500).json({ error: "internal_error", message: "Failed to get endangered hotspots" });
  }
});

router.get("/kg/insights/taxonomy-gap", async (req, res) => {
  const rawLimit = parsePositiveInt(req.query.limit, 20);
  if (rawLimit === null) {
    res.status(400).json({ error: "bad_request", message: "limit must be a non-negative integer" });
    return;
  }
  const limit = Math.min(rawLimit, 100);
  const kingdom = typeof req.query.kingdom === "string" && req.query.kingdom.length > 0
    ? req.query.kingdom
    : undefined;

  try {
    const gaps = await getTaxonomyGaps(
      db as Parameters<typeof getTaxonomyGaps>[0],
      limit,
      kingdom,
    );
    res.json({ count: gaps.length, gaps });
  } catch (err) {
    req.log.error(err, "Failed to get taxonomy gaps");
    res.status(500).json({ error: "internal_error", message: "Failed to get taxonomy gaps" });
  }
});

router.get("/kg/insights/threat-distribution", async (req, res) => {
  const rawTop = parsePositiveInt(req.query.topFamilies, 10);
  if (rawTop === null) {
    res.status(400).json({ error: "bad_request", message: "topFamilies must be a non-negative integer" });
    return;
  }
  const topFamilies = Math.min(rawTop, 50);
  try {
    const data = await getThreatDistribution(
      db as Parameters<typeof getThreatDistribution>[0],
      topFamilies,
    );
    res.json(data);
  } catch (err) {
    req.log.error(err, "Failed to get threat distribution");
    res.status(500).json({ error: "internal_error", message: "Failed to get threat distribution" });
  }
});

router.get("/kg/insights/occurrence-trends", async (req, res) => {
  const rawFromYear = parsePositiveInt(req.query.fromYear, 1980);
  if (rawFromYear === null) {
    res.status(400).json({ error: "bad_request", message: "fromYear must be a non-negative integer" });
    return;
  }
  const fromYear = Math.min(Math.max(rawFromYear, 1700), new Date().getFullYear());

  const rawTop = parsePositiveInt(req.query.topCountries, 5);
  if (rawTop === null) {
    res.status(400).json({ error: "bad_request", message: "topCountries must be a non-negative integer" });
    return;
  }
  const topCountries = Math.min(rawTop, 200);

  try {
    const data = await getOccurrenceTrends(
      db as Parameters<typeof getOccurrenceTrends>[0],
      fromYear,
      topCountries,
    );
    res.json(data);
  } catch (err) {
    req.log.error(err, "Failed to get occurrence trends");
    res.status(500).json({ error: "internal_error", message: "Failed to get occurrence trends" });
  }
});

router.get("/kg/stats", async (req, res) => {
  try {
    const nodeTypeRows = await db.execute<{ node_type: string; cnt: number }>(sql`
      SELECT node_type, COUNT(*)::integer AS cnt
      FROM gbif_kg_nodes
      GROUP BY node_type
      ORDER BY cnt DESC
    `);

    const edgeTypeRows = await db.execute<{ edge_type: string; cnt: number }>(sql`
      SELECT edge_type, COUNT(*)::integer AS cnt
      FROM gbif_kg_edges
      GROUP BY edge_type
      ORDER BY cnt DESC
    `);

    const totalNodes = nodeTypeRows.rows.reduce((sum, r) => sum + Number(r.cnt), 0);
    const totalEdges = edgeTypeRows.rows.reduce((sum, r) => sum + Number(r.cnt), 0);

    res.json({
      totalNodes,
      totalEdges,
      nodesByType: nodeTypeRows.rows.reduce(
        (acc, r) => ({ ...acc, [r.node_type]: Number(r.cnt) }),
        {} as Record<string, number>,
      ),
      edgesByType: edgeTypeRows.rows.reduce(
        (acc, r) => ({ ...acc, [r.edge_type]: Number(r.cnt) }),
        {} as Record<string, number>,
      ),
    });
  } catch (err) {
    req.log.error(err, "Failed to get KG stats");
    res.status(500).json({ error: "internal_error", message: "Failed to get KG stats" });
  }
});

router.get("/kg/mcp-status", async (_req, res) => {
  res.json({
    status: "running",
    transport: "http",
    endpoint: "/mcp",
    toolCount: 8,
    tools: [
      "search_species",
      "get_species_context",
      "get_cooccurrence_clusters",
      "find_endangered_hotspots",
      "get_taxonomy_gaps",
      "semantic_search_species",
      "search_species_by_location",
      "get_occurrence_hotspots",
    ],
  });
});

export default router;
