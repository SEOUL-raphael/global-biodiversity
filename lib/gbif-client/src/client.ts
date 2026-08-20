import type {
  GbifTaxon,
  GbifOccurrence,
  GbifPaginatedResponse,
  GbifSpeciesSearchParams,
  GbifOccurrenceSearchParams,
  GbifOccurrenceCountParams,
} from "./types.js";

const GBIF_BASE_URL = "https://api.gbif.org/v1";
const REQUEST_INTERVAL_MS = 120;

let lastRequestTime = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < REQUEST_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

async function gbifFetch<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  await throttle();

  const url = new URL(`${GBIF_BASE_URL}${path}`);
  if (params) {
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null) {
        url.searchParams.set(key, String(val));
      }
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`GBIF API error: ${res.status} ${res.statusText} — ${url.toString()}`);
  }

  return res.json() as Promise<T>;
}

export async function searchSpecies(
  params: GbifSpeciesSearchParams,
): Promise<GbifPaginatedResponse<GbifTaxon>> {
  return gbifFetch<GbifPaginatedResponse<GbifTaxon>>("/species/search", params as Record<string, string | number | boolean | undefined>);
}

export async function getSpecies(key: number): Promise<GbifTaxon> {
  return gbifFetch<GbifTaxon>(`/species/${key}`);
}

export async function getSpeciesChildren(
  key: number,
  offset = 0,
  limit = 100,
): Promise<GbifPaginatedResponse<GbifTaxon>> {
  return gbifFetch<GbifPaginatedResponse<GbifTaxon>>(
    `/species/${key}/children`,
    { offset, limit },
  );
}

export async function getSpeciesParents(key: number): Promise<GbifTaxon[]> {
  return gbifFetch<GbifTaxon[]>(`/species/${key}/parents`);
}

export async function searchOccurrences(
  params: GbifOccurrenceSearchParams,
): Promise<GbifPaginatedResponse<GbifOccurrence>> {
  return gbifFetch<GbifPaginatedResponse<GbifOccurrence>>(
    "/occurrence/search",
    params as Record<string, string | number | boolean | undefined>,
  );
}

export async function countOccurrences(
  params: GbifOccurrenceCountParams,
): Promise<number> {
  return gbifFetch<number>("/occurrence/count", params as Record<string, string | number | boolean | undefined>);
}

export async function* paginateSpecies(
  params: GbifSpeciesSearchParams,
  pageSize = 100,
): AsyncGenerator<GbifTaxon> {
  let offset = 0;
  while (true) {
    const page = await searchSpecies({ ...params, offset, limit: pageSize });
    for (const taxon of page.results) {
      yield taxon;
    }
    if (page.endOfRecords) break;
    offset += pageSize;
  }
}

export async function* paginateOccurrences(
  params: GbifOccurrenceSearchParams,
  pageSize = 300,
): AsyncGenerator<GbifOccurrence> {
  let offset = 0;
  while (true) {
    const page = await searchOccurrences({ ...params, offset, limit: pageSize });
    for (const occ of page.results) {
      yield occ;
    }
    if (page.endOfRecords || offset + pageSize >= 100_000) break;
    offset += pageSize;
  }
}
