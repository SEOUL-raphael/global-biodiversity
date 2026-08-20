import { useMemo } from "react";
import { Link } from "wouter";
import {
  useGetGbifStatus,
  useListGbifRegions,
  useGetKgThreatDistribution,
} from "@workspace/api-client-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Leaf,
  Globe,
  ShieldAlert,
  Eye,
  AlertTriangle,
  TrendingUp,
  Search,
  BrainCircuit,
  ArrowRight,
  Network,
  Cpu,
} from "lucide-react";
import { useLang } from "@/lib/i18n";
import { InfoCard } from "@/components/InfoCard";
import { HelpHint } from "@/components/HelpHint";
import promoHero from "@/assets/promo-hero.png";
import { CountryMap } from "@/components/CountryMap";
import { StatSkeleton } from "@/components/Skeleton";
import { getCountryName } from "@/lib/countries";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  subHint,
  color = "emerald",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  subHint?: string;
  color?: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-700",
    blue: "bg-blue-100 text-blue-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    purple: "bg-purple-100 text-purple-700",
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5 flex items-start gap-3 sm:gap-4 shadow-sm">
      <div className={`p-2 sm:p-2.5 rounded-lg ${colorMap[color] ?? colorMap.emerald} shrink-0`}>
        <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] sm:text-xs text-slate-500 font-medium uppercase tracking-wide truncate">
          {label}
        </p>
        <p className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        {sub && (
          <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 flex items-center gap-1 min-w-0">
            <span className="truncate">{sub}</span>
            {subHint && <HelpHint text={subHint} />}
          </p>
        )}
      </div>
    </div>
  );
}

function ExploreCard({
  to,
  icon: Icon,
  title,
  desc,
  color,
}: {
  to: string;
  icon: React.ElementType;
  title: string;
  desc: string;
  color: string;
}) {
  return (
    <Link href={to}>
      <div className="group bg-white rounded-xl border border-slate-200 hover:border-emerald-300 hover:shadow-md transition-all p-4 sm:p-5 cursor-pointer h-full flex flex-col">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
        </div>
        <p className="font-semibold text-sm text-slate-900">{title}</p>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{desc}</p>
      </div>
    </Link>
  );
}

export default function Overview() {
  const { t, lang } = useLang();
  const { data: gbifStatus, isLoading: gbifLoading } = useGetGbifStatus();
  const { data: regions } = useListGbifRegions({ limit: 30 });
  const { data: threat } = useGetKgThreatDistribution({ topFamilies: 1 });

  const sortedRegions = useMemo(
    () =>
      [...(regions ?? [])].sort(
        (a: { occurrenceCount: number }, b: { occurrenceCount: number }) =>
          b.occurrenceCount - a.occurrenceCount,
      ),
    [regions],
  );

  const regionData = useMemo(
    () =>
      sortedRegions
        .slice(0, 12)
        .map((r: { countryCode: string; occurrenceCount: number }) => ({
          name: getCountryName(r.countryCode, lang),
          code: r.countryCode,
          count: r.occurrenceCount,
        })),
    [sortedRegions, lang],
  );

  const mapPoints = useMemo(
    () =>
      sortedRegions.slice(0, 30).map((r: { countryCode: string; occurrenceCount: number }) => ({
        countryCode: r.countryCode,
        value: r.occurrenceCount,
        color: "#3b82f6",
      })),
    [sortedRegions],
  );

  const threatened = useMemo(() => {
    if (!threat) return null;
    return threat.byStatus
      .filter((s) => ["CR", "EN", "VU"].includes(s.status))
      .reduce((sum, s) => sum + s.count, 0);
  }, [threat]);

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 shadow-sm bg-slate-900">
        <img
          src={promoHero}
          alt={t("overviewTitle")}
          className="w-full h-40 sm:h-56 md:h-64 object-cover opacity-80"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900/85 via-slate-900/40 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-center p-5 sm:p-8 max-w-2xl">
          <h1 className="text-xl sm:text-3xl font-bold text-white leading-tight drop-shadow">
            {t("overviewTitle")}
          </h1>
          <p className="text-xs sm:text-sm text-slate-200 mt-2 leading-relaxed drop-shadow">
            {t("overviewSubtitle")}
          </p>
        </div>
      </div>

      <InfoCard source={t("overviewSource")} method={t("overviewMethod")} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {gbifLoading ? (
          Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              icon={Leaf}
              label={t("taxa")}
              value={gbifStatus?.taxaCount ?? "…"}
              color="emerald"
            />
            <StatCard
              icon={Eye}
              label={t("occurrences")}
              value={gbifStatus?.occurrenceCount ?? "…"}
              color="blue"
            />
            <StatCard
              icon={ShieldAlert}
              label={t("threatenedShort")}
              value={threatened ?? "…"}
              sub="IUCN CR + EN + VU"
              subHint={t("iucnCrEnVuExplain")}
              color="red"
            />
            <StatCard
              icon={Globe}
              label={t("regions")}
              value={gbifStatus?.regionCount ?? "…"}
              color="amber"
            />
          </>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">{t("worldMap")}</h2>
        {mapPoints.length > 0 ? (
          <CountryMap
            points={mapPoints}
            valueLabel={t("occurrences")}
            height={380}
            mobileHeight={260}
          />
        ) : (
          <div className="h-[260px] sm:h-[380px] flex items-center justify-center text-slate-400 text-sm">
            {t("loading")}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">{t("topCountries")}</h2>
        {regionData.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={regionData} margin={{ top: 5, right: 10, left: 0, bottom: 40 }}>
              <XAxis
                dataKey="code"
                tick={{ fontSize: 11 }}
                interval={0}
              />
              <YAxis tick={{ fontSize: 11 }} width={50} />
              <Tooltip
                formatter={(v: number) => v.toLocaleString()}
                labelFormatter={(code: string) => {
                  const item = regionData.find((r) => r.code === code);
                  return item ? `${item.name} (${code})` : code;
                }}
              />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[260px] flex items-center justify-center text-slate-400 text-sm">
            {t("loading")}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3 px-1">{t("exploreMore")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <ExploreCard
            to="/hotspots"
            icon={AlertTriangle}
            title={t("navHotspots")}
            desc={t("exploreHotspots")}
            color="bg-orange-100 text-orange-700"
          />
          <ExploreCard
            to="/threat-distribution"
            icon={ShieldAlert}
            title={t("navThreat")}
            desc={t("exploreThreat")}
            color="bg-red-100 text-red-700"
          />
          <ExploreCard
            to="/trends"
            icon={TrendingUp}
            title={t("navTrends")}
            desc={t("exploreTrends")}
            color="bg-emerald-100 text-emerald-700"
          />
          <ExploreCard
            to="/species"
            icon={Search}
            title={t("navSpecies")}
            desc={t("exploreSpecies")}
            color="bg-blue-100 text-blue-700"
          />
          <ExploreCard
            to="/ai"
            icon={BrainCircuit}
            title={t("navAi")}
            desc={t("exploreAi")}
            color="bg-purple-100 text-purple-700"
          />
          <ExploreCard
            to="/insights"
            icon={Network}
            title={t("navInsights")}
            desc={t("exploreInsights")}
            color="bg-teal-100 text-teal-700"
          />
          <ExploreCard
            to="/mcp"
            icon={Cpu}
            title={t("navMcp")}
            desc={t("exploreMcp")}
            color="bg-slate-100 text-slate-700"
          />
        </div>
      </div>
    </div>
  );
}
