import { useEffect, useState } from "react";
import { useSearchGbifTaxa } from "@workspace/api-client-react";
import { Search, ChevronLeft, ChevronRight, Filter, ShieldAlert } from "lucide-react";
import { Link, useSearch } from "wouter";
import { useLang } from "@/lib/i18n";
import { InfoCard } from "@/components/InfoCard";

const KINGDOMS = ["", "Animalia", "Plantae", "Fungi", "Chromista", "Bacteria", "Protozoa"];
const RANKS = ["", "SPECIES", "GENUS", "FAMILY", "ORDER", "CLASS", "PHYLUM", "KINGDOM"];
const IUCN_STATUSES = [
  { value: "", label: "IUCN · All" },
  { value: "CRITICALLY_ENDANGERED", label: "CR – Critically Endangered" },
  { value: "ENDANGERED", label: "EN – Endangered" },
  { value: "VULNERABLE", label: "VU – Vulnerable" },
  { value: "NEAR_THREATENED", label: "NT – Near Threatened" },
  { value: "LEAST_CONCERN", label: "LC – Least Concern" },
  { value: "DATA_DEFICIENT", label: "DD – Data Deficient" },
  { value: "NOT_EVALUATED", label: "NE – Not Evaluated" },
  { value: "EXTINCT", label: "EX – Extinct" },
  { value: "EXTINCT_IN_THE_WILD", label: "EW – Extinct in Wild" },
];

const IUCN_BADGE: Record<string, { cls: string; label: string }> = {
  EX: { cls: "bg-gray-900 text-white", label: "EX" },
  EW: { cls: "bg-gray-700 text-white", label: "EW" },
  CR: { cls: "bg-red-600 text-white", label: "CR" },
  CRITICALLY_ENDANGERED: { cls: "bg-red-600 text-white", label: "CR" },
  EN: { cls: "bg-red-400 text-white", label: "EN" },
  ENDANGERED: { cls: "bg-red-400 text-white", label: "EN" },
  VU: { cls: "bg-orange-400 text-white", label: "VU" },
  VULNERABLE: { cls: "bg-orange-400 text-white", label: "VU" },
  NT: { cls: "bg-yellow-400 text-gray-900", label: "NT" },
  NEAR_THREATENED: { cls: "bg-yellow-400 text-gray-900", label: "NT" },
  LC: { cls: "bg-emerald-500 text-white", label: "LC" },
  LEAST_CONCERN: { cls: "bg-emerald-500 text-white", label: "LC" },
  DD: { cls: "bg-slate-300 text-slate-700", label: "DD" },
  DATA_DEFICIENT: { cls: "bg-slate-300 text-slate-700", label: "DD" },
  NE: { cls: "bg-slate-100 text-slate-600", label: "NE" },
  NOT_EVALUATED: { cls: "bg-slate-100 text-slate-600", label: "NE" },
  EXTINCT: { cls: "bg-gray-900 text-white", label: "EX" },
};

function IucnBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const b = IUCN_BADGE[status];
  if (!b) return <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{status}</span>;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-semibold ${b.cls}`}>
      <ShieldAlert className="w-2.5 h-2.5" />
      {b.label}
    </span>
  );
}

export default function SpeciesSearch() {
  const { t } = useLang();
  const search = useSearch();
  const initialQ = new URLSearchParams(search).get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [kingdom, setKingdom] = useState("");
  const [rank, setRank] = useState("");
  const [iucnStatus, setIucnStatus] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const [submitted, setSubmitted] = useState({ q: initialQ, kingdom: "", rank: "", iucnStatus: "" });

  useEffect(() => {
    const next = new URLSearchParams(search).get("q") ?? "";
    setQ(next);
    setOffset(0);
    setSubmitted({ q: next, kingdom: "", rank: "", iucnStatus: "" });
  }, [search]);

  const { data, isLoading } = useSearchGbifTaxa({
    q: submitted.q || undefined,
    kingdom: submitted.kingdom || undefined,
    rank: submitted.rank || undefined,
    iucnStatus: submitted.iucnStatus || undefined,
    limit,
    offset,
  });

  function handleSearch() {
    setOffset(0);
    setSubmitted({ q, kingdom, rank, iucnStatus });
    setFiltersOpen(false);
  }

  const activeFilterCount = [submitted.kingdom, submitted.rank, submitted.iucnStatus].filter(Boolean).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Search className="w-6 h-6 text-slate-600 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t("speciesTitle")}</h1>
          <p className="text-sm text-slate-500">{t("speciesSubtitle")}</p>
        </div>
      </div>

      <InfoCard source={t("speciesSource")} method={t("speciesMethod")} />

      <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-sm space-y-3">
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder={t("searchPlaceholder")}
            className="flex-1 min-w-[180px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            className="sm:hidden flex items-center gap-1.5 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600"
            aria-expanded={filtersOpen}
            aria-label={t("toggleFilters")}
          >
            <Filter className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="text-xs font-semibold text-emerald-600">{activeFilterCount}</span>
            )}
          </button>
          <button
            onClick={handleSearch}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {t("search")}
          </button>
        </div>

        <div className={`gap-2 flex-wrap ${filtersOpen ? "flex" : "hidden"} sm:flex`}>
          <select
            value={kingdom}
            onChange={(e) => setKingdom(e.target.value)}
            className="flex-1 sm:flex-initial border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            {KINGDOMS.map((k) => (
              <option key={k} value={k}>{k || `${t("kingdom")} · ${t("all")}`}</option>
            ))}
          </select>
          <select
            value={rank}
            onChange={(e) => setRank(e.target.value)}
            className="flex-1 sm:flex-initial border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            {RANKS.map((r) => (
              <option key={r} value={r}>{r || `${t("rank")} · ${t("all")}`}</option>
            ))}
          </select>
          <select
            value={iucnStatus}
            onChange={(e) => setIucnStatus(e.target.value)}
            className="flex-1 sm:flex-initial border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            {IUCN_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 animate-pulse">
          {t("loading")}
        </div>
      )}

      {data && (
        <>
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-700">{data.total.toLocaleString()}</span>
            {" · "}
            {t("showing")} {offset + 1}–{Math.min(offset + limit, data.total)}
          </p>

          <div className="hidden sm:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("scientificName")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("rank")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("kingdom")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("family")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">IUCN</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">{t("occurrences")}</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((tx) => (
                  <tr key={tx.taxonKey} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/species/${tx.taxonKey}`}
                        className="italic text-slate-800 hover:text-emerald-600 hover:underline"
                      >
                        {tx.canonicalName ?? tx.scientificName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-xs">
                        {tx.rank}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{tx.kingdom ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{tx.family ?? "—"}</td>
                    <td className="px-4 py-3">
                      <IucnBadge status={tx.iucnStatus} />
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-right tabular-nums">
                      {(tx.numOccurrences ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sm:hidden grid gap-2">
            {data.results.map((tx) => (
              <Link key={tx.taxonKey} href={`/species/${tx.taxonKey}`}>
                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:border-emerald-300 transition-colors cursor-pointer">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm italic font-medium text-slate-800">
                      {tx.canonicalName ?? tx.scientificName}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-medium text-slate-600 shrink-0">
                      {tx.rank}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{t("kingdom")}: <span className="text-slate-700">{tx.kingdom ?? "—"}</span></span>
                    <span>{t("family")}: <span className="text-slate-700">{tx.family ?? "—"}</span></span>
                    {tx.iucnStatus && (
                      <span className="flex items-center gap-1">
                        IUCN: <IucnBadge status={tx.iucnStatus} />
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" /> <span className="hidden sm:inline">{t("prev")}</span>
            </button>
            <span className="text-sm text-slate-500">
              {t("page")} {Math.floor(offset / limit) + 1}
            </span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= data.total}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="hidden sm:inline">{t("next")}</span> <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
