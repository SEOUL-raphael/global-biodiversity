import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { COUNTRIES, getCountryName } from "@/lib/countries";
import { useLang } from "@/lib/i18n";
import { getTileForLang } from "@/lib/mapTiles";

export interface MapPoint {
  countryCode: string;
  value: number;
  label?: string;
  color?: string;
}

function FitToPoints({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    const coords = points
      .map((p) => COUNTRIES[p.countryCode])
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => [c.lat, c.lng] as [number, number]);
    if (coords.length > 1) {
      map.fitBounds(coords, { padding: [40, 40], maxZoom: 4 });
    }
  }, [points, map]);
  return null;
}

export function CountryMap({
  points,
  height = 360,
  mobileHeight,
  valueLabel,
}: {
  points: MapPoint[];
  height?: number;
  mobileHeight?: number;
  valueLabel?: string;
}) {
  const { lang } = useLang();
  const tile = getTileForLang(lang);
  const max = Math.max(1, ...points.map((p) => p.value));
  const mh = mobileHeight ?? Math.min(height, 260);

  return (
    <div
      className="rounded-xl overflow-hidden border border-slate-200 relative z-0 h-[var(--map-h-mobile)] sm:h-[var(--map-h)]"
      style={{
        ["--map-h" as string]: `${height}px`,
        ["--map-h-mobile" as string]: `${mh}px`,
      }}
    >
      <MapContainer
        center={[20, 0]}
        zoom={2}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
        worldCopyJump={true}
        zoomControl={true}
      >
        <TileLayer
          key={tile.url}
          attribution={tile.attribution}
          url={tile.url}
          subdomains={tile.subdomains}
          maxZoom={tile.maxZoom ?? 19}
        />
        <FitToPoints points={points} />
        {points.map((p) => {
          const c = COUNTRIES[p.countryCode];
          if (!c) return null;
          const radius = 6 + Math.sqrt(p.value / max) * 22;
          return (
            <CircleMarker
              key={p.countryCode}
              center={[c.lat, c.lng]}
              radius={radius}
              pathOptions={{
                color: p.color ?? "#10b981",
                fillColor: p.color ?? "#10b981",
                fillOpacity: 0.55,
                weight: 1.5,
              }}
            >
              <Tooltip direction="top" offset={[0, -2]} opacity={0.95}>
                <div className="text-xs">
                  <div className="font-semibold">
                    {p.label ?? getCountryName(p.countryCode, lang)} ({p.countryCode})
                  </div>
                  <div className="text-slate-600">
                    {valueLabel ?? "value"}: {p.value.toLocaleString()}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
