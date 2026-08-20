import type { Lang } from "./i18n";

const WIKI_DOMAIN: Record<Lang, string> = {
  en: "en",
  ko: "ko",
  fr: "fr",
  es: "es",
  ru: "ru",
  zh: "zh",
  ar: "ar",
};

function toArticleSlug(query: string): string {
  return encodeURIComponent(query.trim().replace(/\s+/g, "_"));
}

/**
 * Wikipedia link for a scientific name (species, family, genus, etc.).
 * Always points to English Wikipedia because taxonomic articles are
 * canonical there. Wikipedia auto-redirects unknown titles to the search
 * results page, so a direct /wiki/<Title> link works as both a hit and a
 * graceful fallback — and avoids the extra Special:Search round-trip.
 */
export function wikiUrl(query: string, _lang?: Lang): string {
  return `https://en.wikipedia.org/wiki/${toArticleSlug(query)}`;
}

/**
 * GBIF species page for a known taxon key.
 * https://www.gbif.org/species/{taxonKey}
 */
export function gbifSpeciesUrl(taxonKey: number): string {
  return `https://www.gbif.org/species/${taxonKey}`;
}

/**
 * GBIF name-based search URL — use when only the name is available (no taxon key).
 * rank: 'SPECIES' | 'GENUS' | 'FAMILY' | 'ORDER' | 'CLASS' | 'PHYLUM' | 'KINGDOM'
 */
export function gbifNameUrl(name: string, rank?: string): string {
  const params = new URLSearchParams({ q: name.trim() });
  if (rank) params.set("rank", rank);
  return `https://www.gbif.org/species/search?${params.toString()}`;
}

/**
 * Wikipedia link for a country / region. Uses the user's language wiki
 * because country articles are well-translated and more useful in the
 * reader's own language.
 */
export function countryWikiUrl(countryName: string, lang: Lang = "en"): string {
  const domain = WIKI_DOMAIN[lang] ?? "en";
  const trimmed = countryName.trim();
  // If the caller couldn't resolve a real name and just passed the raw
  // 2-letter ISO code (e.g. "UY"), a direct /wiki/UY page rarely exists.
  // Fall back to Special:Search so the user lands on something useful.
  if (/^[A-Z]{2,3}$/.test(trimmed)) {
    return `https://${domain}.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(
      `ISO 3166 ${trimmed}`,
    )}`;
  }
  return `https://${domain}.wikipedia.org/wiki/${toArticleSlug(trimmed)}`;
}
