import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { gbifTaxa, gbifKgNodes, gbifKgEdges } from "@workspace/db/schema";
import { sql, ilike, or, desc } from "drizzle-orm";
import {
  nHopNeighbors,
  getCooccurrenceClusters,
  getEndangeredHotspots,
  getTaxonomyGaps,
  searchSpeciesByLocation,
  getOccurrenceHotspots,
} from "@workspace/db/graph";
import { semanticSearch } from "../lib/semantic-search";

type AnyDb = Parameters<typeof nHopNeighbors>[0];

const MCP_PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "search_species",
    description:
      "Search for species in the GBIF biodiversity database by name. Returns scientific name, IUCN status, and occurrence count.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Species name or partial name to search (e.g. 'Panthera', 'Orchis')",
        },
        limit: {
          type: "integer",
          description: "Maximum number of results to return (default: 10, max: 50)",
          default: 10,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_species_context",
    description:
      "Get the knowledge graph context for a species — neighbouring nodes (regions, threats, relatives) within 1–2 hops.",
    inputSchema: {
      type: "object",
      properties: {
        taxon_key: { type: "integer", description: "GBIF taxon key (integer ID)" },
        hops: {
          type: "integer",
          description: "Graph traversal depth: 1 or 2 (default: 2)",
          default: 2,
        },
      },
      required: ["taxon_key"],
    },
  },
  {
    name: "find_endangered_hotspots",
    description:
      "Find geographic regions with the highest number of endangered, critically endangered, or vulnerable species.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Maximum number of regions to return (default: 10)",
          default: 10,
        },
      },
    },
  },
  {
    name: "get_cooccurrence_clusters",
    description:
      "Find pairs of species that co-occur in the same regions and time periods, ranked by Jaccard similarity.",
    inputSchema: {
      type: "object",
      properties: {
        region: {
          type: "string",
          description: "ISO 2-letter country code to filter (e.g. 'US', 'KR', 'DE')",
        },
        min_jaccard: {
          type: "number",
          description: "Minimum Jaccard similarity 0–1 (default: 0.1)",
          default: 0.1,
        },
        limit: {
          type: "integer",
          description: "Maximum number of species pairs to return (default: 20)",
          default: 20,
        },
      },
    },
  },
  {
    name: "semantic_search_species",
    description:
      "Find species by natural-language description using 384-dim sentence embeddings of curated English descriptions. Use this when the user asks by trait, behaviour, or habitat rather than name.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language description (e.g. 'small nocturnal cat with spots')" },
        limit: { type: "integer", description: "Maximum number of matches (default: 10, max: 25)", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_taxonomy_gaps",
    description:
      "Find taxonomic families and orders with low observation coverage — high species count but few recorded occurrences.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Maximum number of results (default: 20)",
          default: 20,
        },
      },
    },
  },
  {
    name: "search_species_by_location",
    description:
      "Find species observed within a given radius of a geographic coordinate using the Haversine formula. Returns species sorted by proximity, with IUCN status and occurrence count.",
    inputSchema: {
      type: "object",
      properties: {
        latitude: {
          type: "number",
          description: "Decimal latitude of the centre point (-90 to 90), e.g. 37.5665 for Seoul",
        },
        longitude: {
          type: "number",
          description: "Decimal longitude of the centre point (-180 to 180), e.g. 126.9780 for Seoul",
        },
        radius_km: {
          type: "number",
          description: "Search radius in kilometres (default: 50, max: 5000)",
          default: 50,
        },
        limit: {
          type: "integer",
          description: "Maximum number of species to return (default: 20, max: 100)",
          default: 20,
        },
      },
      required: ["latitude", "longitude"],
    },
  },
  {
    name: "get_occurrence_hotspots",
    description:
      "Aggregate occurrence records into a geographic grid and return the densest cells ranked by species richness. Useful for identifying biodiversity hotspot areas on a map.",
    inputSchema: {
      type: "object",
      properties: {
        resolution_deg: {
          type: "number",
          description: "Grid cell size in decimal degrees (0.5–20, default: 2 → ~220 km cells)",
          default: 2,
        },
        min_lat: { type: "number", description: "Bounding box minimum latitude (optional)" },
        max_lat: { type: "number", description: "Bounding box maximum latitude (optional)" },
        min_lon: { type: "number", description: "Bounding box minimum longitude (optional)" },
        max_lon: { type: "number", description: "Bounding box maximum longitude (optional)" },
        limit: {
          type: "integer",
          description: "Maximum number of grid cells to return (default: 20, max: 200)",
          default: 20,
        },
      },
    },
  },
  {
    name: "wikipedia_lookup",
    description:
      "Look up a species or taxon on Wikipedia to get its description, common names, and scientific classification. " +
      "Use this to: (1) match a common name to a scientific name, (2) verify or enrich species info, " +
      "(3) clarify ambiguous queries. Returns extract, description, and canonical title from Wikipedia.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Species common name, scientific name, or any Wikipedia search query (e.g. 'lion', 'Panthera leo', 'African elephant')",
        },
      },
      required: ["query"],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "search_species") {
    const q = String(args.query ?? "");
    const limit = Math.min(Number(args.limit ?? 10), 50);
    const rows = await db
      .select({
        taxonKey: gbifTaxa.taxonKey,
        scientificName: gbifTaxa.scientificName,
        canonicalName: gbifTaxa.canonicalName,
        rank: gbifTaxa.rank,
        kingdom: gbifTaxa.kingdom,
        iucnStatus: gbifTaxa.iucnStatus,
        numOccurrences: gbifTaxa.numOccurrences,
        extinct: gbifTaxa.extinct,
      })
      .from(gbifTaxa)
      .where(or(ilike(gbifTaxa.canonicalName, `%${q}%`), ilike(gbifTaxa.scientificName, `%${q}%`)))
      .orderBy(desc(gbifTaxa.numOccurrences))
      .limit(limit);
    return rows;
  }

  if (name === "get_species_context") {
    const taxonKey = Number(args.taxon_key ?? 0);
    const hops = Math.max(1, Math.min(Number(args.hops ?? 2), 2));
    const externalId = `TAXON:${taxonKey}`;
    const [node] = await db
      .select()
      .from(gbifKgNodes)
      .where(sql`${gbifKgNodes.externalId} = ${externalId}`)
      .limit(1);
    if (!node) return { found: false, taxonKey };
    const context = await nHopNeighbors(db as AnyDb, node.nodeId, hops);
    return {
      found: true,
      taxonKey,
      rootLabel: node.label,
      hops,
      nodeCount: context.nodes.length,
      edgeCount: context.edges.length,
      nodes: context.nodes,
      edges: context.edges,
    };
  }

  if (name === "find_endangered_hotspots") {
    const limit = Math.min(Number(args.limit ?? 10), 50);
    return getEndangeredHotspots(db as AnyDb, limit);
  }

  if (name === "get_cooccurrence_clusters") {
    const region = typeof args.region === "string" ? args.region.toUpperCase().slice(0, 2) : undefined;
    const minJaccard = Number(args.min_jaccard ?? 0.1);
    const limit = Math.min(Number(args.limit ?? 20), 100);
    return getCooccurrenceClusters(db as AnyDb, region, minJaccard, limit);
  }

  if (name === "semantic_search_species") {
    const q = String(args.query ?? "");
    const limit = Math.min(Number(args.limit ?? 10), 25);
    return semanticSearch(q, limit);
  }

  if (name === "get_taxonomy_gaps") {
    const limit = Math.min(Number(args.limit ?? 20), 100);
    return getTaxonomyGaps(db as AnyDb, limit);
  }

  if (name === "search_species_by_location") {
    const lat = Number(args.latitude ?? 0);
    const lon = Number(args.longitude ?? 0);
    const radiusKm = Number(args.radius_km ?? 50);
    const limit = Math.min(Number(args.limit ?? 20), 100);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new Error("latitude must be -90..90 and longitude -180..180");
    }
    return searchSpeciesByLocation(db as AnyDb, lat, lon, radiusKm, limit);
  }

  if (name === "get_occurrence_hotspots") {
    const resolution = Number(args.resolution_deg ?? 2);
    const limit = Math.min(Number(args.limit ?? 20), 200);
    const hasBbox =
      args.min_lat != null && args.max_lat != null &&
      args.min_lon != null && args.max_lon != null;
    const bbox = hasBbox
      ? {
          minLat: Number(args.min_lat),
          maxLat: Number(args.max_lat),
          minLon: Number(args.min_lon),
          maxLon: Number(args.max_lon),
        }
      : undefined;
    return getOccurrenceHotspots(db as AnyDb, resolution, bbox, limit);
  }

  if (name === "wikipedia_lookup") {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("query is required");

    // Try direct page summary first
    const slug = encodeURIComponent(query.replace(/\s+/g, "_"));
    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`,
      { headers: { "User-Agent": "GBIF-Biodiversity-Dashboard/1.0" } },
    );
    if (summaryRes.ok) {
      const data = await summaryRes.json() as {
        title?: string;
        description?: string;
        extract?: string;
        content_urls?: { desktop?: { page?: string } };
      };
      return {
        found: true,
        title: data.title,
        description: data.description,
        extract: (data.extract ?? "").slice(0, 1200),
        url: data.content_urls?.desktop?.page,
      };
    }

    // Fallback: search
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search` +
        `&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`,
      { headers: { "User-Agent": "GBIF-Biodiversity-Dashboard/1.0" } },
    );
    if (!searchRes.ok) return { found: false, query };
    const searchData = await searchRes.json() as {
      query?: { search?: Array<{ title?: string }> };
    };
    const topTitle = searchData.query?.search?.[0]?.title;
    if (!topTitle) return { found: false, query };

    const topSlug = encodeURIComponent(topTitle.replace(/\s+/g, "_"));
    const topRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${topSlug}`,
      { headers: { "User-Agent": "GBIF-Biodiversity-Dashboard/1.0" } },
    );
    if (!topRes.ok) return { found: false, query };
    const topData = await topRes.json() as {
      title?: string;
      description?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    return {
      found: true,
      title: topData.title,
      description: topData.description,
      extract: (topData.extract ?? "").slice(0, 1200),
      url: topData.content_urls?.desktop?.page,
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

function mcpError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

const router: IRouter = Router();

router.get("/mcp", (_req, res) => {
  res.json({
    protocol: "MCP",
    version: MCP_PROTOCOL_VERSION,
    endpoint: "/mcp",
    transport: "HTTP JSON-RPC 2.0",
    tools: TOOLS.map((t) => t.name),
  });
});

router.post("/mcp", async (req, res) => {
  const body = req.body as { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  const reqId = body.id ?? null;
  const method = body.method ?? "";
  const params = body.params ?? {};

  try {
    if (method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id: reqId,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "gbif-kg-mcp", version: "1.0.0" },
        },
      });
      return;
    }

    if (method === "notifications/initialized" || method === "ping") {
      res.json({ jsonrpc: "2.0", id: reqId, result: {} });
      return;
    }

    if (method === "tools/list") {
      res.json({ jsonrpc: "2.0", id: reqId, result: { tools: TOOLS } });
      return;
    }

    if (method === "tools/call") {
      const toolName = String((params as { name?: string }).name ?? "");
      const toolArgs = ((params as { arguments?: Record<string, unknown> }).arguments ?? {});
      const result = await callTool(toolName, toolArgs);
      res.json({
        jsonrpc: "2.0",
        id: reqId,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      });
      return;
    }

    res.status(404).json(mcpError(reqId, -32601, `Method not found: ${method}`));
  } catch (err) {
    req.log.error(err, "MCP handler error");
    res.status(500).json(mcpError(reqId, -32603, String(err)));
  }
});

export default router;
