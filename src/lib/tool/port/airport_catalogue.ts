// Danh mục sân bay cho tab Database: ICAO → quốc gia (icao-countries) + UTC offset (world_tz).
import icaoCountries from "../data/icao-countries.json";
import worldTz from "../data/world_tz.json";

export type AirportRow = [icao: string, cc: string, utc: string];

export function airportCatalogue(): AirportRow[] {
  const cc = icaoCountries as Record<string, string>;
  const tz = worldTz as Record<string, string>;
  const out: AirportRow[] = [];
  for (const [icao, c] of Object.entries(cc)) {
    if (!/^[A-Z]{4}$/.test(icao) || !c) continue;
    const off = tz[icao];
    if (off) out.push([icao, c.toUpperCase(), off]);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}
