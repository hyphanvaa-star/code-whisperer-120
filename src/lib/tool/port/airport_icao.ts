// Browser-safe IATA→ICAO resolver: curated operator table first, then the
// bundled worldwide dictionary so international airports (e.g. CZX→ZSCG) resolve.
import iataIcao from "../data/iata-icao.json";
import { IATA_ICAO } from "./limits_check";

const WORLD = iataIcao as Record<string, string>;

export function icaoFromIata(code: unknown): string {
  const raw = String(code ?? "").trim().toUpperCase();
  if (raw.length !== 3 || !/^[A-Z]+$/.test(raw)) return "";
  return IATA_ICAO[raw] || WORLD[raw] || "";
}
