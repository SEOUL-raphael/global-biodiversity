import {
  Database,
  Globe,
  ShieldAlert,
  BookOpen,
  RefreshCw,
  Workflow,
  Cpu,
  Server,
  Layers,
  ArrowDown,
  Code2,
  Boxes,
  Sparkles,
  Table as TableIcon,
  Network,
  GitBranch,
  MapPin,
  Leaf,
} from "lucide-react";
import { useLang } from "@/lib/i18n";

function SectionHeading({
  icon: Icon,
  children,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-base sm:text-lg font-semibold text-slate-900 mt-2">
      <Icon className="w-5 h-5 text-emerald-600" />
      {children}
    </h2>
  );
}

function SourceCard({
  icon: Icon,
  title,
  desc,
  color,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm h-full">
      <div className={`inline-flex p-2 rounded-lg ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <h3 className="mt-3 font-semibold text-slate-900 text-sm">{title}</h3>
      <p className="text-xs sm:text-sm text-slate-600 mt-1.5 leading-relaxed">
        {desc}
      </p>
    </div>
  );
}

function ArchLayer({
  label,
  color,
  items,
}: {
  label: string;
  color: string;
  items: { icon: React.ElementType; text: string }[];
}) {
  return (
    <div className="w-full">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 text-center">
        {label}
      </div>
      <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
        {items.map(({ icon: Icon, text }) => (
          <div
            key={text}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs sm:text-sm leading-tight max-w-[280px] ${color}`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SchemaColumn {
  name: string;
  type: string;
  pk?: boolean;
  fk?: string;
  note?: string;
}

function SchemaTable({
  icon: Icon,
  table,
  rowsLabel,
  desc,
  columns,
  indexes,
  color,
}: {
  icon: React.ElementType;
  table: string;
  rowsLabel?: string;
  desc: string;
  columns: SchemaColumn[];
  indexes: string[];
  color: string;
}) {
  const { t } = useLang();
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className={`flex items-center justify-between gap-2 px-4 py-2.5 ${color}`}>
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 shrink-0" />
          <code className="font-mono text-sm font-semibold truncate">{table}</code>
        </div>
        {rowsLabel && (
          <span className="text-[10px] font-medium uppercase tracking-wider opacity-75 shrink-0">
            {rowsLabel}
          </span>
        )}
      </div>
      <div className="px-4 pt-3 pb-2 text-xs text-slate-600 leading-relaxed border-b border-slate-100">
        {desc}
      </div>
      <div className="px-4 py-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
          {t("aboutSchemaCols")}
        </div>
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-xs">
            <tbody>
              {columns.map((c) => (
                <tr key={c.name} className="border-b border-slate-50 last:border-0">
                  <td className="py-1.5 pr-3 align-top">
                    <code className="font-mono text-slate-800 text-[11px] sm:text-xs">
                      {c.name}
                    </code>
                    {c.pk && (
                      <span className="ml-1.5 inline-block text-[9px] font-bold px-1 rounded bg-amber-100 text-amber-800 align-middle">
                        PK
                      </span>
                    )}
                    {c.fk && (
                      <span className="ml-1.5 inline-block text-[9px] font-bold px-1 rounded bg-blue-100 text-blue-800 align-middle">
                        FK→{c.fk}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 align-top whitespace-nowrap">
                    <code className="font-mono text-slate-500 text-[10px] sm:text-[11px]">
                      {c.type}
                    </code>
                  </td>
                  <td className="py-1.5 align-top text-[11px] text-slate-600">
                    {c.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {indexes.length > 0 && (
          <div className="mt-3 pt-2 border-t border-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              {t("aboutSchemaIdx")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {indexes.map((idx) => (
                <code
                  key={idx}
                  className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600"
                >
                  {idx}
                </code>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex justify-center text-slate-300 my-1">
      <ArrowDown className="w-5 h-5" />
    </div>
  );
}

export default function About() {
  const { t } = useLang();
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          {t("aboutTitle")}
        </h1>
        <p className="text-sm text-slate-500 mt-1">{t("aboutSubtitle")}</p>
      </div>

      <SectionHeading icon={Database}>{t("aboutSourcesHeading")}</SectionHeading>
      <div className="grid sm:grid-cols-3 gap-3 sm:gap-4">
        <SourceCard
          icon={Globe}
          title={t("aboutGbifTitle")}
          desc={t("aboutGbifDesc")}
          color="bg-emerald-100 text-emerald-700"
        />
        <SourceCard
          icon={ShieldAlert}
          title={t("aboutIucnTitle")}
          desc={t("aboutIucnDesc")}
          color="bg-rose-100 text-rose-700"
        />
        <SourceCard
          icon={BookOpen}
          title={t("aboutWikiTitle")}
          desc={t("aboutWikiDesc")}
          color="bg-blue-100 text-blue-700"
        />
      </div>

      <SectionHeading icon={RefreshCw}>{t("aboutUpdateHeading")}</SectionHeading>
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm space-y-3">
        <p className="text-sm text-slate-700 leading-relaxed">
          {t("aboutUpdateDesc")}
        </p>
        <ol className="space-y-2.5 text-sm text-slate-700 list-none">
          {[
            t("aboutUpdate1"),
            t("aboutUpdate2"),
            t("aboutUpdate3"),
            t("aboutUpdate4"),
          ].map((line, i) => (
            <li key={i} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <span className="leading-relaxed">{line}</span>
            </li>
          ))}
        </ol>
      </div>

      <SectionHeading icon={Workflow}>{t("aboutArchHeading")}</SectionHeading>
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 shadow-sm">
        <p className="text-sm text-slate-700 leading-relaxed mb-4">
          {t("aboutArchIntro")}
        </p>
        <div className="space-y-1">
          <ArchLayer
            label={t("aboutArchLayerSources")}
            color="bg-emerald-50 border-emerald-200 text-emerald-900"
            items={[
              { icon: Globe, text: "GBIF API" },
              { icon: ShieldAlert, text: "IUCN Red List" },
              { icon: BookOpen, text: "Wikipedia" },
            ]}
          />
          <Arrow />
          <ArchLayer
            label={t("aboutArchLayerIngest")}
            color="bg-amber-50 border-amber-200 text-amber-900"
            items={[
              { icon: Server, text: t("aboutArchIngestNode") },
              { icon: Boxes, text: t("aboutArchKgNode") },
            ]}
          />
          <Arrow />
          <ArchLayer
            label={t("aboutArchLayerStorage")}
            color="bg-slate-100 border-slate-300 text-slate-800"
            items={[{ icon: Database, text: t("aboutArchPgNode") }]}
          />
          <Arrow />
          <ArchLayer
            label={t("aboutArchLayerApi")}
            color="bg-blue-50 border-blue-200 text-blue-900"
            items={[
              { icon: Code2, text: t("aboutArchExpressNode") },
              { icon: Cpu, text: t("aboutArchMcpNode") },
              { icon: Sparkles, text: t("aboutArchAiNode") },
            ]}
          />
          <Arrow />
          <ArchLayer
            label={t("aboutArchLayerClient")}
            color="bg-purple-50 border-purple-200 text-purple-900"
            items={[
              { icon: Layers, text: t("aboutArchDashboardNode") },
              { icon: Cpu, text: t("aboutArchExternalLlmNode") },
            ]}
          />
        </div>
      </div>

      <SectionHeading icon={TableIcon}>{t("aboutSchemaHeading")}</SectionHeading>
      <p className="text-sm text-slate-600 leading-relaxed">{t("aboutSchemaIntro")}</p>
      <div className="grid lg:grid-cols-2 gap-3 sm:gap-4">
        <SchemaTable
          icon={Leaf}
          table="gbif_taxa"
          desc={t("aboutTaxaDesc")}
          color="bg-emerald-50 text-emerald-900 border-b border-emerald-100"
          columns={[
            { name: "taxon_key", type: "integer", pk: true, note: "GBIF taxon key" },
            { name: "parent_key", type: "integer", note: "parent taxon" },
            { name: "rank", type: "text", note: "SPECIES / GENUS / FAMILY …" },
            { name: "kingdom · phylum · class · order · family · genus · species", type: "text", note: "Linnaean lineage" },
            { name: "scientific_name", type: "text", note: "with authorship" },
            { name: "canonical_name", type: "text", note: "search index" },
            { name: "vernacular_name", type: "text", note: "common name" },
            { name: "iucn_status", type: "text", note: "EX / EW / CR / EN / VU / NT / LC / DD" },
            { name: "num_occurrences", type: "bigint", note: "cached aggregate" },
            { name: "extinct", type: "text" },
            { name: "created_at · updated_at", type: "timestamp" },
          ]}
          indexes={[
            "idx(parent_key)",
            "idx(rank)",
            "idx(canonical_name)",
            "idx(kingdom)",
            "idx(iucn_status)",
          ]}
        />
        <SchemaTable
          icon={MapPin}
          table="gbif_occurrences"
          desc={t("aboutOccDesc")}
          color="bg-blue-50 text-blue-900 border-b border-blue-100"
          columns={[
            { name: "id", type: "bigserial", pk: true },
            { name: "gbif_key", type: "bigint", note: "unique GBIF occurrence id" },
            { name: "taxon_key", type: "bigint", fk: "gbif_taxa" },
            { name: "country_code", type: "char(2)", note: "ISO 3166-1 alpha-2" },
            { name: "decimal_latitude", type: "real" },
            { name: "decimal_longitude", type: "real" },
            { name: "year", type: "smallint" },
            { name: "month", type: "smallint" },
            { name: "dataset_key", type: "text", note: "GBIF dataset uuid" },
            { name: "basis_of_record", type: "text", note: "OBSERVATION / SPECIMEN …" },
            { name: "created_at", type: "timestamp" },
          ]}
          indexes={[
            "unique(gbif_key)",
            "idx(taxon_key)",
            "idx(country_code)",
            "idx(year)",
          ]}
        />
        <SchemaTable
          icon={Globe}
          table="gbif_regions"
          desc={t("aboutRegionDesc")}
          color="bg-amber-50 text-amber-900 border-b border-amber-100"
          columns={[
            { name: "country_code", type: "char(2)", pk: true },
            { name: "country_name", type: "text" },
            { name: "occurrence_count", type: "bigint", note: "cached" },
            { name: "species_count", type: "integer", note: "cached" },
            { name: "last_synced", type: "timestamp" },
          ]}
          indexes={[]}
        />
        <SchemaTable
          icon={Network}
          table="gbif_kg_nodes"
          desc={t("aboutKgNodesDesc")}
          color="bg-purple-50 text-purple-900 border-b border-purple-100"
          columns={[
            { name: "node_id", type: "bigserial", pk: true },
            { name: "node_type", type: "text", note: "TAXON · REGION · THREAT · HABITAT" },
            { name: "external_id", type: "text", note: "unique stable id (e.g. taxon:5219404)" },
            { name: "label", type: "text", note: "human-readable name" },
            { name: "properties", type: "jsonb", note: "type-specific attributes" },
            { name: "created_at", type: "timestamp" },
          ]}
          indexes={[
            "unique(external_id)",
            "idx(node_type)",
            "gin(properties)",
          ]}
        />
        <SchemaTable
          icon={GitBranch}
          table="gbif_kg_edges"
          desc={t("aboutKgEdgesDesc")}
          color="bg-rose-50 text-rose-900 border-b border-rose-100"
          columns={[
            { name: "edge_id", type: "bigserial", pk: true },
            { name: "from_node", type: "bigint", fk: "gbif_kg_nodes" },
            { name: "to_node", type: "bigint", fk: "gbif_kg_nodes" },
            { name: "edge_type", type: "text", note: "CLASSIFIED_AS · CO_OCCURS_WITH · INHABITS · THREATENED_BY" },
            { name: "weight", type: "real", note: "default 1.0" },
            { name: "properties", type: "jsonb" },
            { name: "created_at", type: "timestamp" },
          ]}
          indexes={[
            "unique(from_node, to_node, edge_type)",
            "idx(from_node)",
            "idx(to_node)",
            "idx(edge_type)",
          ]}
        />
      </div>

      <SectionHeading icon={Code2}>{t("aboutStackHeading")}</SectionHeading>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
            {t("aboutStackFrontend")}
          </div>
          <div className="mt-2 text-sm text-slate-700 leading-relaxed">
            React 18 · Vite · TypeScript · Tailwind · wouter · TanStack Query · Recharts · Leaflet
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
            {t("aboutStackBackend")}
          </div>
          <div className="mt-2 text-sm text-slate-700 leading-relaxed">
            Node.js · Express · Zod · OpenAPI codegen · pino logging
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
            {t("aboutStackData")}
          </div>
          <div className="mt-2 text-sm text-slate-700 leading-relaxed">
            PostgreSQL · Drizzle ORM · Knowledge graph (nodes / edges) · GBIF Species & Occurrence APIs
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
            {t("aboutStackAi")}
          </div>
          <div className="mt-2 text-sm text-slate-700 leading-relaxed">
            MiniMax M2.7 (OpenAI-compatible) · 8-tool MCP server · function-calling pipeline
          </div>
        </div>
      </div>
    </div>
  );
}
