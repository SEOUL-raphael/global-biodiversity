import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  gbifTaxa,
  gbifOccurrences,
  gbifRegions,
  gbifSyncLog,
} from "@workspace/db/schema";
import { eq, ilike, or, desc, count, sql } from "drizzle-orm";

const router: IRouter = Router();

function parsePositiveInt(val: unknown, defaultVal: number): number | null {
  if (val === undefined || val === null || val === "") return defaultVal;
  const n = parseInt(String(val), 10);
  if (isNaN(n) || n < 0) return null;
  return n;
}

function mapTaxon(t: typeof gbifTaxa.$inferSelect) {
  return {
    taxonKey: t.taxonKey,
    parentKey: t.parentKey,
    rank: t.rank,
    kingdom: t.kingdom,
    phylum: t.phylum,
    class: t.class,
    order: t.order,
    family: t.family,
    genus: t.genus,
    species: t.species,
    scientificName: t.scientificName,
    canonicalName: t.canonicalName,
    vernacularName: t.vernacularName,
    iucnStatus: t.iucnStatus,
    numOccurrences: Number(t.numOccurrences),
    extinct: t.extinct,
  };
}

router.get("/gbif/status", async (req, res) => {
  try {
    const [taxaCountRow] = await db
      .select({ count: count() })
      .from(gbifTaxa);
    const [occCountRow] = await db
      .select({ count: count() })
      .from(gbifOccurrences);
    const [regionCountRow] = await db
      .select({ count: count() })
      .from(gbifRegions);

    const recentSyncs = await db
      .select()
      .from(gbifSyncLog)
      .orderBy(desc(gbifSyncLog.startedAt))
      .limit(5);

    const lastSync = recentSyncs[0]?.finishedAt?.toISOString() ?? null;

    res.json({
      taxaCount: Number(taxaCountRow?.count ?? 0),
      occurrenceCount: Number(occCountRow?.count ?? 0),
      regionCount: Number(regionCountRow?.count ?? 0),
      lastSync,
      recentSyncs: recentSyncs.map((s) => ({
        id: Number(s.id),
        syncType: s.syncType,
        status: s.status,
        recordsProcessed: s.recordsProcessed,
        checkpoint: s.checkpoint,
        errorMessage: s.errorMessage,
        startedAt: s.startedAt.toISOString(),
        finishedAt: s.finishedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    req.log.error(err, "Failed to get GBIF status");
    res.status(500).json({ error: "internal_error", message: "Failed to get status" });
  }
});

router.get("/gbif/taxa", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
  const rank = typeof req.query.rank === "string" ? req.query.rank : undefined;
  const kingdom = typeof req.query.kingdom === "string" ? req.query.kingdom : undefined;
  const iucnStatus = typeof req.query.iucnStatus === "string" ? req.query.iucnStatus : undefined;

  const rawLimit = parsePositiveInt(req.query.limit, 20);
  const rawOffset = parsePositiveInt(req.query.offset, 0);

  if (rawLimit === null || rawOffset === null) {
    res.status(400).json({ error: "bad_request", message: "limit and offset must be non-negative integers" });
    return;
  }
  const limit = Math.min(rawLimit, 100);
  const offset = rawOffset;

  try {
    const conditions = [];

    if (q) {
      conditions.push(
        or(
          ilike(gbifTaxa.canonicalName, `%${q}%`),
          ilike(gbifTaxa.scientificName, `%${q}%`),
          ilike(gbifTaxa.vernacularName, `%${q}%`),
        ),
      );
    }
    if (rank) conditions.push(eq(gbifTaxa.rank, rank.toUpperCase()));
    if (kingdom) conditions.push(ilike(gbifTaxa.kingdom, kingdom));
    if (iucnStatus) conditions.push(eq(gbifTaxa.iucnStatus, iucnStatus));

    const whereClause = conditions.length > 0
      ? sql`${conditions.reduce((acc, c) => sql`${acc} AND ${c}`)}`
      : undefined;

    const [totalRow] = await db
      .select({ count: count() })
      .from(gbifTaxa)
      .where(whereClause);

    const results = await db
      .select()
      .from(gbifTaxa)
      .where(whereClause)
      .limit(limit)
      .offset(offset)
      .orderBy(desc(gbifTaxa.numOccurrences));

    res.json({
      total: Number(totalRow?.count ?? 0),
      offset,
      limit,
      results: results.map(mapTaxon),
    });
  } catch (err) {
    req.log.error(err, "Failed to search GBIF taxa");
    res.status(500).json({ error: "internal_error", message: "Failed to search taxa" });
  }
});

router.get("/gbif/taxa/:taxonKey", async (req, res) => {
  const key = parseInt(req.params.taxonKey, 10);
  if (isNaN(key) || key <= 0) {
    res.status(400).json({ error: "bad_request", message: "Invalid taxon key" });
    return;
  }

  try {
    const [taxon] = await db
      .select()
      .from(gbifTaxa)
      .where(eq(gbifTaxa.taxonKey, key))
      .limit(1);

    if (!taxon) {
      res.status(404).json({ error: "not_found", message: "Taxon not found" });
      return;
    }

    res.json(mapTaxon(taxon));
  } catch (err) {
    req.log.error(err, "Failed to get GBIF taxon");
    res.status(500).json({ error: "internal_error", message: "Failed to get taxon" });
  }
});

router.get("/gbif/occurrences", async (req, res) => {
  const rawTaxonKey = req.query.taxonKey != null && req.query.taxonKey !== ""
    ? parseInt(String(req.query.taxonKey), 10)
    : undefined;
  const rawYear = req.query.year != null && req.query.year !== ""
    ? parseInt(String(req.query.year), 10)
    : undefined;

  if (rawTaxonKey !== undefined && (isNaN(rawTaxonKey) || rawTaxonKey <= 0)) {
    res.status(400).json({ error: "bad_request", message: "taxonKey must be a positive integer" });
    return;
  }
  if (rawYear !== undefined && (isNaN(rawYear) || rawYear < 1000 || rawYear > 9999)) {
    res.status(400).json({ error: "bad_request", message: "year must be a valid 4-digit year" });
    return;
  }

  const countryCode = typeof req.query.countryCode === "string"
    ? req.query.countryCode.toUpperCase().slice(0, 2)
    : undefined;

  const rawLimit = parsePositiveInt(req.query.limit, 20);
  const rawOffset = parsePositiveInt(req.query.offset, 0);

  if (rawLimit === null || rawOffset === null) {
    res.status(400).json({ error: "bad_request", message: "limit and offset must be non-negative integers" });
    return;
  }
  const limit = Math.min(rawLimit, 100);
  const offset = rawOffset;

  try {
    const conditions = [];
    if (rawTaxonKey !== undefined) conditions.push(eq(gbifOccurrences.taxonKey, rawTaxonKey));
    if (countryCode) conditions.push(eq(gbifOccurrences.countryCode, countryCode));
    if (rawYear !== undefined) conditions.push(eq(gbifOccurrences.year, rawYear));

    const whereClause = conditions.length > 0
      ? sql`${conditions.reduce((acc, c) => sql`${acc} AND ${c}`)}`
      : undefined;

    const [totalRow] = await db
      .select({ count: count() })
      .from(gbifOccurrences)
      .where(whereClause);

    const results = await db
      .select()
      .from(gbifOccurrences)
      .where(whereClause)
      .limit(limit)
      .offset(offset);

    res.json({
      total: Number(totalRow?.count ?? 0),
      offset,
      limit,
      results: results.map((r) => ({
        id: Number(r.id),
        taxonKey: r.taxonKey,
        countryCode: r.countryCode,
        decimalLatitude: r.decimalLatitude,
        decimalLongitude: r.decimalLongitude,
        year: r.year,
        month: r.month,
        basisOfRecord: r.basisOfRecord,
      })),
    });
  } catch (err) {
    req.log.error(err, "Failed to search GBIF occurrences");
    res.status(500).json({ error: "internal_error", message: "Failed to search occurrences" });
  }
});

router.get("/gbif/regions", async (req, res) => {
  try {
    const rawLimit = parsePositiveInt(req.query.limit, 50);
    if (rawLimit === null) {
      res.status(400).json({ error: "bad_request", message: "limit must be a non-negative integer" });
      return;
    }
    const limit = Math.min(rawLimit, 250);

    const regions = await db
      .select()
      .from(gbifRegions)
      .orderBy(desc(gbifRegions.occurrenceCount))
      .limit(limit);

    res.json(
      regions.map((r) => ({
        countryCode: r.countryCode,
        countryName: r.countryName,
        occurrenceCount: Number(r.occurrenceCount),
        speciesCount: r.speciesCount,
        lastSynced: r.lastSynced?.toISOString() ?? null,
      })),
    );
  } catch (err) {
    req.log.error(err, "Failed to list GBIF regions");
    res.status(500).json({ error: "internal_error", message: "Failed to list regions" });
  }
});

export default router;
