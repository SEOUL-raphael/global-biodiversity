export type TaxonRank =
  | "KINGDOM"
  | "PHYLUM"
  | "CLASS"
  | "ORDER"
  | "FAMILY"
  | "GENUS"
  | "SPECIES"
  | "SUBSPECIES"
  | "VARIETY"
  | "FORM"
  | "UNRANKED";

export type IucnStatus =
  | "EX"
  | "EW"
  | "CR"
  | "EN"
  | "VU"
  | "NT"
  | "LC"
  | "DD"
  | "NE";

export type BasisOfRecord =
  | "PRESERVED_SPECIMEN"
  | "FOSSIL_SPECIMEN"
  | "LIVING_SPECIMEN"
  | "HUMAN_OBSERVATION"
  | "MACHINE_OBSERVATION"
  | "MATERIAL_SAMPLE"
  | "OCCURRENCE";

export interface GbifTaxon {
  key: number;
  nubKey?: number;
  nameKey?: number;
  taxonID?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  kingdomKey?: number;
  phylumKey?: number;
  classKey?: number;
  orderKey?: number;
  familyKey?: number;
  genusKey?: number;
  speciesKey?: number;
  parentKey?: number;
  parent?: string;
  scientificName: string;
  canonicalName?: string;
  vernacularName?: string;
  rank?: TaxonRank;
  origin?: string;
  numDescendants?: number;
  numOccurrences?: number;
  habitat?: string;
  extinct?: boolean;
  threatStatuses?: IucnStatus[];
  iucnRedListCategory?: IucnStatus;
  synonym?: boolean;
  taxonomicStatus?: string;
}

export interface GbifOccurrence {
  key: number;
  datasetKey?: string;
  occurrenceID?: string;
  taxonKey?: number;
  scientificName?: string;
  canonicalName?: string;
  kingdom?: string;
  family?: string;
  genus?: string;
  species?: string;
  basisOfRecord?: BasisOfRecord;
  decimalLatitude?: number;
  decimalLongitude?: number;
  countryCode?: string;
  country?: string;
  year?: number;
  month?: number;
  day?: number;
  eventDate?: string;
  lastInterpreted?: string;
}

export interface GbifPaginatedResponse<T> {
  offset: number;
  limit: number;
  endOfRecords: boolean;
  count: number;
  results: T[];
}

export interface GbifSpeciesSearchParams {
  q?: string;
  rank?: TaxonRank;
  status?: string;
  isExtinct?: boolean;
  highertaxonKey?: number;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  habitat?: string;
  threatStatus?: IucnStatus;
  offset?: number;
  limit?: number;
}

export interface GbifOccurrenceSearchParams {
  taxonKey?: number;
  scientificName?: string;
  countryCode?: string;
  hasCoordinate?: boolean;
  hasGeospatialIssue?: boolean;
  year?: string;
  month?: number;
  basisOfRecord?: BasisOfRecord;
  offset?: number;
  limit?: number;
}

export interface GbifOccurrenceCountParams {
  taxonKey?: number;
  countryCode?: string;
  year?: number;
  basisOfRecord?: BasisOfRecord;
}
