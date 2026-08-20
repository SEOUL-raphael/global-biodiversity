import { db } from "@workspace/db";
import { gbifTaxa } from "@workspace/db/schema";
import { isNotNull, sql, desc } from "drizzle-orm";
import { embed, cosineSim, EMBED_DIM } from "./embed";
import { logger } from "./logger";

type Row = {
  taxonKey: number;
  scientificName: string | null;
  canonicalName: string | null;
  rank: string | null;
  kingdom: string | null;
  iucnStatus: string | null;
  numOccurrences: number;
  description: string | null;
  embedding: number[] | null;
};

const CORPUS_LIMIT = 20000;
const CACHE_TTL_MS = 60_000;
const MIN_SCORE = 0.2;

let cache: { rows: Row[]; loadedAt: number } | null = null;

async function loadCorpus(): Promise<Row[]> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.rows;
  const rows = (await db
    .select({
      taxonKey: gbifTaxa.taxonKey,
      scientificName: gbifTaxa.scientificName,
      canonicalName: gbifTaxa.canonicalName,
      rank: gbifTaxa.rank,
      kingdom: gbifTaxa.kingdom,
      iucnStatus: gbifTaxa.iucnStatus,
      numOccurrences: gbifTaxa.numOccurrences,
      description: gbifTaxa.description,
      embedding: gbifTaxa.embedding,
    })
    .from(gbifTaxa)
    .where(isNotNull(gbifTaxa.embedding))
    .orderBy(desc(gbifTaxa.numOccurrences))
    .limit(CORPUS_LIMIT)) as Row[];
  if (rows.length === CORPUS_LIMIT) {
    logger.warn(
      { limit: CORPUS_LIMIT },
      "[semantic-search] corpus cap reached — increase CORPUS_LIMIT or migrate to pgvector",
    );
  }
  cache = { rows, loadedAt: now };
  return rows;
}

export function invalidateSemanticCache() {
  cache = null;
}

export type SemanticHit = {
  taxonKey: number;
  scientificName: string | null;
  canonicalName: string | null;
  rank: string | null;
  kingdom: string | null;
  iucnStatus: string | null;
  numOccurrences: number;
  description: string | null;
  score: number;
};

export type SemanticSearchResult = {
  query: string;
  corpusSize: number;
  totalDescribed: number;
  results: SemanticHit[];
};

export async function semanticSearch(
  query: string,
  limit = 10,
): Promise<SemanticSearchResult> {
  const trimmed = query.trim().slice(0, 500);
  if (!trimmed) {
    return { query: "", corpusSize: 0, totalDescribed: 0, results: [] };
  }
  const safeLimit = Math.max(1, Math.min(50, Number.isFinite(limit) ? Math.trunc(limit) : 10));
  const [corpus, sizes] = await Promise.all([loadCorpus(), getCorpusSize()]);
  if (corpus.length === 0) {
    return { query: trimmed, corpusSize: 0, totalDescribed: sizes.described, results: [] };
  }
  const qvec = await embed(trimmed);
  if (qvec.length !== EMBED_DIM) {
    return { query: trimmed, corpusSize: corpus.length, totalDescribed: sizes.described, results: [] };
  }
  const scored = corpus
    .map((r) => ({ r, score: r.embedding ? cosineSim(qvec, r.embedding) : 0 }))
    .filter(({ score }) => score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, safeLimit);
  return {
    query: trimmed,
    corpusSize: corpus.length,
    totalDescribed: sizes.described,
    results: scored.map(({ r, score }) => ({
      taxonKey: r.taxonKey,
      scientificName: r.scientificName,
      canonicalName: r.canonicalName,
      rank: r.rank,
      kingdom: r.kingdom,
      iucnStatus: r.iucnStatus,
      numOccurrences: r.numOccurrences,
      description: r.description ? r.description.slice(0, 280) : null,
      score: Number(score.toFixed(4)),
    })),
  };
}

export async function getCorpusSize(): Promise<{ described: number; embedded: number; total: number }> {
  const r = await db
    .select({
      total: sql<number>`count(*)::int`,
      described: sql<number>`count(*) filter (where ${gbifTaxa.description} is not null)::int`,
      embedded: sql<number>`count(*) filter (where ${gbifTaxa.embedding} is not null)::int`,
    })
    .from(gbifTaxa);
  return r[0] ?? { total: 0, described: 0, embedded: 0 };
}
