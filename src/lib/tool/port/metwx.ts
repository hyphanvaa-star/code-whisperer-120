// Port of metwx.py — pure, testable bits only. Login/download to the MET
// station intranet IPs (113.161.121.25, 14.177.232.218, danmet.vatm.vn, …) are
// company-intranet hosts unreachable from a Cloudflare Worker; the download
// endpoint in wx.server.ts returns an honest Vietnamese error instead of
// faking success. Kept here: site catalogue + Create-Time / filename parsing,
// in case a future PC-agent job wants to reuse it.

export type MetSiteFlavor = "wafs" | "folder" | "href";

export type MetSite = {
  key: string;
  name: string;
  base: string;
  cat: number;
  sub: number;
  flavor: MetSiteFlavor;
};

export const SITES: Record<string, MetSite> = {
  tsn: { key: "tsn", name: "TanSonNhat MET Office", base: "http://113.161.121.25", cat: 9, sub: 7, flavor: "wafs" },
  noibai: { key: "noibai", name: "NoiBai MET Office", base: "http://14.177.232.218:7102", cat: 5, sub: 0, flavor: "folder" },
  danang: { key: "danang", name: "DaNang MET (danmet.vatm.vn)", base: "https://danmet.vatm.vn", cat: 9, sub: 8, flavor: "href" },
  tsn2: { key: "tsn2", name: "TSN mirror", base: "http://118.69.213.84", cat: 9, sub: 7, flavor: "wafs" },
};

export const DEFAULT_ORDER = ["tsn", "danang", "noibai", "tsn2"] as const;
export const MAX_AGE_H = 8.0;

const RE_SUFFIX = /-\d{4}-\d{6}$/;
const RE_FOLDER_TIME = /(\d{4}-\d{2}-\d{2})\s+(\d{1,2})h(\d{2})/;
const CREATED_FORMATS = [
  /^(\d{2}):(\d{2}) (\d{1,2}) (\w+) (\d{4})$/, // "HH:MM D Month YYYY"
];
const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** "VJC154-VVTS-VVNB-1350-260726" -> true (bản phát hành lại). */
export function revised(name: string): boolean {
  return RE_SUFFIX.test(name || "");
}

/** Đổi Create Time (UTC hiển thị trên trang) thành Date. */
export function parseCreated(text: string): Date | null {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  const mf = RE_FOLDER_TIME.exec(t);
  if (mf) {
    const [, ymd, hh, mm] = mf;
    const d = new Date(`${ymd}T${String(hh).padStart(2, "0")}:${mm}:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  for (const re of CREATED_FORMATS) {
    const m = re.exec(t);
    if (m) {
      const [, hh, mm, dd, mon, yyyy] = m;
      const month = MONTHS[(mon || "").toLowerCase()];
      if (month === undefined) continue;
      const d = new Date(Date.UTC(Number(yyyy), month, Number(dd), Number(hh), Number(mm)));
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

export function ageHours(createdText: string, now: Date = new Date()): number | null {
  const d = parseCreated(createdText);
  if (!d) return null;
  return (now.getTime() - d.getTime()) / 3_600_000;
}
