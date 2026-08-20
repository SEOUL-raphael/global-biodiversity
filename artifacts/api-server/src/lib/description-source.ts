import { logger } from "./logger";

export type DescriptionResult = {
  text: string;
  source: "gbif" | "wikipedia";
} | null;

const UA = "GBIF-Biodiversity-Dashboard/1.0 (+https://replit.com)";
const TIMEOUT_MS = 8000;

async function fetchJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function clean(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fromGbif(taxonKey: number): Promise<DescriptionResult> {
  type GbifDescResp = {
    results?: { description?: string; language?: string }[];
  };
  const data = await fetchJson<GbifDescResp>(
    `https://api.gbif.org/v1/species/${taxonKey}/descriptions?limit=20`,
  );
  if (!data?.results?.length) return null;
  const en =
    data.results.find(
      (r) => (r.language ?? "").toLowerCase().startsWith("en") && r.description,
    ) ?? data.results.find((r) => r.description);
  if (!en?.description) return null;
  const cleaned = clean(en.description);
  if (cleaned.length < 30) return null;
  return { text: cleaned.slice(0, 1500), source: "gbif" };
}

async function fromWikipedia(canonicalName: string): Promise<DescriptionResult> {
  const slug = encodeURIComponent(canonicalName.replace(/\s+/g, "_"));
  type WikiResp = { extract?: string; type?: string; title?: string };
  const data = await fetchJson<WikiResp>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}?redirect=true`,
  );
  if (!data?.extract) return null;
  if (data.type === "disambiguation") return null;
  const cleaned = clean(data.extract);
  if (cleaned.length < 30) return null;
  return { text: cleaned.slice(0, 1500), source: "wikipedia" };
}

export async function fetchDescription(
  taxonKey: number,
  canonicalName: string,
): Promise<DescriptionResult> {
  try {
    const gbif = await fromGbif(taxonKey);
    if (gbif) return gbif;
    const wiki = await fromWikipedia(canonicalName);
    if (wiki) return wiki;
    return null;
  } catch (err) {
    logger.warn({ err, taxonKey, canonicalName }, "[enrich] description fetch failed");
    return null;
  }
}
