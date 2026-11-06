import countries from "../data/icao-countries.json";
import iataIcao from "../data/iata-icao.json";

type CiRegionRow = { id: string; airports?: unknown[] };
const countryMap = countries as Record<string, string>;
const iataMap = iataIcao as Record<string, string>;
const regions: Record<string, string> = {
  AU: "aus", TH: "sea", SG: "sea", MY: "sea", ID: "sea", PH: "sea",
  KH: "sea", LA: "sea", MM: "sea", BN: "sea", TL: "sea",
  TW: "twhk", HK: "twhk", MO: "twhk", JP: "japan", KR: "korea",
  CN: "china", IN: "india", LK: "india", KZ: "kz", RU: "russia", VN: "vietnam",
};

function code(value: unknown): string { return String(value ?? "").trim().toUpperCase(); }
function icao(value: unknown): string {
  const apt = code(value);
  return apt.length === 3 ? iataMap[apt] || "" : apt;
}

/** Unknown airports remain unknown: never infer country from a prefix or timezone. */
export function airportCountry(airport: string): string {
  return (countryMap[icao(airport)] || "").toUpperCase();
}

function listed(row: CiRegionRow | undefined, airport: string): boolean {
  return (row?.airports || []).some(value => code(value) === code(airport) || (!!icao(value) && icao(value) === icao(airport)));
}

/** Explicit airport rows win; country recognition supplies the missing regional coverage. */
export function selectCostIndexRow<T extends CiRegionRow>(rows: T[], dep: string, arr: string, domesticAirports: string[] = []): T | undefined {
  const domestic = rows.find(row => row.id === "domestic");
  const fallback = { id: "domestic", airports: domesticAirports };
  const isDomestic = (apt: string) => airportCountry(apt) === "VN" || listed(domestic?.airports?.length ? domestic : fallback, apt);
  if (isDomestic(dep) && isDomestic(arr)) return domestic;
  const international = rows.filter(row => row.id !== "domestic" && row.id !== "vietnam");
  // Dedicated exception rows must override broad regional airport lists regardless of row order.
  const exception = international.find(row => !Object.values(regions).includes(row.id) && listed(row, dep));
  if (exception) return exception;
  if (isDomestic(dep)) return rows.find(row => row.id === "vietnam");
  const explicit = international.find(row => listed(row, dep));
  if (explicit) return explicit;
  const region = regions[airportCountry(dep)];
  return region ? rows.find(row => row.id === region) : undefined;
}