// Shared (client-safe) flight types and helpers.
export type Attachment = {
  id: number;
  title: string;
  filename: string;
  isPdf: boolean;
  createdOn: string | null;
  createdBy: string | null;
  kind: "PIB" | "WX" | "REG" | "OTHER";
  regCode: string | null;
};

export type AuditEntry = { at: string | null; action: string; by: string };

export type Flight = {
  id: number;
  callsign: string;
  dep: string;
  dest: string;
  depIata: string;
  destIata: string;
  alt1: string;
  alt2: string;
  std: string | null;
  sta: string | null;
  etd: string | null;
  atd: string | null;
  ata: string | null;
  eet: string;
  reg: string;
  acType: string;
  planNo: string;
  status: string;
  ofpStatus: string;
  dispatcher: string;
  releasedBy: string;
  verifiedBy: string;
  hasOfp: boolean;
  isLocked: boolean;
  etops: boolean;
  needsReRelease: boolean;
  fuel: {
    trip: number | null;
    total: number | null;
    taxi: number | null;
    reserve: number | null;
    alternate: number | null;
    contingency: number | null;
    extra: number | null;
    tankering: number | null;
    units: string;
  };
  tow: number | null;
  lwt: number | null;
  zfw: number | null;
  pax: { adults: number | null; children: number | null; infants: number | null };
  crewCount: number;
  route: string;
  attachments: Attachment[];
  audit: AuditEntry[];
  pibWx: "OK" | "MISS_WX" | "MISS_PIB" | "MISS_BOTH";
  regMatch: boolean | null;
};

export type Crew = {
  id: number;
  name: string;
  username: string;
  job: string;
  dept: string;
  commander: boolean;
  deadheading: boolean;
  accepted: boolean;
};

export const fmtUtc = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}Z`;
};

export const fmtNum = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
