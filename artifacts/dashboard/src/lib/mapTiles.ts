import type { Lang } from "./i18n";

export interface TileSpec {
  url: string;
  attribution: string;
  subdomains: string[];
  maxZoom?: number;
}

const ATTR_ESRI =
  "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community";

const ESRI_WORLD_STREET: TileSpec = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
  attribution: ATTR_ESRI,
  subdomains: [],
  maxZoom: 17,
};

export function getTileForLang(_lang: Lang): TileSpec {
  return ESRI_WORLD_STREET;
}
