import { useRoute, Link } from "wouter";
import {
  useGetGbifTaxon,
  useSearchGbifOccurrences,
  useGetKgSpeciesContext,
  useGetCogneeSpeciesGraph,
  getKgNodeContext,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Leaf,
  Globe,
  Eye,
  ShieldAlert,
  Network,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";
import { KgGraph, type KgNode, type KgEdge } from "@/components/KgGraph";
import { wikiUrl } from "@/lib/wiki";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { getTileForLang } from "@/lib/mapTiles";
import { apiUrl } from "@/lib/api-origin";

const IUCN_COLORS: Record<string, string> = {
  EX: "bg-gray-900 text-white",
  EXTINCT: "bg-gray-900 text-white",
  EW: "bg-gray-700 text-white",
  EXTINCT_IN_THE_WILD: "bg-gray-700 text-white",
  CR: "bg-red-600 text-white",
  CRITICALLY_ENDANGERED: "bg-red-600 text-white",
  EN: "bg-red-400 text-white",
  ENDANGERED: "bg-red-400 text-white",
  VU: "bg-orange-400 text-white",
  VULNERABLE: "bg-orange-400 text-white",
  NT: "bg-yellow-400 text-gray-900",
  NEAR_THREATENED: "bg-yellow-400 text-gray-900",
  LC: "bg-emerald-500 text-white",
  LEAST_CONCERN: "bg-emerald-500 text-white",
  DD: "bg-slate-300 text-slate-700",
  DATA_DEFICIENT: "bg-slate-300 text-slate-700",
  NE: "bg-slate-100 text-slate-600",
  NOT_EVALUATED: "bg-slate-100 text-slate-600",
};

const IUCN_LABELS: Record<string, string> = {
  EX: "Extinct", EXTINCT: "Extinct",
  EW: "Extinct in Wild", EXTINCT_IN_THE_WILD: "Extinct in Wild",
  CR: "Critically Endangered", CRITICALLY_ENDANGERED: "Critically Endangered",
  EN: "Endangered", ENDANGERED: "Endangered",
  VU: "Vulnerable", VULNERABLE: "Vulnerable",
  NT: "Near Threatened", NEAR_THREATENED: "Near Threatened",
  LC: "Least Concern", LEAST_CONCERN: "Least Concern",
  DD: "Data Deficient", DATA_DEFICIENT: "Data Deficient",
  NE: "Not Evaluated", NOT_EVALUATED: "Not Evaluated",
};

const IUCN_CODES: Record<string, string> = {
  EX: "EX", EXTINCT: "EX",
  EW: "EW", EXTINCT_IN_THE_WILD: "EW",
  CR: "CR", CRITICALLY_ENDANGERED: "CR",
  EN: "EN", ENDANGERED: "EN",
  VU: "VU", VULNERABLE: "VU",
  NT: "NT", NEAR_THREATENED: "NT",
  LC: "LC", LEAST_CONCERN: "LC",
  DD: "DD", DATA_DEFICIENT: "DD",
  NE: "NE", NOT_EVALUATED: "NE",
};

function IucnBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-slate-400 text-sm">—</span>;
  const cls = IUCN_COLORS[status] ?? "bg-slate-100 text-slate-600";
  const label = IUCN_LABELS[status] ?? status;
  const code = IUCN_CODES[status] ?? status;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}>
      <ShieldAlert className="w-3 h-3" />
      {code} · {label}
    </span>
  );
}

function TaxonomyRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-2 text-sm py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-slate-500 w-24 shrink-0 font-medium capitalize">{label}</span>
      <span className="text-slate-800">{value}</span>
    </div>
  );
}

export default function SpeciesDetail() {
  const [, params] = useRoute("/species/:taxonKey");
  const { t, lang } = useLang();
  const tile = getTileForLang(lang);
  const taxonKey = params?.taxonKey ? parseInt(params.taxonKey, 10) : null;

  const [occOffset, setOccOffset] = useState(0);
  const occLimit = 10;

  const { data: taxon, isLoading, error } = useGetGbifTaxon(
    taxonKey ?? 0,
    {
      query: {
        queryKey: ["gbif-taxon", taxonKey ?? 0],
        enabled: taxonKey !== null && !isNaN(taxonKey ?? NaN),
      },
    }
  );

  const { data: occurrences, isLoading: occLoading } = useSearchGbifOccurrences(
    { taxonKey: taxonKey ?? undefined, limit: occLimit, offset: occOffset },
    {
      query: {
        queryKey: ["gbif-occurrences", taxonKey ?? 0, occLimit, occOffset],
        enabled: !!taxonKey,
      },
    }
  );

  const { data: kgContext, isLoading: kgLoading } = useGetKgSpeciesContext(
    taxonKey ?? 0,
    { hops: 2 },
    {
      query: {
        queryKey: ["kg-species-context", taxonKey ?? 0, 2],
        enabled: !!taxonKey,
      },
    }
  );

  const MAX_DEPTH = 3;
  const [extraNodes, setExtraNodes] = useState<KgNode[]>([]);
  const [extraEdges, setExtraEdges] = useState<KgEdge[]>([]);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<number>>(new Set());
  const [nodeDepth, setNodeDepth] = useState<Map<number, number>>(new Map());
  const [loadingNodeId, setLoadingNodeId] = useState<number | null>(null);
  const [expandError, setExpandError] = useState<string | null>(null);

  // Reset expansion state when species changes or initial context reloads
  useEffect(() => {
    setExtraNodes([]);
    setExtraEdges([]);
    setExpandedNodeIds(new Set());
    setNodeDepth(new Map());
    setLoadingNodeId(null);
    setExpandError(null);
  }, [taxonKey, kgContext?.rootNode?.nodeId]);

  const normalizeNode = (n: KgNode): KgNode => ({ ...n, nodeId: Number(n.nodeId) });
  const normalizeEdge = (e: KgEdge): KgEdge => ({
    ...e,
    fromNode: Number(e.fromNode),
    toNode: Number(e.toNode),
  });

  const mergedGraph = useMemo(() => {
    const nodeMap = new Map<number, KgNode>();
    const edgeMap = new Map<string, KgEdge>();
    const baseNodes = ((kgContext?.nodes ?? []) as KgNode[]).map(normalizeNode);
    const baseEdges = ((kgContext?.edges ?? []) as KgEdge[]).map(normalizeEdge);
    for (const n of baseNodes) nodeMap.set(n.nodeId, n);
    for (const n of extraNodes) if (!nodeMap.has(n.nodeId)) nodeMap.set(n.nodeId, n);
    for (const e of baseEdges) {
      const k = `${e.fromNode}->${e.toNode}:${e.edgeType}`;
      edgeMap.set(k, e);
    }
    for (const e of extraEdges) {
      const k = `${e.fromNode}->${e.toNode}:${e.edgeType}`;
      if (!edgeMap.has(k)) edgeMap.set(k, e);
    }
    return {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
    };
  }, [kgContext, extraNodes, extraEdges]);

  const rootKgNodeId =
    kgContext?.rootNode?.nodeId != null ? Number(kgContext.rootNode.nodeId) : null;

  // BFS-derived depth-from-root for every node currently in the merged graph.
  // This is the single source of truth for depth so that nodes pulled in by the
  // initial 2-hop context (or by previous expansions) are correctly anchored to
  // the original species root, not assumed to be at depth=1.
  const depthFromRoot = useMemo(() => {
    const map = new Map<number, number>();
    if (rootKgNodeId === null) return map;
    const adjacency = new Map<number, Set<number>>();
    for (const e of mergedGraph.edges) {
      if (!adjacency.has(e.fromNode)) adjacency.set(e.fromNode, new Set());
      if (!adjacency.has(e.toNode)) adjacency.set(e.toNode, new Set());
      adjacency.get(e.fromNode)!.add(e.toNode);
      adjacency.get(e.toNode)!.add(e.fromNode);
    }
    map.set(rootKgNodeId, 0);
    const queue: number[] = [rootKgNodeId];
    while (queue.length) {
      const cur = queue.shift()!;
      const d = map.get(cur)!;
      for (const next of adjacency.get(cur) ?? []) {
        if (!map.has(next)) {
          map.set(next, d + 1);
          queue.push(next);
        }
      }
    }
    return map;
  }, [mergedGraph, rootKgNodeId]);

  const handleExpandNode = async (node: KgNode) => {
    if (expandedNodeIds.has(node.nodeId) || loadingNodeId !== null) return;
    // Use BFS-derived depth-from-root as the authoritative depth for this node.
    // Fall back to the per-expansion tracker only if the node is not yet
    // reachable in the current edge set (shouldn't normally happen).
    const currentDepth =
      depthFromRoot.get(node.nodeId) ?? nodeDepth.get(node.nodeId) ?? 1;
    if (currentDepth >= MAX_DEPTH) {
      setExpandError(`Max depth (${MAX_DEPTH}) reached`);
      return;
    }
    setLoadingNodeId(node.nodeId);
    setExpandError(null);
    try {
      const ctx = await getKgNodeContext(node.nodeId, { hops: 1 });
      const incomingNodes = (ctx.nodes as KgNode[]).map(normalizeNode);
      const incomingEdges = (ctx.edges as KgEdge[]).map(normalizeEdge);
      setExtraNodes((prev) => {
        const seen = new Set(prev.map((n) => n.nodeId));
        const additions: KgNode[] = [];
        for (const n of incomingNodes) {
          if (!seen.has(n.nodeId)) additions.push(n);
        }
        return [...prev, ...additions];
      });
      setExtraEdges((prev) => {
        const seenKeys = new Set(prev.map((e) => `${e.fromNode}->${e.toNode}:${e.edgeType}`));
        const additions: KgEdge[] = [];
        for (const e of incomingEdges) {
          const k = `${e.fromNode}->${e.toNode}:${e.edgeType}`;
          if (!seenKeys.has(k)) additions.push(e);
        }
        return [...prev, ...additions];
      });
      setNodeDepth((prev) => {
        const next = new Map(prev);
        const newDepth = currentDepth + 1;
        for (const n of incomingNodes) {
          if (n.nodeId === node.nodeId) continue;
          const existing = next.get(n.nodeId);
          if (existing === undefined || existing > newDepth) {
            next.set(n.nodeId, newDepth);
          }
        }
        return next;
      });
      setExpandedNodeIds((prev) => {
        const next = new Set(prev);
        next.add(node.nodeId);
        return next;
      });
    } catch (err) {
      setExpandError(err instanceof Error ? err.message : "Failed to expand node");
    } finally {
      setLoadingNodeId(null);
    }
  };

  const handleResetGraph = () => {
    setExtraNodes([]);
    setExtraEdges([]);
    setExpandedNodeIds(new Set());
    setNodeDepth(new Map());
    setLoadingNodeId(null);
    setExpandError(null);
  };

  const canExpandNode = (node: KgNode) => {
    if (node.nodeId === rootKgNodeId) return false;
    const depth =
      depthFromRoot.get(node.nodeId) ?? nodeDepth.get(node.nodeId) ?? 1;
    return depth < MAX_DEPTH;
  };

  const { data: cogneeGraph, isLoading: cogneeLoading, error: cogneeError } =
    useGetCogneeSpeciesGraph(taxonKey ?? 0, {
      query: {
        queryKey: ["cognee-species-graph", taxonKey ?? 0],
        enabled: !!taxonKey,
        retry: 0,
      },
    });

  if (!taxonKey || isNaN(taxonKey)) {
    return (
      <div className="text-center py-20 text-slate-500">
        <p>Invalid taxon key.</p>
        <Link href="/species" className="mt-4 inline-flex items-center gap-2 text-emerald-600 hover:underline text-sm">
          <ArrowLeft className="w-4 h-4" /> {t("navSpecies")}
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm animate-pulse">
        {t("loading")}
      </div>
    );
  }

  if (error || !taxon) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-slate-500">{t("error")}</p>
        <Link href="/species" className="inline-flex items-center gap-2 text-emerald-600 hover:underline text-sm">
          <ArrowLeft className="w-4 h-4" /> {t("navSpecies")}
        </Link>
      </div>
    );
  }

  const kgNodes = mergedGraph.nodes;
  const kgEdges = mergedGraph.edges;
  const hasExpansion = extraNodes.length > 0 || expandedNodeIds.size > 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/species">
          <button className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors">
            <ArrowLeft className="w-4 h-4 text-slate-600" />
          </button>
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 italic truncate">
            {taxon.canonicalName ?? taxon.scientificName}
          </h1>
          {taxon.vernacularName && (
            <p className="text-sm text-slate-500 not-italic">{taxon.vernacularName}</p>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-1">
          <div className="flex items-center gap-2 mb-3">
            <Leaf className="w-4 h-4 text-emerald-600" />
            <h2 className="font-semibold text-slate-800 text-sm">{t("taxonomy")}</h2>
          </div>
          <TaxonomyRow label={t("rank")} value={taxon.rank} />
          <TaxonomyRow label={t("kingdom")} value={taxon.kingdom} />
          <TaxonomyRow label="Phylum" value={taxon.phylum} />
          <TaxonomyRow label="Class" value={taxon.class} />
          <TaxonomyRow label="Order" value={taxon.order} />
          <TaxonomyRow label={t("family")} value={taxon.family} />
          <TaxonomyRow label="Genus" value={taxon.genus} />
          <TaxonomyRow label={t("scientificName")} value={taxon.scientificName} />
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert className="w-4 h-4 text-red-500" />
            <h2 className="font-semibold text-slate-800 text-sm">{t("iucnStatus")}</h2>
          </div>
          <div>
            <IucnBadge status={taxon.iucnStatus} />
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="w-4 h-4 text-blue-500" />
              <h2 className="font-semibold text-slate-800 text-sm">{t("occurrences")}</h2>
            </div>
            <div className="flex gap-4">
              <div className="bg-blue-50 rounded-lg px-3 py-2 text-center">
                <p className="text-xl font-bold text-blue-700">{(taxon.numOccurrences ?? 0).toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-0.5">{t("occurrences")}</p>
              </div>
              {taxon.extinct?.toLowerCase() === "true" && (
                <div className="bg-gray-100 rounded-lg px-3 py-2 text-center">
                  <p className="text-sm font-semibold text-gray-700">{t("extinct")}</p>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-emerald-500" />
              <h2 className="font-semibold text-slate-800 text-sm">{t("externalLinks")}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://www.gbif.org/species/${taxon.taxonKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors"
              >
                <ExternalLink className="w-3 h-3" /> GBIF
              </a>
              <a
                href={wikiUrl(taxon.canonicalName ?? taxon.scientificName ?? "", lang)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                <ExternalLink className="w-3 h-3" /> Wikipedia
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Eye className="w-4 h-4 text-blue-500" />
          <h2 className="font-semibold text-slate-800 text-sm">{t("recentOccurrences")}</h2>
        </div>

        {occLoading && (
          <p className="text-sm text-slate-400 py-4 text-center animate-pulse">{t("loading")}</p>
        )}

        {occurrences && occurrences.results.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-3 py-2 font-medium text-slate-500">Country</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500">Year</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500">Lat</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500">Lon</th>
                    <th className="text-left px-3 py-2 font-medium text-slate-500">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {occurrences.results.map((occ) => (
                    <tr key={occ.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-700">{occ.countryCode ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{occ.year ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{occ.decimalLatitude?.toFixed(2) ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{occ.decimalLongitude?.toFixed(2) ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-400 truncate max-w-[100px]">{occ.basisOfRecord ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 mt-3">
              <button
                onClick={() => setOccOffset(Math.max(0, occOffset - occLimit))}
                disabled={occOffset === 0}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3 h-3" /> {t("prev")}
              </button>
              <span className="text-xs text-slate-500">
                {occOffset + 1}–{Math.min(occOffset + occLimit, occurrences.total)} / {occurrences.total}
              </span>
              <button
                onClick={() => setOccOffset(occOffset + occLimit)}
                disabled={occOffset + occLimit >= occurrences.total}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("next")} <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </>
        ) : (
          !occLoading && (
            <p className="text-sm text-slate-400 py-4 text-center">{t("noOccurrences")}</p>
          )
        )}
      </div>

      {(() => {
        const geoOccurrences = (occurrences?.results ?? []).filter(
          (o): o is typeof o & { decimalLatitude: number; decimalLongitude: number } =>
            typeof o.decimalLatitude === "number" && typeof o.decimalLongitude === "number"
        );
        if (geoOccurrences.length === 0) return null;
        const avgLat =
          geoOccurrences.reduce((s, o) => s + o.decimalLatitude, 0) / geoOccurrences.length;
        const avgLon =
          geoOccurrences.reduce((s, o) => s + o.decimalLongitude, 0) / geoOccurrences.length;
        return (
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-4 h-4 text-emerald-600" />
              <h2 className="font-semibold text-slate-800 text-sm">{t("recentOccurrences")}</h2>
              <span className="text-xs text-slate-400">
                {geoOccurrences.length} {t("occurrences")}
              </span>
            </div>
            <div className="rounded-xl overflow-hidden border border-slate-200 relative z-0 h-[260px] sm:h-[400px]">
              <MapContainer
                center={[avgLat, avgLon]}
                zoom={2}
                scrollWheelZoom={false}
                style={{ height: "100%", width: "100%" }}
                worldCopyJump={true}
              >
                <TileLayer
                  key={tile.url}
                  attribution={tile.attribution}
                  url={tile.url}
                  subdomains={tile.subdomains}
                  maxZoom={tile.maxZoom ?? 19}
                />
                {geoOccurrences.map((o) => (
                  <CircleMarker
                    key={o.id}
                    center={[o.decimalLatitude, o.decimalLongitude]}
                    radius={6}
                    pathOptions={{
                      color: "#10b981",
                      fillColor: "#10b981",
                      fillOpacity: 0.7,
                      weight: 1.5,
                    }}
                  >
                    <Popup>
                      <div className="text-xs">
                        <div className="font-semibold text-slate-800">
                          {o.countryCode ?? "—"}
                        </div>
                        <div className="text-slate-600">{o.year ?? "—"}</div>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          </div>
        );
      })()}

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-purple-600" />
            <h2 className="font-semibold text-slate-800 text-sm">{t("kgContext")}</h2>
          </div>
          <div className="flex items-center gap-2">
            {kgContext && (
              <span className="text-xs text-slate-400">
                {kgNodes.length} {t("nodes")} · {kgEdges.length} {t("edges")}
              </span>
            )}
            {hasExpansion && (
              <button
                onClick={handleResetGraph}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
              >
                <RotateCcw className="w-3 h-3" /> {t("kgReset")}
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-3">{t("kgContextDesc")}</p>

        {expandError && (
          <div className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
            {expandError}
          </div>
        )}

        {kgLoading && (
          <div className="py-8 text-center text-slate-400 text-sm animate-pulse">{t("loading")}</div>
        )}

        {!kgLoading && kgNodes.length > 0 && (
          <KgGraph
            rootNodeId={rootKgNodeId}
            nodes={kgNodes}
            edges={kgEdges}
            height={380}
            onNodeClick={handleExpandNode}
            expandedNodeIds={expandedNodeIds}
            loadingNodeId={loadingNodeId}
            canExpand={canExpandNode}
          />
        )}

        {!kgLoading && kgNodes.length === 0 && (
          <div className="py-8 text-center text-slate-400 text-sm">
            {t("kgNoData")}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-emerald-600" />
            <h2 className="font-semibold text-slate-800 text-sm">
              {t("cogneeGraphSection")}
            </h2>
          </div>
          {cogneeGraph && (
            <span className="text-xs text-slate-400">
              {cogneeGraph.nodeCount} {t("nodes")} · {cogneeGraph.edgeCount} {t("edges")}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-3">{t("cogneeGraphDesc")}</p>

        {cogneeLoading && (
          <div className="py-6 text-center text-slate-400 text-sm animate-pulse">
            {t("loading")}
          </div>
        )}

        {!cogneeLoading && cogneeError && (
          <div className="py-6 text-center text-slate-400 text-sm">
            {t("kgNoData")}
          </div>
        )}

        {!cogneeLoading && cogneeGraph && cogneeGraph.nodes.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {cogneeGraph.nodes.slice(0, 30).map((n) => (
                <span
                  key={n.externalId}
                  className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-800 border border-emerald-100 px-2 py-1 rounded-full"
                  title={n.nodeType}
                >
                  <span className="font-medium">{n.label}</span>
                  <span className="text-[10px] text-emerald-600 uppercase tracking-wide">
                    {n.nodeType}
                  </span>
                </span>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <a
                href={apiUrl(`/api/cognee/graph/species/${taxonKey}`)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-slate-500 hover:text-emerald-700 inline-flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" /> /api/cognee/graph/species/{taxonKey}
              </a>
              <Link
                href="/cognee"
                className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1"
              >
                {t("cogneeTitle")} <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        )}

        {!cogneeLoading && !cogneeError && cogneeGraph && cogneeGraph.nodes.length === 0 && (
          <div className="py-6 text-center text-slate-400 text-sm">
            {t("kgNoData")}
          </div>
        )}
      </div>
    </div>
  );
}
