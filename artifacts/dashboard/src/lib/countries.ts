import type { Lang } from "./i18n";

export interface CountryInfo {
  name: Partial<Record<Lang, string>> & { en: string };
  lat: number;
  lng: number;
}

export const COUNTRIES: Record<string, CountryInfo> = {
  US: { name: { ko: "미국", en: "United States", fr: "États-Unis" }, lat: 39.8, lng: -98.6 },
  CA: { name: { ko: "캐나다", en: "Canada", fr: "Canada" }, lat: 56.1, lng: -106.3 },
  MX: { name: { ko: "멕시코", en: "Mexico", fr: "Mexique" }, lat: 23.6, lng: -102.5 },
  BR: { name: { ko: "브라질", en: "Brazil", fr: "Brésil" }, lat: -14.2, lng: -51.9 },
  AR: { name: { ko: "아르헨티나", en: "Argentina", fr: "Argentine" }, lat: -38.4, lng: -63.6 },
  CL: { name: { ko: "칠레", en: "Chile", fr: "Chili" }, lat: -35.7, lng: -71.5 },
  PE: { name: { ko: "페루", en: "Peru", fr: "Pérou" }, lat: -9.2, lng: -75.0 },
  CO: { name: { ko: "콜롬비아", en: "Colombia", fr: "Colombie" }, lat: 4.6, lng: -74.3 },
  EC: { name: { ko: "에콰도르", en: "Ecuador", fr: "Équateur" }, lat: -1.8, lng: -78.2 },
  VE: { name: { ko: "베네수엘라", en: "Venezuela", fr: "Venezuela" }, lat: 6.4, lng: -66.6 },
  GB: { name: { ko: "영국", en: "United Kingdom", fr: "Royaume-Uni" }, lat: 55.4, lng: -3.4 },
  FR: { name: { ko: "프랑스", en: "France", fr: "France" }, lat: 46.2, lng: 2.2 },
  DE: { name: { ko: "독일", en: "Germany", fr: "Allemagne" }, lat: 51.2, lng: 10.5 },
  IT: { name: { ko: "이탈리아", en: "Italy", fr: "Italie" }, lat: 41.9, lng: 12.6 },
  ES: { name: { ko: "스페인", en: "Spain", fr: "Espagne" }, lat: 40.5, lng: -3.7 },
  PT: { name: { ko: "포르투갈", en: "Portugal", fr: "Portugal" }, lat: 39.4, lng: -8.2 },
  NL: { name: { ko: "네덜란드", en: "Netherlands", fr: "Pays-Bas" }, lat: 52.1, lng: 5.3 },
  BE: { name: { ko: "벨기에", en: "Belgium", fr: "Belgique" }, lat: 50.5, lng: 4.5 },
  CH: { name: { ko: "스위스", en: "Switzerland", fr: "Suisse" }, lat: 46.8, lng: 8.2 },
  AT: { name: { ko: "오스트리아", en: "Austria", fr: "Autriche" }, lat: 47.5, lng: 14.6 },
  PL: { name: { ko: "폴란드", en: "Poland", fr: "Pologne" }, lat: 51.9, lng: 19.1 },
  SE: { name: { ko: "스웨덴", en: "Sweden", fr: "Suède" }, lat: 60.1, lng: 18.6 },
  NO: { name: { ko: "노르웨이", en: "Norway", fr: "Norvège" }, lat: 60.5, lng: 8.5 },
  FI: { name: { ko: "핀란드", en: "Finland", fr: "Finlande" }, lat: 61.9, lng: 25.7 },
  DK: { name: { ko: "덴마크", en: "Denmark", fr: "Danemark" }, lat: 56.3, lng: 9.5 },
  IE: { name: { ko: "아일랜드", en: "Ireland", fr: "Irlande" }, lat: 53.1, lng: -7.7 },
  RU: { name: { ko: "러시아", en: "Russia", fr: "Russie" }, lat: 61.5, lng: 105.3 },
  UA: { name: { ko: "우크라이나", en: "Ukraine", fr: "Ukraine" }, lat: 48.4, lng: 31.2 },
  TR: { name: { ko: "튀르키예", en: "Türkiye", fr: "Turquie" }, lat: 39.0, lng: 35.2 },
  GR: { name: { ko: "그리스", en: "Greece", fr: "Grèce" }, lat: 39.1, lng: 21.8 },
  CZ: { name: { ko: "체코", en: "Czechia", fr: "Tchéquie" }, lat: 49.8, lng: 15.5 },
  CN: { name: { ko: "중국", en: "China", fr: "Chine" }, lat: 35.9, lng: 104.2 },
  JP: { name: { ko: "일본", en: "Japan", fr: "Japon" }, lat: 36.2, lng: 138.3 },
  KR: { name: { ko: "대한민국", en: "South Korea", fr: "Corée du Sud" }, lat: 35.9, lng: 127.8 },
  IN: { name: { ko: "인도", en: "India", fr: "Inde" }, lat: 20.6, lng: 78.9 },
  ID: { name: { ko: "인도네시아", en: "Indonesia", fr: "Indonésie" }, lat: -0.8, lng: 113.9 },
  PH: { name: { ko: "필리핀", en: "Philippines", fr: "Philippines" }, lat: 12.9, lng: 121.8 },
  TH: { name: { ko: "태국", en: "Thailand", fr: "Thaïlande" }, lat: 15.9, lng: 100.9 },
  VN: { name: { ko: "베트남", en: "Vietnam", fr: "Viêt Nam" }, lat: 14.1, lng: 108.3 },
  MY: { name: { ko: "말레이시아", en: "Malaysia", fr: "Malaisie" }, lat: 4.2, lng: 101.9 },
  SG: { name: { ko: "싱가포르", en: "Singapore", fr: "Singapour" }, lat: 1.4, lng: 103.8 },
  AU: { name: { ko: "호주", en: "Australia", fr: "Australie" }, lat: -25.3, lng: 133.8 },
  NZ: { name: { ko: "뉴질랜드", en: "New Zealand", fr: "Nouvelle-Zélande" }, lat: -40.9, lng: 174.9 },
  ZA: { name: { ko: "남아프리카공화국", en: "South Africa", fr: "Afrique du Sud" }, lat: -30.6, lng: 22.9 },
  KE: { name: { ko: "케냐", en: "Kenya", fr: "Kenya" }, lat: -0.0, lng: 37.9 },
  EG: { name: { ko: "이집트", en: "Egypt", fr: "Égypte" }, lat: 26.8, lng: 30.8 },
  MA: { name: { ko: "모로코", en: "Morocco", fr: "Maroc" }, lat: 31.8, lng: -7.1 },
  NG: { name: { ko: "나이지리아", en: "Nigeria", fr: "Nigéria" }, lat: 9.1, lng: 8.7 },
  TZ: { name: { ko: "탄자니아", en: "Tanzania", fr: "Tanzanie" }, lat: -6.4, lng: 34.9 },
  MG: { name: { ko: "마다가스카르", en: "Madagascar", fr: "Madagascar" }, lat: -18.8, lng: 46.9 },
  CM: { name: { ko: "카메룬", en: "Cameroon", fr: "Cameroun" }, lat: 7.4, lng: 12.4 },
  CR: { name: { ko: "코스타리카", en: "Costa Rica", fr: "Costa Rica" }, lat: 9.7, lng: -83.8 },
  PA: { name: { ko: "파나마", en: "Panama", fr: "Panama" }, lat: 8.5, lng: -80.8 },
  IL: { name: { ko: "이스라엘", en: "Israel", fr: "Israël" }, lat: 31.0, lng: 34.9 },
  SA: { name: { ko: "사우디아라비아", en: "Saudi Arabia", fr: "Arabie saoudite" }, lat: 23.9, lng: 45.1 },
  AE: { name: { ko: "아랍에미리트", en: "UAE", fr: "Émirats arabes unis" }, lat: 23.4, lng: 53.8 },
  IR: { name: { ko: "이란", en: "Iran", fr: "Iran" }, lat: 32.4, lng: 53.7 },
  PK: { name: { ko: "파키스탄", en: "Pakistan", fr: "Pakistan" }, lat: 30.4, lng: 69.3 },
  BD: { name: { ko: "방글라데시", en: "Bangladesh", fr: "Bangladesh" }, lat: 23.7, lng: 90.4 },
  LK: { name: { ko: "스리랑카", en: "Sri Lanka", fr: "Sri Lanka" }, lat: 7.9, lng: 80.8 },
};

// Per-language Intl.DisplayNames cache so we localize unknown ISO codes
// (e.g. "UY" → "Uruguay") without hand-curating every country.
const displayNameCache = new Map<Lang, Intl.DisplayNames | null>();
function getDisplayNames(lang: Lang): Intl.DisplayNames | null {
  if (displayNameCache.has(lang)) return displayNameCache.get(lang) ?? null;
  let dn: Intl.DisplayNames | null = null;
  try {
    dn = new Intl.DisplayNames([lang], { type: "region" });
  } catch {
    dn = null;
  }
  displayNameCache.set(lang, dn);
  return dn;
}

export function getCountryName(code: string, lang: Lang): string {
  const info = COUNTRIES[code];
  if (info) {
    const curated = info.name[lang] ?? info.name.en;
    if (curated) return curated;
  }
  if (/^[A-Z]{2}$/.test(code)) {
    try {
      const resolved = getDisplayNames(lang)?.of(code);
      if (resolved && resolved !== code) return resolved;
    } catch {
      /* ignore */
    }
  }
  return code;
}
