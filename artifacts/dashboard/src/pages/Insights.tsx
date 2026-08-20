import { useState } from "react";
import { useGetKgCooccurrence } from "@workspace/api-client-react";
import { Network, BookOpen, ChevronDown, ChevronUp, Info, ExternalLink } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { InfoCard } from "@/components/InfoCard";
import { Link } from "wouter";
import { gbifSpeciesUrl } from "@/lib/wiki";

// ISO-3166 alpha-2 codes that actually appear in our gbif_occurrences corpus,
// pre-sorted by observation count (descending). Names are resolved at render
// time via Intl.DisplayNames so the dropdown is automatically localized.
const REGION_CODES = [
  "US","RU","AU","AQ","IT","CO","CA","FR","NO","PL","UA","NZ","GB","ES","NG",
  "TH","EE","SE","MX","SJ","ZA","NL","EG","DE","KR","EC","ID","BR","BY","DZ",
  "CM","ML","BE","CN","AT","GL","KE","CD","ET","DK","SD","CI","MG","PH","TZ",
  "CZ","JP","SB","TF","BI","AR","FI","BG","NC","GR","LV","SN","PT","FJ","MR",
  "GS","SC","FK","SA","UG","IN","CL","ZW","LT","BJ","NE","TR","BW","HU","PA",
  "IS","TD","ZM","AS","CH","MV","SS","IE","NA","TO","HR","MW","RS","AE","HM",
  "FO","MA","BO","VU","IL","GN","LS","BZ","CR","CY","GT","GH","ME","TN","PF",
  "KM","PE","PG","BN","MK","KG","NF","MY","IM","PW","OM","GF","AL","SG","LU",
  "SL","SK","DJ","BF","GM","TW","SH","AX","UY","VE","NP","TJ","WF","AW","GE",
  "MH","SO","GY","LK","JM","BB","YE","UZ","GQ","SI","BM","RO","RW","EH","BV",
  "KI","MZ","FM","GG","KZ","LB","MQ","PK","TT","YT","PY","PR","MT","MM","JO",
  "UM","GU","VN","CX","RE","HK","CU","GP","BS","ER","TL","AO","WS","MC","LY",
  "CV","AM","JE",
];

function CooccurrenceTable() {
  const { t, lang } = useLang();
  const [minJaccard, setMinJaccard] = useState(0.05);
  const [region, setRegion] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const regionOptions = (() => {
    let displayNames: Intl.DisplayNames | null = null;
    try {
      displayNames = new Intl.DisplayNames([lang], { type: "region" });
    } catch {
      displayNames = null;
    }
    return REGION_CODES.map((code) => {
      let name = code;
      try {
        name = displayNames?.of(code) ?? code;
      } catch {
        name = code;
      }
      return { code, label: `${name} (${code})` };
    }).sort((a, b) => a.label.localeCompare(b.label, lang));
  })();

  const { data, isLoading, error } = useGetKgCooccurrence({
    minJaccard,
    region: region || undefined,
    limit: 30,
  });

  const clusters = data?.clusters ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Min Jaccard similarity</label>
          <select
            value={minJaccard}
            onChange={(e) => setMinJaccard(parseFloat(e.target.value))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value={0.01}>≥ 0.01</option>
            <option value={0.05}>≥ 0.05</option>
            <option value={0.1}>≥ 0.10</option>
            <option value={0.2}>≥ 0.20</option>
            <option value={0.3}>≥ 0.30</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">{t("regionLabel")}</label>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            size={1}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-64 max-w-full bg-white"
          >
            <option value="">{t("regionAll")}</option>
            {regionOptions.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && (
        <p className="text-slate-400 text-sm py-6 text-center animate-pulse">{t("loading")}</p>
      )}
      {error && <p className="text-red-500 text-sm">{t("error")}</p>}

      {!isLoading && clusters.length === 0 && (
        <p className="text-slate-400 text-sm py-6 text-center">{t("noData")}</p>
      )}

      <details className="bg-slate-50 border border-slate-200 rounded-lg text-sm">
        <summary className="cursor-pointer px-3 py-2 flex items-center gap-2 text-slate-700 hover:text-slate-900 select-none">
          <Info className="w-4 h-4 text-blue-500 shrink-0" />
          <span className="font-medium">{t("jaccardExplainTitle")}</span>
        </summary>
        <div className="px-3 pb-3 pt-1 text-xs text-slate-600 leading-relaxed space-y-1">
          <p>{t("jaccardExplainBody")}</p>
          <p className="text-slate-500">{t("jaccardTieRule")}</p>
        </div>
      </details>

      {clusters.length > 0 && (
        <>
          {/* Desktop / tablet: real table */}
          <div className="hidden sm:block overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[28%]" />
                <col className="w-[26%]" />
                <col className="w-[12%]" />
                <col className="w-[6%]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("species1")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("species2")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Jaccard</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("sharedRegions")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clusters.map((c) => {
                  const key = `${c.taxonKeyA}-${c.taxonKeyB}`;
                  const isOpen = expanded === key;
                  return (
                    <tr
                      key={key}
                      className={`border-b align-top ${isOpen ? "bg-blue-50 border-blue-100" : "border-slate-100 hover:bg-slate-50"} cursor-pointer`}
                      onClick={() => setExpanded(isOpen ? null : key)}
                    >
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          <Link
                            href={`/species/${c.taxonKeyA}`}
                            className="italic text-slate-800 hover:text-emerald-600 hover:underline break-words"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {c.labelA}
                          </Link>
                          <a
                            href={gbifSpeciesUrl(c.taxonKeyA)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title={t("learnMore")}
                            aria-label={t("learnMore")}
                            className="text-slate-400 hover:text-blue-600 inline-flex"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          <Link
                            href={`/species/${c.taxonKeyB}`}
                            className="italic text-slate-800 hover:text-emerald-600 hover:underline break-words"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {c.labelB}
                          </Link>
                          <a
                            href={gbifSpeciesUrl(c.taxonKeyB)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title={t("learnMore")}
                            aria-label={t("learnMore")}
                            className="text-slate-400 hover:text-blue-600 inline-flex"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 max-w-[60px] bg-slate-100 rounded-full h-1.5">
                            <div
                              className="bg-blue-500 h-1.5 rounded-full"
                              style={{ width: `${Math.min(c.jaccardSimilarity * 100, 100)}%` }}
                            />
                          </div>
                          <span className="text-slate-600 tabular-nums">
                            {c.jaccardSimilarity.toFixed(3)}
                          </span>
                        </div>
                        {isOpen && c.sharedRegions.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {c.sharedRegions.map((r) => (
                              <span key={r} className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-medium">
                                {r}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 tabular-nums">{c.sharedRegions.length}</td>
                      <td className="px-2 py-2 text-slate-400">
                        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked card list, no horizontal overflow */}
          <ul className="sm:hidden space-y-2">
            {clusters.map((c) => {
              const key = `${c.taxonKeyA}-${c.taxonKeyB}`;
              const isOpen = expanded === key;
              return (
                <li
                  key={key}
                  className={`rounded-lg border ${isOpen ? "bg-blue-50 border-blue-200" : "bg-white border-slate-200"} p-3`}
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className="w-full flex items-start justify-between gap-2 text-left"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                          href={`/species/${c.taxonKeyA}`}
                          className="italic text-sm text-slate-800 hover:text-emerald-600 hover:underline break-words"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.labelA}
                        </Link>
                        <a
                          href={gbifSpeciesUrl(c.taxonKeyA)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={t("learnMore")}
                          aria-label={t("learnMore")}
                          className="text-slate-400 hover:text-blue-600 inline-flex"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wide">×</div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                          href={`/species/${c.taxonKeyB}`}
                          className="italic text-sm text-slate-800 hover:text-emerald-600 hover:underline break-words"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.labelB}
                        </Link>
                        <a
                          href={gbifSpeciesUrl(c.taxonKeyB)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={t("learnMore")}
                          aria-label={t("learnMore")}
                          className="text-slate-400 hover:text-blue-600 inline-flex"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                    <div className="shrink-0 text-right space-y-1">
                      <span className="inline-block text-xs font-semibold tabular-nums bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                        {c.jaccardSimilarity.toFixed(3)}
                      </span>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {c.sharedRegions.length} {t("sharedRegions")}
                      </div>
                      <div className="text-slate-400 flex justify-end">
                        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                  </button>
                  {isOpen && c.sharedRegions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.sharedRegions.map((r) => (
                        <span key={r} className="text-[11px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-medium">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default function Insights() {
  const { t } = useLang();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Network className="w-6 h-6 text-purple-600 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t("cooccurrenceTitle")}</h1>
          <p className="text-sm text-slate-500">{t("cooccurrenceDesc")}</p>
        </div>
      </div>

      <InfoCard source={t("insightsSource")} method={t("insightsMethod")} />

      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 shadow-sm">
        <CooccurrenceTable />
      </div>
    </div>
  );
}
