import { useMemo } from "react";
import { useGetKgEndangeredHotspots } from "@workspace/api-client-react";
import { AlertTriangle, MapPin, ExternalLink } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { InfoCard } from "@/components/InfoCard";
import { CountryMap } from "@/components/CountryMap";
import { SpeciesLink } from "@/components/SpeciesLink";
import { countryWikiUrl } from "@/lib/wiki";
import { getCountryName } from "@/lib/countries";

const STATUS_COLOR: Record<string, string> = {
  EXTINCT: "bg-red-100 text-red-800",
  CRITICALLY_ENDANGERED: "bg-orange-100 text-orange-800",
  ENDANGERED: "bg-amber-100 text-amber-800",
  VULNERABLE: "bg-yellow-100 text-yellow-800",
  NEAR_THREATENED: "bg-lime-100 text-lime-800",
};

export default function Hotspots() {
  const { t, lang } = useLang();
  const { data, isLoading, error } = useGetKgEndangeredHotspots({ limit: 30 });

  const mapPoints = useMemo(
    () =>
      (data?.hotspots ?? []).map((h) => ({
        countryCode: h.countryCode,
        value: h.endangeredCount,
        label: h.regionLabel,
        color: "#f97316",
      })),
    [data],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-6 h-6 text-orange-500 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{t("hotspotsTitle")}</h1>
          <p className="text-sm text-slate-500">{t("hotspotsSubtitle")}</p>
        </div>
      </div>

      <InfoCard source={t("hotspotsSource")} method={t("hotspotsMethod")} />

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
          {mapPoints.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">{t("worldMap")}</h2>
              <CountryMap points={mapPoints} valueLabel={t("threatened")} height={360} mobileHeight={260} />
            </div>
          )}

          <div className="text-sm text-slate-500">
            {data.count} {t("hotspotsDetected")}
          </div>
          <div className="grid gap-4">
            {data.hotspots.map((h: (typeof data.hotspots)[number]) => (
              <div
                key={h.countryCode}
                className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-slate-100 shrink-0">
                      <MapPin className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" />
                    </div>
                    <div className="min-w-0">
                      <a
                        href={countryWikiUrl(getCountryName(h.countryCode, lang), lang)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-slate-900 text-sm sm:text-base hover:text-blue-600 inline-flex items-center gap-1"
                      >
                        <span className="truncate">{getCountryName(h.countryCode, lang)}</span>
                        <ExternalLink className="w-3 h-3 opacity-50 shrink-0" />
                      </a>
                      <p className="text-xs text-slate-400 font-mono">{h.countryCode}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xl sm:text-2xl font-bold text-orange-600">{h.endangeredCount}</p>
                    <p className="text-[10px] sm:text-xs text-slate-400">{t("threatened")}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {h.iucnStatuses.map((s: string) => (
                    <span
                      key={s}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        STATUS_COLOR[s] ?? "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {s.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>

                {h.topSpecies.length > 0 && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <p className="text-xs font-medium text-slate-500 mb-2">{t("topSpecies")}</p>
                    <div className="space-y-1.5">
                      {h.topSpecies.map((sp: (typeof h.topSpecies)[number]) => (
                        <div key={sp.taxonKey} className="flex items-center justify-between">
                          <SpeciesLink name={sp.label} className="text-sm" />
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              STATUS_COLOR[sp.iucnStatus ?? ""] ?? "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {sp.iucnStatus?.replace(/_/g, " ") ?? "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
