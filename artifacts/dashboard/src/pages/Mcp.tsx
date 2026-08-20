import { useState } from "react";
import { useGetMcpStatus } from "@workspace/api-client-react";
import {
  Cpu,
  Check,
  Copy,
  Server,
  Wrench,
  BookOpen,
  CircleDot,
  Search,
  Network,
  ShieldAlert,
  Link2,
  Layers,
  MapPin,
  Map as MapIcon,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { useLang, type Lang } from "@/lib/i18n";
import { apiUrl } from "@/lib/api-origin";

interface ToolParam {
  name: string;
  type: string;
  required?: boolean;
  desc: string;
}

interface ToolMeta {
  icon: React.ElementType;
  color: string;
  descKey: keyof Translations;
  returnsKey: keyof Translations;
  params: ToolParam[];
}

type Translations = Parameters<ReturnType<typeof useLang>["t"]>[0] extends infer K
  ? K extends string
    ? Record<K, Record<Lang, string>>
    : never
  : never;

const TOOL_INFO: Record<string, ToolMeta> = {
  search_species: {
    icon: Search,
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    descKey: "toolSearchSpeciesDesc" as never,
    returnsKey: "toolSearchSpeciesReturns" as never,
    params: [
      { name: "query", type: "string", required: true, desc: "e.g. \"Panthera\", \"Orchis\"" },
      { name: "limit", type: "integer", desc: "default 10, max 50" },
    ],
  },
  get_species_context: {
    icon: Network,
    color: "bg-purple-50 text-purple-700 border-purple-200",
    descKey: "toolSpeciesContextDesc" as never,
    returnsKey: "toolSpeciesContextReturns" as never,
    params: [
      { name: "taxon_key", type: "integer", required: true, desc: "GBIF taxon key" },
      { name: "hops", type: "integer", desc: "1 or 2 (default 2)" },
    ],
  },
  find_endangered_hotspots: {
    icon: ShieldAlert,
    color: "bg-rose-50 text-rose-700 border-rose-200",
    descKey: "toolEndangeredDesc" as never,
    returnsKey: "toolEndangeredReturns" as never,
    params: [{ name: "limit", type: "integer", desc: "default 10" }],
  },
  get_cooccurrence_clusters: {
    icon: Link2,
    color: "bg-blue-50 text-blue-700 border-blue-200",
    descKey: "toolCooccurDesc" as never,
    returnsKey: "toolCooccurReturns" as never,
    params: [
      { name: "region", type: "string", desc: "ISO 2-letter code (e.g. \"US\", \"KR\")" },
      { name: "min_jaccard", type: "number", desc: "0–1, default 0.1" },
      { name: "limit", type: "integer", desc: "default 20" },
    ],
  },
  get_taxonomy_gaps: {
    icon: Layers,
    color: "bg-amber-50 text-amber-700 border-amber-200",
    descKey: "toolGapsDesc" as never,
    returnsKey: "toolGapsReturns" as never,
    params: [{ name: "limit", type: "integer", desc: "default 20" }],
  },
  semantic_search_species: {
    icon: Search,
    color: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
    descKey: "toolSemanticDesc" as never,
    returnsKey: "toolSemanticReturns" as never,
    params: [
      { name: "query", type: "string", required: true, desc: "natural-language description (e.g. \"small nocturnal cat with spots\")" },
      { name: "limit", type: "integer", desc: "default 10, max 25" },
    ],
  },
  search_species_by_location: {
    icon: MapPin,
    color: "bg-teal-50 text-teal-700 border-teal-200",
    descKey: "toolByLocationDesc" as never,
    returnsKey: "toolByLocationReturns" as never,
    params: [
      { name: "latitude", type: "number", required: true, desc: "-90 to 90" },
      { name: "longitude", type: "number", required: true, desc: "-180 to 180" },
      { name: "radius_km", type: "number", desc: "default 50, max 5000" },
      { name: "limit", type: "integer", desc: "default 20, max 100" },
    ],
  },
  get_occurrence_hotspots: {
    icon: MapIcon,
    color: "bg-indigo-50 text-indigo-700 border-indigo-200",
    descKey: "toolHotspotsDesc" as never,
    returnsKey: "toolHotspotsReturns" as never,
    params: [
      { name: "resolution_deg", type: "number", desc: "0.5–20, default 2 (~220km)" },
      { name: "min_lat / max_lat", type: "number", desc: "optional bounding box" },
      { name: "min_lon / max_lon", type: "number", desc: "optional bounding box" },
      { name: "limit", type: "integer", desc: "default 20, max 200" },
    ],
  },
};

function getMcpUrl(): string {
  return apiUrl("/mcp");
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useLang();
  return (
    <div className="relative group">
      <pre className="bg-slate-900 text-slate-100 text-xs sm:text-sm rounded-lg p-3 sm:p-4 overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1 opacity-80 hover:opacity-100"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline">{copied ? t("copied") : t("copy")}</span>
      </button>
    </div>
  );
}

function ToolCard({ name }: { name: string }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const meta = TOOL_INFO[name];

  if (!meta) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
        <Wrench className="w-3.5 h-3.5 text-purple-500 shrink-0" />
        <code className="text-xs font-mono text-slate-700 truncate">{name}</code>
      </div>
    );
  }

  const Icon = meta.icon;
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 p-3 sm:p-4 text-left hover:bg-slate-50 transition-colors"
      >
        <div className={`shrink-0 p-2 rounded-lg border ${meta.color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-sm font-semibold text-slate-900">{name}</code>
            {meta.params.some((p) => p.required) && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                {meta.params.filter((p) => p.required).length} {t("mcpToolRequired")}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs sm:text-[13px] text-slate-600 leading-relaxed">
            {t(meta.descKey)}
          </p>
        </div>
        <div className="shrink-0 mt-1 text-slate-400">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-3 sm:px-4 py-3 bg-slate-50/50 space-y-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              {t("mcpToolParams")}
            </div>
            <div className="space-y-1.5">
              {meta.params.map((p) => (
                <div key={p.name} className="flex items-baseline gap-2 text-xs">
                  <code className="font-mono text-slate-800 shrink-0">{p.name}</code>
                  <code className="font-mono text-[10px] text-slate-500 shrink-0">{p.type}</code>
                  {p.required && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1 rounded bg-amber-100 text-amber-800 shrink-0">
                      {t("mcpToolRequired")}
                    </span>
                  )}
                  <span className="text-slate-600 leading-relaxed">— {p.desc}</span>
                </div>
              ))}
              {meta.params.length === 0 && (
                <div className="text-xs text-slate-400 italic">—</div>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              {t("mcpToolReturns")}
            </div>
            <div className="flex items-start gap-1.5 text-xs text-slate-700">
              <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
              <span className="leading-relaxed">{t(meta.returnsKey)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function McpPage() {
  const { t } = useLang();
  const { data, isLoading } = useGetMcpStatus();
  const mcpUrl = getMcpUrl();

  const claudeJson = JSON.stringify(
    {
      mcpServers: {
        "gbif-biodiversity": {
          url: mcpUrl,
          transport: "http",
        },
      },
    },
    null,
    2,
  );

  const curlSnippet = `curl -X POST ${mcpUrl} \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  const isRunning = data?.status === "running";
  const tools = data?.tools ?? Object.keys(TOOL_INFO);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Cpu className="w-6 h-6 text-purple-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t("mcpTitle")}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("mcpSubtitle")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 font-medium">
            <Server className="w-3.5 h-3.5" />
            {t("mcpStatus")}
          </div>
          <div className="mt-2 flex items-center gap-2">
            {isLoading ? (
              <span className="text-slate-400 text-sm">{t("loading")}</span>
            ) : isRunning ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                <CircleDot className="w-3 h-3 fill-emerald-600 text-emerald-600" />
                {t("mcpRunning")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                <CircleDot className="w-3 h-3" />
                {data?.status ?? "—"}
              </span>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 font-medium">
            <Wrench className="w-3.5 h-3.5" />
            {t("mcpToolsAvailable")}
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {data?.toolCount ?? "…"}{" "}
            <span className="text-sm font-normal text-slate-500">{t("mcpToolCount")}</span>
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm sm:col-span-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 font-medium">
            <BookOpen className="w-3.5 h-3.5" />
            {t("mcpTransport")}
          </div>
          <p className="text-sm font-mono text-slate-800 mt-2">{data?.transport ?? "http"}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
          <Server className="w-4 h-4" />
          {t("mcpEndpoint")}
        </div>
        <CodeBlock code={mcpUrl} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <BookOpen className="w-4 h-4" />
          {t("mcpHowTo")}
        </h2>

        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
              1
            </span>
            <p className="text-sm text-slate-600 leading-relaxed">{t("mcpStepClaude")}</p>
          </div>
          <CodeBlock code={claudeJson} />
        </div>

        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
              2
            </span>
            <p className="text-sm text-slate-600 leading-relaxed">{t("mcpStepCurl")}</p>
          </div>
          <CodeBlock code={curlSnippet} />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Wrench className="w-4 h-4" />
          {t("mcpToolsAvailable")}
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {tools.map((tool) => (
            <ToolCard key={tool} name={tool} />
          ))}
        </div>
      </div>
    </div>
  );
}
