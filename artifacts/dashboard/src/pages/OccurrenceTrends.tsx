import { useEffect, useMemo, useState } from "react";
import { useGetKgOccurrenceTrends } from "@workspace/api-client-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { InfoCard } from "@/components/InfoCard";
import { getCountryName } from "@/lib/countries";

const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#a855f7"];

export default function OccurrenceTrends() {
  const { t, lang } = useLang();
  const [fromYear, setFromYear] = useState(1980);
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set());
  const { data, isLoading, error } = useGetKgOccurrenceTrends({
    fromYear,
    topCountries: 164,
  });

  // Default selection: top 10 by occurrence count (chart stays readable)
  useEffect(() => {
    if (data?.topCountries) {
      setSelectedCountries(new Set(data.topCountries.slice(0, 10).map((c) => c.countryCode)));
    }
  }, [data?.topCountries?.map((c) => c.countryCode).join(",")]);

  const yearlyChart = useMemo(() => {
    if (!data) return [];
    return data.yearly.map((p) => ({ year: p.year, count: p.count }));
  }, [data]);

  const countryChart = useMemo(() => {
    if (!data || data.topCountries.length === 0) return [];
    const yearMap = new Map<number, Record<string, number>>();
    for (const c of data.topCountries) {
      if (!selectedCountries.has(c.countryCode)) continue;
      for (const point of c.series) {
        if (!yearMap.has(point.year)) yearMap.set(point.year, { year: point.year });
        yearMap.get(point.year)![c.countryCode] = point.count;
      }
    }
    return Array.from(yearMap.values()).sort((a, b) => (a.year as number) - (b.year as number));
  }, [data, selectedCountries]);

  const visibleCountries = useMemo(
    () => data?.topCountries.filter((c) => selectedCountries.has(c.countryCode)) ?? [],
    [data, selectedCountries],
  );

  const totalAll = data ? data.totalWithYear + data.totalWithoutYear : 0;

  const toggleCountry = (code: string) => {
    setSelectedCountries((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-6 h-6 text-emerald-500 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t("trendsTitle")}</h1>
          <p className="text-sm text-slate-500">{t("trendsSubtitle")}</p>
        </div>
      </div>

      <InfoCard source={t("trendsSource")} method={t("trendsMethod")} />

      <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-sm flex flex-col sm:flex-row sm:flex-wrap gap-4 sm:items-start">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">{t("fromYear")}</label>
          <select
            value={fromYear}
            onChange={(e) => setFromYear(Number(e.target.value))}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            {[1900, 1950, 1970, 1980, 1990, 2000, 2010, 2020].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {data && data.topCountries.length > 0 && (
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-600">{t("countryFilter")}</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedCountries(new Set(data.topCountries.map((c) => c.countryCode)))}
                  className="text-[11px] text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  {t("selectAll")}
                </button>
                <span className="text-slate-300 text-[11px]">|</span>
                <button
                  onClick={() => setSelectedCountries(new Set())}
                  className="text-[11px] text-slate-400 hover:text-slate-600 font-medium"
                >
                  {t("clearAll")}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1 scrollbar-thin"
              style={{ scrollbarWidth: "thin" }}>
              {data.topCountries.map((c, i) => {
                const checked = selectedCountries.has(c.countryCode);
                return (
                  <button
                    key={c.countryCode}
                    onClick={() => toggleCountry(c.countryCode)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all ${
                      checked
                        ? "border-transparent text-white"
                        : "border-slate-200 bg-white text-slate-400 hover:border-slate-300"
                    }`}
                    style={checked ? { backgroundColor: COLORS[i % COLORS.length] } : {}}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0 border border-white/40"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    {c.countryCode}
                    <span className="opacity-70 tabular-nums">{c.total.toLocaleString()}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

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
            <StatCard label={t("yearRange")} value={`${data.yearMin}–${data.yearMax}`} />
            <StatCard label={t("withYear")} value={data.totalWithYear} accent="text-emerald-600" />
            <StatCard label={t("withoutYear")} value={data.totalWithoutYear} accent="text-slate-400" />
            <StatCard label={t("occurrences")} value={totalAll} />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">
              {t("yearlyOccurrences")}
            </h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={yearlyChart} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="yearGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v: number) => [v.toLocaleString(), t("occurrences")]}
                    labelFormatter={(l) => `${l}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#yearGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">
              {t("topContributors")}
            </h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={countryChart} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {data.topCountries
                    .filter((c) => selectedCountries.has(c.countryCode))
                    .map((c, i) => (
                      <Line
                        key={c.countryCode}
                        type="monotone"
                        dataKey={c.countryCode}
                        stroke={COLORS[data.topCountries.indexOf(c) % COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        name={`${getCountryName(c.countryCode, lang)} (${c.countryCode})`}
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {visibleCountries.length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {visibleCountries.map((c) => {
                  const i = data.topCountries.indexOf(c);
                  return (
                    <div
                      key={c.countryCode}
                      className="flex items-center gap-1.5 p-2 rounded bg-slate-50"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-slate-700 font-medium truncate">
                          {getCountryName(c.countryCode, lang)}
                        </div>
                        <div className="text-slate-400 tabular-nums">
                          {c.total.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent = "text-slate-900",
}: {
  label: string;
  value: number | string;
  accent?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-sm">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-xl sm:text-2xl font-bold tabular-nums ${accent}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
