import type { Attachment, AuditEntry, Crew, Flight } from "./flight-model";

type Raw = Record<string, unknown>;

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseDt(v: unknown): string | null {
  if (!v) return null;
  let s: string;
  if (typeof v === "object" && v && "date" in v) s = String((v as Raw)["date"]) + "Z";
  else s = String(v);
  s = s.replace(" ", "T").replace(/\+0000$/, "Z").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (/T\d{2}:\d{2}:\d{2}\.\d+Z$/.test(s)) s = s.replace(/\.(\d{3})\d*Z$/, ".$1Z");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const RE_PIB = /\bPIB/i;
const RE_WX = [
  /^[A-Z]{2,3}\d+[-_][A-Z]{4}[-_][A-Z]{4}([-_].*)?\.pdf$/i,
  /^[A-Z]{2,3}\d+\s+\d{4}-\d{2}-\d{2}.*\bprint\s*\.pdf$/i,
  /_WX_/i,
];
const RE_REG = /^(?:VN-?A|A)\s*(\d{3})\s*\.pdf$/i;

function regCode(name: string): string | null {
  let t = name.trim();
  const m1 = t.match(RE_REG);
  if (m1) return m1[1] ?? null;
  t = t.replace(/^(?:[Z1-9]|AAA)\s+/i, "");
  let stem = t.toLowerCase().endsWith(".pdf") ? t.slice(0, -4) : t;
  stem = stem.replace(/\s+(?:VER|REV)\s*\d+\s*$/i, "").trim();
  const m2 = `${stem}.pdf`.match(RE_REG);
  if (m2) return m2[1] ?? null;
  const compact = `${stem}.pdf`.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m3 = compact.match(/^(?:VNA|A)(\d{3})PDF$/);
  return m3 ? (m3[1] ?? null) : null;
}

function toAttachment(a: Raw): Attachment | null {
  if (a["deleted_on"]) return null;
  const filename = str(a["original_filename"]);
  const title = str(a["title"]);
  const isPdf = a["file_type"] === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
  const rc = regCode(filename) ?? regCode(title);
  const kind: Attachment["kind"] =
    RE_PIB.test(filename) || RE_PIB.test(title)
      ? "PIB"
      : RE_WX.some((r) => r.test(filename))
        ? "WX"
        : rc
          ? "REG"
          : "OTHER";
  return {
    id: Number(a["id"]) || 0,
    title,
    filename: filename || title || `attachment_${a["id"]}`,
    isPdf,
    createdOn: parseDt(a["created_on"]),
    createdBy: str(a["created_by"]) || null,
    kind,
    regCode: rc,
  };
}

export function toFlight(d: Raw): Flight {
  const atts = ((d["attachments"] as Raw[]) ?? [])
    .filter((a) => a && typeof a === "object")
    .map(toAttachment)
    .filter((a): a is Attachment => !!a);
  const audit: AuditEntry[] = ((d["sector_audit"] as Raw[]) ?? [])
    .slice(-25)
    .reverse()
    .map((x) => ({
      at: parseDt(x["datetime"]),
      action: str(x["action"]),
      by: [str(x["forename"]), str(x["surname"])].filter(Boolean).join(" "),
    }));
  const hasPib = atts.some((a) => a["kind"] === "PIB");
  const hasWx = atts.some((a) => a["kind"] === "WX");
  const reg = str(d["reg"]) || str(d["ofp_reg"]);
  const regAtt = atts.find((a) => a["regCode"]);
  const regDigits = reg.replace(/\D/g, "").slice(-3);
  return {
    id: Number(d["id"]) || 0,
    callsign: str(d["callsign"]),
    dep: str(d["dep_icao"]),
    dest: str(d["dest_icao"]),
    depIata: str(d["dep_iata"]),
    destIata: str(d["dest_iata"]),
    alt1: str(d["dest_alt1"]),
    alt2: str(d["dest_alt2"]),
    std: parseDt(d["std"]),
    sta: parseDt(d["sta"]),
    etd: parseDt(d["etd"]),
    atd: parseDt(d["atd"]),
    ata: parseDt(d["ata"]),
    eet: str(d["eet"]),
    reg,
    acType: str(d["ac_type"]) || str(d["acft_type"]),
    planNo: str(d["plan_no"]),
    status: str(d["status"]),
    ofpStatus: str(d["ofp_status"]),
    dispatcher: str(d["dispatcher"]).replace(/\s+/g, " "),
    releasedBy: str(d["released_by_name"]),
    verifiedBy: str(d["verified_by_name"]),
    hasOfp: !!d["hasOfp"],
    isLocked: !!d["is_locked"],
    etops: !!d["etops"],
    needsReRelease: !!d["needs_re_release"],
    fuel: {
      trip: num(d["planned_fuel"]),
      total: num(d["total_fuel"]) ?? num(d["planned_fuel_total"]),
      taxi: num(d["planned_taxi_fuel"]),
      reserve: num(d["planned_reserve_fuel"]),
      alternate: num(d["planned_alt_fuel"]),
      contingency: num(d["planned_con_fuel"]),
      extra: num(d["planned_extra_fuel"]),
      tankering: num(d["tankering_fuel"]),
      units: str(d["fuel_units"]) || "KG",
    },
    tow: num(d["planned_takeoff_weight"]),
    lwt: num(d["landing_weight"]),
    zfw: num(d["zero_fuel_weight"]) ?? num(d["planned_zero_fuel_weight"]),
    pax: { adults: num(d["pax_adults"]), children: num(d["pax_children"]), infants: num(d["pax_infants"]) },
    crewCount: Number(d["crew_count"]) || 0,
    route: str(d["route_description"]) || str(d["company_route"]),
    attachments: atts,
    audit,
    pibWx: hasPib && hasWx ? "OK" : hasPib ? "MISS_WX" : hasWx ? "MISS_PIB" : "MISS_BOTH",
    regMatch: regAtt && regDigits ? regAtt.regCode === regDigits : null,
  };
}

export function toCrew(c: Raw): Crew | null {
  if (c["deleted_on"]) return null;
  const job = (c["job"] as Raw) ?? {};
  return {
    id: Number(c["id"]) || 0,
    name: [str(c["forename"]), str(c["surname"])].filter(Boolean).join(" "),
    username: str(c["username"]),
    job: str(job["name"]),
    dept: str(job["dept"]),
    commander: !!c["commander"],
    deadheading: !!c["deadheading"],
    accepted: !!c["is_sector_accepted"],
  };
}

/** Throws unless the caller holds the dispatcher (or admin) role. */
export async function assertDispatcher(supabase: {
  rpc: (fn: "has_role", args: { _user_id: string; _role: "admin" | "dispatcher" }) => PromiseLike<{ data: boolean | null }>;
}, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "dispatcher" });
  if (data) return;
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) throw new Error("Tài khoản chưa được quản trị viên cấp quyền");
}

export async function logActivity(userId: string, action: string, detail?: string) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("activity_log").insert({ user_id: userId, action, detail: detail ? detail.slice(0, 500) : null });
  } catch {
    /* logging must never break the request */
  }
}
