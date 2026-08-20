import { Router, type IRouter, type Request } from "express";
import OpenAI from "openai";
import { db } from "@workspace/db";
import { gbifTaxa, gbifKgNodes } from "@workspace/db/schema";
import { sql, ilike, or, desc, eq as eqOp, and as andOp } from "drizzle-orm";
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

const SERVER_MODEL =
  process.env.MINIMAX_MODEL ??
  (process.env.OPENAI_BASE_URL ? "MiniMax-M2.7" : "gpt-5-mini");
const FREE_QUOTA_PER_IP = Number(process.env.AI_FREE_QUOTA_PER_IP ?? 4);
const QUOTA_WINDOW_MS = 1000 * 60 * 60 * 24; // 24h sliding window — 2 free calls per day
const MAX_RESPONSE_TOKENS = 1600;
const MAX_HISTORY_MESSAGES = 4;
const MAX_TOOL_RESULT_CHARS = 4000;
const MAX_TOOL_LOOPS = 3;

// User-selectable LLM providers. All speak an OpenAI-compatible chat
// completions API; we just swap baseURL + default model based on the
// provider header sent by the client.
export type ProviderId =
  | "openai"
  | "openrouter"
  | "groq"
  | "deepseek"
  | "mistral"
  | "gemini";

export const PROVIDERS: Record<
  ProviderId,
  { label: string; baseURL: string | undefined; defaultModel: string }
> = {
  openai: { label: "OpenAI", baseURL: undefined, defaultModel: "gpt-4o-mini" },
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
  },
  groq: {
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
  },
  mistral: {
    label: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
  },
  gemini: {
    label: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.0-flash",
  },
};

function pickProvider(req: Request): ProviderId | undefined {
  const raw = (req.header("x-user-api-provider") || "").toLowerCase().trim();
  return raw && raw in PROVIDERS ? (raw as ProviderId) : undefined;
}

function resolveAiCreds(
  userKey?: string,
  provider?: ProviderId,
): { apiKey: string; baseURL: string; model: string } {
  const apiKey =
    userKey ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  if (userKey && provider) {
    const p = PROVIDERS[provider];
    return { apiKey, baseURL: p.baseURL ?? "https://api.openai.com/v1", model: p.defaultModel };
  }
  const baseURL =
    process.env.OPENAI_BASE_URL ||
    (userKey ? "https://api.openai.com/v1" : process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "https://api.openai.com/v1");
  return { apiKey, baseURL, model: SERVER_MODEL };
}

function makeOpenAIClient(
  userKey?: string,
  provider?: ProviderId,
): { client: OpenAI; model: string } {
  const { apiKey, baseURL, model } = resolveAiCreds(userKey, provider);
  return {
    client: new OpenAI({ apiKey, baseURL, timeout: 90_000 }),
    model,
  };
}

// In-memory per-IP usage counter (resets after process restart).
// For multi-instance prod, swap for a shared Redis counter.
const usage = new Map<string, { count: number; resetAt: number }>();

function ipKey(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0]?.trim();
  return first || req.ip || "unknown";
}

function getUsage(ip: string): { count: number; resetAt: number } {
  const now = Date.now();
  const entry = usage.get(ip);
  if (!entry || entry.resetAt < now) {
    const fresh = { count: 0, resetAt: now + QUOTA_WINDOW_MS };
    usage.set(ip, fresh);
    return fresh;
  }
  return entry;
}

function userKeyFrom(req: Request): string | undefined {
  const headerKey = req.header("x-user-api-key");
  if (headerKey && headerKey.length > 8) return headerKey;
  const body = req.body as { userApiKey?: string } | undefined;
  if (body?.userApiKey && body.userApiKey.length > 8) return body.userApiKey;
  return undefined;
}

function truncateForModel(value: unknown): string {
  const s = JSON.stringify(value);
  if (s.length <= MAX_TOOL_RESULT_CHARS) return s;
  return s.slice(0, MAX_TOOL_RESULT_CHARS) + "…[truncated]";
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_species",
      description:
        "Search for species in the GBIF biodiversity database. All parameters are optional — omit 'query' to browse by filters alone (e.g. all CRITICALLY_ENDANGERED mammals). Returns scientific name, IUCN status, and occurrence count.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Species name or partial name (e.g. 'Panthera', 'Orchis'). Omit to list top species by filters." },
          iucn_status: {
            type: "string",
            description: "Filter by IUCN Red List status. Values: CRITICALLY_ENDANGERED, ENDANGERED, VULNERABLE, NEAR_THREATENED, LEAST_CONCERN, DATA_DEFICIENT, EXTINCT, EXTINCT_IN_THE_WILD.",
          },
          kingdom: { type: "string", description: "Filter by kingdom (e.g. 'Animalia', 'Plantae', 'Fungi')." },
          rank: { type: "string", description: "Filter by taxonomic rank (e.g. 'SPECIES', 'GENUS', 'FAMILY')." },
          limit: { type: "integer", description: "Max results (default 10, max 50)", default: 10 },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_species_context",
      description:
        "Get the knowledge graph context for a species — neighbouring nodes (regions, threats, relatives) within 1–2 hops.",
      parameters: {
        type: "object",
        properties: {
          taxon_key: { type: "integer", description: "GBIF taxon key (integer ID)" },
          hops: { type: "integer", description: "Graph depth: 1 or 2 (default 2)", default: 2 },
        },
        required: ["taxon_key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_endangered_hotspots",
      description:
        "Find geographic regions with the highest number of endangered, critically endangered, or vulnerable species.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max regions (default 10)", default: 10 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cooccurrence_clusters",
      description:
        "Find pairs of species that co-occur in the same regions, ranked by Jaccard similarity.",
      parameters: {
        type: "object",
        properties: {
          region: { type: "string", description: "ISO 2-letter country code to filter (e.g. 'US', 'KR')" },
          min_jaccard: { type: "number", description: "Minimum Jaccard similarity 0–1 (default 0.1)", default: 0.1 },
          limit: { type: "integer", description: "Max species pairs (default 10)", default: 10 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_taxonomy_gaps",
      description:
        "Find taxonomic families with low observation coverage — high species count but few recorded occurrences.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max results (default 10)", default: 10 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_species_by_location",
      description:
        "Find species observed within a given radius of a geographic coordinate (Haversine). Use when the user mentions a place name or coordinates and asks what species live there.",
      parameters: {
        type: "object",
        properties: {
          latitude: { type: "number", description: "Decimal latitude (-90 to 90)" },
          longitude: { type: "number", description: "Decimal longitude (-180 to 180)" },
          radius_km: { type: "number", description: "Search radius in km (default 50)", default: 50 },
          limit: { type: "integer", description: "Max species to return (default 20)", default: 20 },
        },
        required: ["latitude", "longitude"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "semantic_search_species",
      description:
        "Find species by NATURAL-LANGUAGE description (e.g. 'small nocturnal cat', 'orchid that grows on trees', 'critically endangered marine reptile'). Uses 384-dim sentence embeddings of curated English descriptions. Prefer this tool when the user asks by trait/behaviour/habitat rather than name.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language description of the species" },
          limit: { type: "integer", description: "Max results (default 10, max 25)", default: 10 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_occurrence_hotspots",
      description:
        "Aggregate occurrence records into a geographic grid and return the densest cells by species richness. Use when the user asks about biodiversity hotspots on a map or wants a global/regional overview.",
      parameters: {
        type: "object",
        properties: {
          resolution_deg: { type: "number", description: "Grid size in degrees (0.5–20, default 2)", default: 2 },
          min_lat: { type: "number", description: "Bounding box min latitude (optional)" },
          max_lat: { type: "number", description: "Bounding box max latitude (optional)" },
          min_lon: { type: "number", description: "Bounding box min longitude (optional)" },
          max_lon: { type: "number", description: "Bounding box max longitude (optional)" },
          limit: { type: "integer", description: "Max grid cells (default 20)", default: 20 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wikipedia_lookup",
      description:
        "Look up a species or taxon on Wikipedia to get its description, common names, and scientific classification. " +
        "Use this to: (1) match a common name to a scientific name, (2) verify or enrich species info, " +
        "(3) clarify ambiguous queries. Returns extract, description, and canonical title from Wikipedia.",
      parameters: {
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
  },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "search_species") {
    const q = typeof args.query === "string" ? args.query.trim() : "";
    const iucnStatus = typeof args.iucn_status === "string" ? args.iucn_status.trim() : "";
    const kingdom = typeof args.kingdom === "string" ? args.kingdom.trim() : "";
    const rank = typeof args.rank === "string" ? args.rank.trim().toUpperCase() : "";
    const limit = Math.min(Number(args.limit ?? 10), 50);

    const conditions = [];
    if (q) {
      conditions.push(or(
        ilike(gbifTaxa.canonicalName, `%${q}%`),
        ilike(gbifTaxa.scientificName, `%${q}%`),
        ilike(gbifTaxa.vernacularName, `%${q}%`),
      ));
    }
    if (iucnStatus) conditions.push(eqOp(gbifTaxa.iucnStatus, iucnStatus));
    if (kingdom) conditions.push(ilike(gbifTaxa.kingdom, kingdom));
    if (rank) conditions.push(eqOp(gbifTaxa.rank, rank));

    const where = conditions.length > 0
      ? (conditions.length === 1 ? conditions[0] : andOp(...conditions))
      : undefined;

    return db
      .select({
        taxonKey: gbifTaxa.taxonKey,
        scientificName: gbifTaxa.scientificName,
        canonicalName: gbifTaxa.canonicalName,
        rank: gbifTaxa.rank,
        kingdom: gbifTaxa.kingdom,
        family: gbifTaxa.family,
        iucnStatus: gbifTaxa.iucnStatus,
        numOccurrences: gbifTaxa.numOccurrences,
        extinct: gbifTaxa.extinct,
      })
      .from(gbifTaxa)
      .where(where)
      .orderBy(desc(gbifTaxa.numOccurrences))
      .limit(limit);
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
      nodes: context.nodes.slice(0, 20),
      edges: context.edges.slice(0, 30),
    };
  }

  if (name === "find_endangered_hotspots") {
    const limit = Math.min(Number(args.limit ?? 10), 50);
    return getEndangeredHotspots(db as AnyDb, limit);
  }

  if (name === "get_cooccurrence_clusters") {
    const region = typeof args.region === "string" ? args.region.toUpperCase().slice(0, 2) : undefined;
    const minJaccard = Number(args.min_jaccard ?? 0.1);
    const limit = Math.min(Number(args.limit ?? 10), 100);
    return getCooccurrenceClusters(db as AnyDb, region, minJaccard, limit);
  }

  if (name === "get_taxonomy_gaps") {
    const limit = Math.min(Number(args.limit ?? 10), 100);
    return getTaxonomyGaps(db as AnyDb, limit);
  }

  if (name === "search_species_by_location") {
    const lat = Number(args.latitude ?? 0);
    const lon = Number(args.longitude ?? 0);
    const radiusKm = Number(args.radius_km ?? 50);
    const limit = Math.min(Number(args.limit ?? 20), 100);
    return searchSpeciesByLocation(db as AnyDb, lat, lon, radiusKm, limit);
  }

  if (name === "semantic_search_species") {
    const q = String(args.query ?? "");
    const limit = Math.min(Number(args.limit ?? 10), 25);
    return semanticSearch(q, limit);
  }

  if (name === "get_occurrence_hotspots") {
    const resolution = Number(args.resolution_deg ?? 2);
    const limit = Math.min(Number(args.limit ?? 20), 200);
    const hasBbox =
      args.min_lat != null && args.max_lat != null &&
      args.min_lon != null && args.max_lon != null;
    const bbox = hasBbox
      ? { minLat: Number(args.min_lat), maxLat: Number(args.max_lat), minLon: Number(args.min_lon), maxLon: Number(args.max_lon) }
      : undefined;
    return getOccurrenceHotspots(db as AnyDb, resolution, bbox, limit);
  }

  if (name === "wikipedia_lookup") {
    const query = String(args.query ?? "").trim();
    if (!query) return { error: "query is required" };

    const UA = "GBIF-Biodiversity-Dashboard/1.0 (https://global-data-insights.replit.app)";

    interface WikiSummary {
      title?: string;
      description?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    }

    // 1) Try direct page summary (scientific names resolve cleanly this way)
    const slug = encodeURIComponent(query.replace(/\s+/g, "_"));
    const directResp = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`,
      { headers: { "User-Agent": UA } },
    );
    if (directResp.ok) {
      const d = (await directResp.json()) as WikiSummary;
      return {
        found: true,
        title: d.title,
        description: d.description,
        extract: d.extract?.slice(0, 700),
        url: d.content_urls?.desktop?.page,
        method: "direct",
      };
    }

    // 2) Fall back to Wikipedia search API
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=3&srprop=snippet`;
    const searchResp = await fetch(searchUrl, { headers: { "User-Agent": UA } });
    if (!searchResp.ok) return { found: false, query };

    interface WikiSearch {
      query?: { search?: Array<{ title: string; snippet: string }> };
    }
    const searchData = (await searchResp.json()) as WikiSearch;
    const hits = searchData.query?.search ?? [];
    if (hits.length === 0) return { found: false, query };

    // Get summary for the top search result
    const topSlug = encodeURIComponent(hits[0].title.replace(/\s+/g, "_"));
    const topResp = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${topSlug}`,
      { headers: { "User-Agent": UA } },
    );
    if (topResp.ok) {
      const d = (await topResp.json()) as WikiSummary;
      return {
        found: true,
        title: d.title,
        description: d.description,
        extract: d.extract?.slice(0, 700),
        url: d.content_urls?.desktop?.page,
        method: "search",
        otherMatches: hits.slice(1).map((h) => h.title),
      };
    }

    return {
      found: true,
      results: hits.map((h) => ({
        title: h.title,
        snippet: h.snippet.replace(/<[^>]+>/g, "").slice(0, 200),
      })),
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

// Token-saving: minimal system prompt. Tools, IUCN convention, language echo.
const SYSTEM_PROMPT =
  "GBIF biodiversity assistant. Use tools to fetch live data. Cite species in *italic markdown*. Threatened = IUCN CR+EN+VU. Reply concisely in the user's language. " +
  "When the user gives a common name (e.g. 'lion', '호랑이', 'tigre'), call wikipedia_lookup first to find the scientific name, then use it in search_species or get_species_context.";

const router: IRouter = Router();

router.post("/ai/ask", async (req, res) => {
  const { question, history } = req.body as {
    question?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!question || typeof question !== "string" || question.trim().length === 0) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const userKey = userKeyFrom(req);
  const ip = ipKey(req);
  const usingOwnKey = Boolean(userKey);

  // Quota check only when using shared (server) key
  if (!usingOwnKey) {
    const u = getUsage(ip);
    if (u.count >= FREE_QUOTA_PER_IP) {
      res.status(429).json({
        error: "quota_exceeded",
        quota: { used: u.count, limit: FREE_QUOTA_PER_IP, remaining: 0, resetAt: u.resetAt },
      });
      return;
    }
  }

  const provider = pickProvider(req);
  let openai: OpenAI;
  let model: string;
  try {
    const made = makeOpenAIClient(userKey, provider);
    openai = made.client;
    model = made.model;
  } catch {
    res.status(503).json({ error: "AI service not configured: OPENAI_API_KEY missing" });
    return;
  }

  const trimmedHistory = Array.isArray(history)
    ? history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content }))
    : [];

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...trimmedHistory,
    { role: "user", content: question.trim() },
  ];

  const toolResults: Array<{ tool: string; args: Record<string, unknown> }> = [];

  try {
    let response = await openai.chat.completions.create({
      model,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      max_completion_tokens: MAX_RESPONSE_TOKENS,
    });

    let loopCount = 0;
    while (response.choices[0]?.finish_reason === "tool_calls" && loopCount < MAX_TOOL_LOOPS) {
      loopCount++;
      const assistantMsg = response.choices[0].message;
      messages.push(assistantMsg);

      const toolCallResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = [];

      for (const toolCall of assistantMsg.tool_calls ?? []) {
        if (!("function" in toolCall)) continue;
        const tc = toolCall as { id: string; function: { name: string; arguments: string } };
        const fnName = tc.function.name;
        let fnArgs: Record<string, unknown> = {};
        try {
          fnArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          fnArgs = {};
        }

        let toolResult: unknown;
        try {
          toolResult = await executeTool(fnName, fnArgs);
        } catch (err) {
          toolResult = { error: String(err) };
        }

        toolResults.push({ tool: fnName, args: fnArgs });

        toolCallResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: truncateForModel(toolResult),
        });
      }

      messages.push(...toolCallResults);

      response = await openai.chat.completions.create({
        model,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        max_completion_tokens: MAX_RESPONSE_TOKENS,
      });
    }

    const answer = response.choices[0]?.message?.content ?? "";

    // Only consume quota if request succeeded and used shared key
    let quotaInfo: { used: number; limit: number; remaining: number; resetAt: number } | null = null;
    if (!usingOwnKey) {
      const u = getUsage(ip);
      u.count += 1;
      quotaInfo = {
        used: u.count,
        limit: FREE_QUOTA_PER_IP,
        remaining: Math.max(0, FREE_QUOTA_PER_IP - u.count),
        resetAt: u.resetAt,
      };
    }

    res.json({
      answer,
      toolsUsed: toolResults.map((t) => ({ tool: t.tool, args: t.args })),
      model,
      provider: provider ?? null,
      usingOwnKey,
      quota: quotaInfo,
    });
  } catch (err) {
    req.log.error(err, "AI ask error");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `AI request failed: ${msg}` });
  }
});

router.post("/ai/plan", async (req, res) => {
  const { question } = req.body as { question?: string };
  if (!question || typeof question !== "string" || question.trim().length === 0) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const userKey = userKeyFrom(req);
  const provider = pickProvider(req);
  let openai: OpenAI;
  let model: string;
  try {
    const made = makeOpenAIClient(userKey, provider);
    openai = made.client;
    model = made.model;
  } catch {
    res.status(503).json({ error: "AI service not configured" });
    return;
  }

  const toolNames = TOOLS.map(
    (t) => (t as { function: { name: string } }).function.name,
  ).join(", ");

  try {
    const r = await openai.chat.completions.create({
      model,
      max_completion_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "You are a planner. Given a user question about GBIF biodiversity, " +
            "outline 2 to 4 short numbered steps (max 12 words each) describing " +
            "which of these tools you would call and why. Do NOT answer the " +
            "question itself. Reply in the user's language. Available tools: " +
            toolNames,
        },
        { role: "user", content: question.trim() },
      ],
    });
    const plan = r.choices[0]?.message?.content?.trim() ?? "";
    res.json({ plan, tools: TOOLS.map((t) => (t as { function: { name: string } }).function.name) });
  } catch (err) {
    req.log.error(err, "AI plan error");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `AI plan failed: ${msg}` });
  }
});

router.post("/ai/ask/stream", async (req, res) => {
  const { question, history } = req.body as {
    question?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!question || typeof question !== "string" || question.trim().length === 0) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const userKey = userKeyFrom(req);
  const ip = ipKey(req);
  const usingOwnKey = Boolean(userKey);

  if (!usingOwnKey) {
    const u = getUsage(ip);
    if (u.count >= FREE_QUOTA_PER_IP) {
      res.status(429).json({
        error: "quota_exceeded",
        quota: { used: u.count, limit: FREE_QUOTA_PER_IP, remaining: 0, resetAt: u.resetAt },
      });
      return;
    }
  }

  const provider = pickProvider(req);
  let openai: OpenAI;
  let model: string;
  try {
    const made = makeOpenAIClient(userKey, provider);
    openai = made.client;
    model = made.model;
  } catch {
    res.status(503).json({ error: "AI service not configured" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const trimmedHistory = Array.isArray(history)
    ? history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({ role: m.role, content: m.content }))
    : [];

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...trimmedHistory,
    { role: "user", content: question.trim() },
  ];

  const toolResults: Array<{ tool: string; args: Record<string, unknown> }> = [];
  let finalAnswer = "";
  let aborted = false;
  // NOTE: in Express 5 `req.on("close")` fires when the request body stream
  // ends (which happens immediately after express.json() consumes the body),
  // so we must listen on `res.on("close")` to detect actual client disconnect.
  res.on("close", () => { aborted = true; });

  const isFunctionCall = (tc: unknown): tc is OpenAI.Chat.Completions.ChatCompletionMessageToolCall & {
    type: "function";
    function: { name: string; arguments: string };
  } => typeof tc === "object" && tc !== null && (tc as { type?: string }).type === "function";

  // Strip <think>…</think> blocks to extract the real answer text.
  const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  try {
    // ── Phase 1: Tool-calling loops (non-streaming, max 3) ─────────────────
    // Non-streaming so we can cleanly parse tool call arguments.
    // brokeEarly = model answered before hitting the loop cap.
    let loopCount = 0;
    let brokeEarly = false;
    while (!aborted && loopCount < MAX_TOOL_LOOPS) {
      send("status", { phase: "thinking", loop: loopCount });

      const completion = await openai.chat.completions.create({
        model,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        max_completion_tokens: MAX_RESPONSE_TOKENS,
      });
      if (aborted) break;

      const choice = completion.choices[0];
      const fnCalls = (choice.message.tool_calls ?? []).filter(isFunctionCall);

      messages.push(choice.message as OpenAI.Chat.Completions.ChatCompletionMessageParam);

      // Model decided to answer directly — break into synthesis phase
      if (choice.finish_reason !== "tool_calls" || fnCalls.length === 0) {
        brokeEarly = true;
        break;
      }

      loopCount++;

      for (const tc of fnCalls) {
        if (aborted) break;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>; } catch {}
        send("tool_call", { tool: tc.function.name, args });
        let result: unknown;
        try { result = await executeTool(tc.function.name, args); }
        catch (e) { result = { error: String(e) }; }
        toolResults.push({ tool: tc.function.name, args });
        const truncated = truncateForModel(result);
        send("tool_result", { tool: tc.function.name, preview: truncated.slice(0, 800) });
        messages.push({ role: "tool", tool_call_id: tc.id, content: truncated });
      }
    }

    // ── Phase 2: Streaming synthesis ───────────────────────────────────────
    if (!aborted) {
      send("status", { phase: "synthesizing", loop: loopCount });

      // Extract last assistant message text, stripping think blocks.
      const lastAsst = [...messages].reverse()
        .find((m) => m.role === "assistant") as { role: "assistant"; content?: string | null } | undefined;
      const rawContent = (lastAsst?.content ?? "").trim();
      const realContent = stripThink(rawContent);

      if (brokeEarly && realContent) {
        // Model answered naturally before hitting the loop cap.
        // Stream the real (think-stripped) content as simulated chunks.
        const CHUNK = 24;
        for (let i = 0; i < realContent.length && !aborted; i += CHUNK) {
          send("token", { text: realContent.slice(i, i + CHUNK) });
          await new Promise((r) => setImmediate(r));
        }
        finalAnswer = realContent;
      } else {
        // Max loops reached (model was still calling tools) or no real content.
        // Force a direct answer using tool_choice:"none" and a brief Korean
        // instruction — avoids the English synthesis prompt that triggers filters.
        messages.push({
          role: "user",
          content: "지금까지 조회한 데이터를 바탕으로 질문에 답해주세요.",
        });
        const synthStream = await openai.chat.completions.create({
          model,
          messages,
          tools: TOOLS,
          tool_choice: "none",
          stream: true,
          max_completion_tokens: MAX_RESPONSE_TOKENS,
        });
        for await (const chunk of synthStream) {
          if (aborted) break;
          const token = chunk.choices[0]?.delta?.content ?? "";
          if (token) {
            send("token", { text: token });
            finalAnswer += token;
          }
        }
      }
    }

    let quotaInfo: { used: number; limit: number; remaining: number; resetAt: number } | null = null;
    if (!usingOwnKey && !aborted) {
      const u = getUsage(ip);
      u.count += 1;
      quotaInfo = {
        used: u.count,
        limit: FREE_QUOTA_PER_IP,
        remaining: Math.max(0, FREE_QUOTA_PER_IP - u.count),
        resetAt: u.resetAt,
      };
    }

    if (!aborted) {
      send("done", {
        answer: finalAnswer,
        toolsUsed: toolResults,
        model,
        provider: provider ?? null,
        usingOwnKey,
        quota: quotaInfo,
      });
    }
    res.end();
  } catch (err) {
    req.log.error(err, "AI stream error");
    if (!res.writableEnded) {
      send("error", { error: err instanceof Error ? err.message : String(err) });
      res.end();
    }
  }
});

router.get("/ai/status", (req, res) => {
  const configured = Boolean(
    process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  );
  const ip = ipKey(req);
  const u = getUsage(ip);
  res.json({
    configured,
    model: SERVER_MODEL,
    baseUrl:
      process.env.OPENAI_BASE_URL ??
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??
      "(default OpenAI)",
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({
      id,
      label: p.label,
      defaultModel: p.defaultModel,
    })),
    tools: TOOLS.map((t) => (t as { function: { name: string } }).function.name),
    quota: {
      used: u.count,
      limit: FREE_QUOTA_PER_IP,
      remaining: Math.max(0, FREE_QUOTA_PER_IP - u.count),
      resetAt: u.resetAt,
    },
  });
});

export default router;
