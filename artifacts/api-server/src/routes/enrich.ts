import { Router, type IRouter } from "express";
import { getEnrichStats } from "../jobs/enrich";
import { getCorpusSize, semanticSearch } from "../lib/semantic-search";

const router: IRouter = Router();

router.get("/enrich/status", async (_req, res) => {
  try {
    const [size, stats] = await Promise.all([getCorpusSize(), Promise.resolve(getEnrichStats())]);
    res.json({
      corpus: size,
      job: stats,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "unknown" });
  }
});

// Naive in-process rate limit so cold ONNX inference can't be DoS'd.
const SEARCH_WINDOW_MS = 60_000;
const SEARCH_MAX_PER_WINDOW = 30;
const searchHits = new Map<string, { count: number; resetAt: number }>();

router.get("/enrich/search", async (req, res) => {
  const raw = String(req.query.q ?? "");
  const q = raw.trim().slice(0, 500);
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(25, Math.trunc(rawLimit))) : 10;

  if (!q) {
    res.status(400).json({ error: "query parameter 'q' is required" });
    return;
  }
  if (raw.length > 500) {
    res.status(413).json({ error: "query too long (max 500 chars)" });
    return;
  }

  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const hit = searchHits.get(ip);
  if (!hit || hit.resetAt < now) {
    searchHits.set(ip, { count: 1, resetAt: now + SEARCH_WINDOW_MS });
  } else {
    hit.count++;
    if (hit.count > SEARCH_MAX_PER_WINDOW) {
      res.status(429).json({ error: "rate_limited", resetAt: hit.resetAt });
      return;
    }
  }

  try {
    const result = await semanticSearch(q, limit);
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : "semantic search unavailable" });
  }
});

export default router;
