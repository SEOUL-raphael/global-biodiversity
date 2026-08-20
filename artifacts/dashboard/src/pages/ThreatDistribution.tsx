import { useMemo } from "react";
import { useGetKgThreatDistribution } from "@workspace/api-client-react";
import {
  PieChart,
  Pie,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useLang, type Lang } from "@/lib/i18n";
import { InfoCard } from "@/components/InfoCard";
import { HelpHint } from "@/components/HelpHint";
import { gbifNameUrl } from "@/lib/wiki";

const STATUS_LABELS: Record<string, Record<Lang, string>> = {
  EX: { ko: "절멸 (EX)", en: "Extinct (EX)", fr: "Éteinte (EX)", es: "Extinta (EX)", ru: "Исчезнувший (EX)", zh: "灭绝 (EX)", ar: "منقرض (EX)" },
  EW: { ko: "야생절멸 (EW)", en: "Extinct in Wild (EW)", fr: "Éteinte sauvage (EW)", es: "Extinta en estado silvestre (EW)", ru: "Исчезнувший в дикой природе (EW)", zh: "野外灭绝 (EW)", ar: "منقرض في البرية (EW)" },
  RE: { ko: "지역절멸 (RE)", en: "Regionally Extinct (RE)", fr: "Éteinte régionalement (RE)", es: "Extinta regionalmente (RE)", ru: "Регионально исчезнувший (RE)", zh: "区域灭绝 (RE)", ar: "منقرض إقليمياً (RE)" },
  CR: { ko: "위급 (CR)", en: "Critically Endangered (CR)", fr: "En danger critique (CR)", es: "En peligro crítico (CR)", ru: "На грани исчезновения (CR)", zh: "极危 (CR)", ar: "مهدد بشدة (CR)" },
  EN: { ko: "위기 (EN)", en: "Endangered (EN)", fr: "En danger (EN)", es: "En peligro (EN)", ru: "Под угрозой (EN)", zh: "濒危 (EN)", ar: "مهدد (EN)" },
  VU: { ko: "취약 (VU)", en: "Vulnerable (VU)", fr: "Vulnérable (VU)", es: "Vulnerable (VU)", ru: "Уязвимый (VU)", zh: "易危 (VU)", ar: "ضعيف (VU)" },
  NT: { ko: "준위협 (NT)", en: "Near Threatened (NT)", fr: "Quasi menacée (NT)", es: "Casi amenazada (NT)", ru: "Близок к угрозе (NT)", zh: "近危 (NT)", ar: "قريب من التهديد (NT)" },
  LC: { ko: "관심필요 (LC)", en: "Least Concern (LC)", fr: "Préoccupation mineure (LC)", es: "Preocupación menor (LC)", ru: "Вызывает наименьшие опасения (LC)", zh: "无危 (LC)", ar: "أقل اهتماماً (LC)" },
  DD: { ko: "정보부족 (DD)", en: "Data Deficient (DD)", fr: "Données insuffisantes (DD)", es: "Datos insuficientes (DD)", ru: "Недостаточно данных (DD)", zh: "数据缺乏 (DD)", ar: "بيانات غير كافية (DD)" },
  NE: { ko: "미평가 (NE)", en: "Not Evaluated (NE)", fr: "Non évaluée (NE)", es: "No evaluada (NE)", ru: "Не оценён (NE)", zh: "未评估 (NE)", ar: "غير مُقيَّم (NE)" },
  NA: { ko: "해당없음 (NA)", en: "Not Applicable (NA)", fr: "Non applicable (NA)", es: "No aplicable (NA)", ru: "Неприменимо (NA)", zh: "不适用 (NA)", ar: "غير قابل للتطبيق (NA)" },
  UNKNOWN: { ko: "미분류", en: "Unclassified", fr: "Non classée", es: "Sin clasificar", ru: "Без классификации", zh: "未分类", ar: "غير مصنف" },
};

const STATUS_COLORS: Record<string, string> = {
  EX: "#1f2937",
  EW: "#374151",
  RE: "#4b5563",
  CR: "#b91c1c",
  EN: "#ef4444",
  VU: "#f97316",
  NT: "#eab308",
  LC: "#10b981",
  DD: "#94a3b8",
  NE: "#cbd5e1",
  NA: "#cbd5e1",
  UNKNOWN: "#e2e8f0",
};

const STATUS_ORDER = ["EX", "EW", "RE", "CR", "EN", "VU", "NT", "LC", "DD", "NA", "NE", "UNKNOWN"];
const THREATENED_STATUSES = ["CR", "EN", "VU"];
// Statuses shown in the pie chart — exclude unassessed buckets so the chart
// surfaces the actual Red List composition rather than being dominated by UNKNOWN.
const PIE_STATUSES = new Set(["EX", "EW", "RE", "CR", "EN", "VU", "NT", "LC", "DD"]);

export default function ThreatDistribution() {
  const { t, lang } = useLang();
  const { data, isLoading, error } = useGetKgThreatDistribution({ topFamilies: 10 });

  const pieData = useMemo(() => {
    if (!data) return [];
    return [...data.byStatus]
      .filter((s) => PIE_STATUSES.has(s.status) && s.count > 0)
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
      .map((s) => ({
        name: STATUS_LABELS[s.status]?.[lang] ?? s.status,
        value: s.count,
        status: s.status,
        fill: STATUS_COLORS[s.status] ?? "#cbd5e1",
      }));
  }, [data, lang]);

  const kingdomChart = useMemo(() => {
    if (!data) return [];
    return data.byKingdom.slice(0, 6).map((k) => {
      const row: Record<string, string | number> = { kingdom: k.kingdom };
      for (const status of STATUS_ORDER) {
        if (status === "UNKNOWN" || status === "NE") continue;
        row[status] = k.byStatus[status] ?? 0;
      }
      return row;
    });
  }, [data]);

  const totalThreatened = data
    ? data.byStatus
        .filter((b) => THREATENED_STATUSES.includes(b.status))
        .reduce((s, b) => s + b.count, 0)
    : 0;
  const threatRatio =
    data && data.totalClassified > 0 ? (totalThreatened / data.totalClassified) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ShieldAlert className="w-6 h-6 text-rose-500 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t("threatTitle")}</h1>
          <p className="text-sm text-slate-500">{t("threatSubtitle")}</p>
        </div>
      </div>

      <InfoCard source={t("threatSource")} method={t("threatMethod")} />

      {isLoading && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400">
          {t("loading")}
        </div>
      )}
      {error && (
        <div className="bg-red-50 rounded-xl border border-red-200 p-5 text-red-600 text-sm">
          {t("error")}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label={t("totalSpecies")} value={data.totalSpecies} />
            <StatCard label={t("classifiedSpecies")} value={data.totalClassified} />
            <StatCard
              label={t("threatenedSpecies")}
              value={totalThreatened}
              hint={t("iucnCrEnVuExplain")}
              accent="text-rose-600"
            />
            <StatCard
              label={t("threatRatio")}
              value={`${threatRatio.toFixed(1)}%`}
              accent="text-rose-600"
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">{t("byStatus")}</h2>
              <div style={{ width: "100%", height: 288 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={100}
                      stroke="#fff"
                      strokeWidth={1}
                      isAnimationActive={false}
                    />
                    <Tooltip
                      formatter={(v: number, n: string) => [v.toLocaleString(), n]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-1.5 mt-3 text-xs">
                {pieData.map((p) => (
                  <div key={p.status} className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: STATUS_COLORS[p.status] ?? "#cbd5e1" }}
                    />
                    <span className="truncate text-slate-600">{p.name}</span>
                    <span className="ml-auto text-slate-400 tabular-nums">
                      {p.value.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">{t("byKingdom")}</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={kingdomChart} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="kingdom" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {["CR", "EN", "VU", "NT", "LC", "DD"].map((s) => (
                      <Bar
                        key={s}
                        dataKey={s}
                        stackId="a"
                        fill={STATUS_COLORS[s]}
                        name={s}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-rose-500" />
              <h2 className="text-sm font-semibold text-slate-700">
                {t("topThreatenedFamilies")}
              </h2>
            </div>
            <div className="space-y-2">
              {data.topThreatenedFamilies.map((f) => (
                <div
                  key={f.family}
                  className="flex items-center gap-3 p-2 sm:p-3 rounded-lg hover:bg-slate-50"
                >
                  <div className="flex-1 min-w-0">
                    <a
                      href={gbifNameUrl(f.family, "FAMILY")}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-slate-900 hover:text-emerald-600 hover:underline truncate block"
                    >
                      {f.family}
                    </a>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {f.kingdom ?? "—"} · {f.threatenedSpecies}/{f.totalSpecies}{" "}
                      {t("threatenedSpecies").toLowerCase()}
                    </div>
                    <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-rose-500 rounded-full"
                        style={{ width: `${Math.min(100, f.threatRatio * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg font-bold text-rose-600 tabular-nums">
                      {(f.threatRatio * 100).toFixed(0)}%
                    </div>
                    <div className="text-xs text-slate-400">{t("threatRatio")}</div>
                  </div>
                </div>
              ))}
              {data.topThreatenedFamilies.length === 0 && (
                <div className="text-sm text-slate-400 text-center py-6">—</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent = "text-slate-900",
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-sm">
      <div className="text-xs text-slate-500 uppercase tracking-wide flex items-center gap-1">
        <span>{label}</span>
        {hint && <HelpHint text={hint} />}
      </div>
      <div className={`mt-1 text-xl sm:text-2xl font-bold tabular-nums ${accent}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
