// Australian DAH (Designated Airspace Handbook) zones for the Database → Named Airspace tab.
import AU_DAH from "../data/au_dah.json";

type Pt = [number, number];
const D = AU_DAH as unknown as { source: string; rings: Record<string, Pt[]>; fir?: Record<string, string>; vert?: Record<string, string> };

export function auDahCatalogue() {
  return Object.keys(D.rings).sort().map(id => {
    const vert = D.vert?.[id] || "";
    const [lower, upper] = vert.split(/\s+-\s+/);
    const fl = /^FL\s*(\d+)/i.exec(upper || "");
    const ft = /^(\d+)/.exec(upper || "");
    return {
      id, countryCode: "AU", country: "Úc - Australia", name: id,
      fir: D.fir?.[id] || "", source: "", document: D.source, effective: "",
      lower: lower || vert, upperFt: fl ? Number(fl[1]) * 100 : ft ? Number(ft[1]) : null,
      activation: vert ? `Giới hạn đứng: ${vert}` : "",
      geometry: { shape: "polygon" as const, ring: D.rings[id]! },
    };
  });
}
