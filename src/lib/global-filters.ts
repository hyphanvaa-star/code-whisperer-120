import { useEffect, useState } from "react";

/** Bộ lọc chung ở thanh trên cùng (giống tool gốc): áp dụng cho mọi tab. */
export type GlobalFilters = {
  dispatcher: string;
  callsign: string;
  dep: string;
  dest: string;
  reg: string;
  window: string; // "std" = -6/+24h, "day" = cả ngày, "12" = -2/+12h
};

export const EMPTY_FILTERS: GlobalFilters = { dispatcher: "", callsign: "", dep: "", dest: "", reg: "", window: "std" };
const KEY = "global-filters";
const EVT = "global-filters-change";

export function useGlobalFilters() {
  const [f, setF] = useState<GlobalFilters>(EMPTY_FILTERS);
  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      if (s) setF({ ...EMPTY_FILTERS, ...JSON.parse(s) });
    } catch {}
    const on = (e: Event) => setF((e as CustomEvent<GlobalFilters>).detail);
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  const update = (patch: Partial<GlobalFilters>) => {
    setF((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(EVT, { detail: next }));
      return next;
    });
  };
  return [f, update] as const;
}

type FlightLike = {
  dispatcher?: string | null;
  callsign?: string;
  dep?: string;
  depIata?: string;
  dest?: string;
  destIata?: string;
  reg?: string;
};

export function matchGlobal(fl: FlightLike, g: GlobalFilters) {
  const up = (s?: string | null) => (s ?? "").toUpperCase();
  if (g.dispatcher && !up(fl.dispatcher).includes(up(g.dispatcher.trim()))) return false;
  if (g.callsign && !up(fl.callsign).replace(/\s/g, "").includes(up(g.callsign).replace(/\s|^VJC/g, ""))) return false;
  if (g.dep && !up(fl.dep).includes(up(g.dep)) && !up(fl.depIata).includes(up(g.dep))) return false;
  if (g.dest && !up(fl.dest).includes(up(g.dest)) && !up(fl.destIata).includes(up(g.dest))) return false;
  if (g.reg && !up(fl.reg).replace(/-/g, "").includes(up(g.reg).replace(/-/g, ""))) return false;
  return true;
}
