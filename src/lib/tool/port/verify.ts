// Port of api/verify.py (ofp_ack_needed already lived here; now the full
// verify/voyage/pack/release chain). Network calls are injected via FbClient
// so this stays unit-testable without a server import.
import type { Flight } from "../core/models";

export function ofpAckNeeded(flight: Flight): boolean {
  if (flight.needs_re_release) return true;
  const raw = flight.raw || {};
  return !!(raw["ofpActionRequired"] || raw["new_ofp_received"] || raw["unReleasedOfp"] || raw["needs_re_release"]);
}

export function alreadyGreen(flight: Flight): boolean {
  if (ofpAckNeeded(flight)) return false;
  return !!(flight.raw || {})["voyage_released_on"];
}

export function canVerify(flight: Flight): string {
  if (!flight.plan_id) return "chưa có OFP (plan_id rỗng) — không có gì để verify";
  if (flight.is_locked) return "chuyến đang bị khoá (is_locked)";
  return "";
}

export class VerifyError extends Error {}

export function ofpAckForm(changes: unknown): { data: string } {
  const data = (changes && typeof changes === "object" ? (changes as Record<string, unknown>) : {}) as Record<string, unknown>;
  const attachments: Array<{ id: unknown; type: unknown }> = [];
  for (const row of (data["attachments"] as unknown[]) ?? []) {
    if (!row || typeof row !== "object" || !(row as Record<string, unknown>)["id"]) continue;
    const r = row as Record<string, unknown>;
    attachments.push({ id: r["id"], type: r["type"] });
  }
  const audit: Array<{ id: unknown }> = [];
  for (const row of (data["audit"] as unknown[]) ?? []) {
    if (row && typeof row === "object" && (row as Record<string, unknown>)["id"]) audit.push({ id: (row as Record<string, unknown>)["id"] });
  }
  return { data: JSON.stringify({ attachments, audit }) };
}

export interface FbResp {
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}
/** Minimal FliteBrief transport the verify chain needs — implemented with fbGet/fbRequest in the handler. */
export interface FbClient {
  get(path: string): Promise<FbResp>;
  post(path: string, body?: unknown): Promise<FbResp>;
  del(path: string): Promise<FbResp>;
  sectorDetail(sectorId: number): Promise<Record<string, unknown> | null>;
  flightFromApi(row: Record<string, unknown>): Flight;
}

export async function refresh(fb: FbClient, flight: Flight): Promise<Flight> {
  try {
    const row = await fb.sectorDetail(flight.id);
    if (!row || !row["id"]) return flight;
    return fb.flightFromApi(row);
  } catch {
    return flight;
  }
}

export async function ackNewOfp(fb: FbClient, flight: Flight): Promise<void> {
  if (!flight.plan_id) throw new VerifyError("OFP mới cần acknowledge nhưng plan_id rỗng");
  let body: unknown;
  try {
    const r = await fb.get(`/webapi/sectors/${flight.id}/changes`);
    body = await r.json();
  } catch (exc) {
    throw new VerifyError(`đọc thay đổi OFP mới: ${(exc as Error).message || exc}`);
  }
  const posted = await fb.post(`/webapi/sectors/${flight.id}/plan/${flight.plan_id}/release`, ofpAckForm(body));
  if (![200, 201, 204].includes(posted.status)) {
    const t = (await posted.text().catch(() => "")).slice(0, 180);
    throw new VerifyError(`acknowledge OFP mới (tam giác đỏ): HTTP ${posted.status}${t ? " — " + t : ""}`);
  }
}

export interface Verified {
  flight: Flight;
  ok: boolean;
  already: boolean;
  error: string;
  verified_by: string;
  verified_on: string;
  level: "" | "vàng" | "xanh";
  voyage_id: number;
  acked_ofp: boolean;
}
function newVerified(flight: Flight, over: Partial<Verified> = {}): Verified {
  return { flight, ok: false, already: false, error: "", verified_by: "", verified_on: "", level: "", voyage_id: 0, acked_ofp: false, ...over };
}
export function verifiedLabel(v: Verified): string {
  const f = v.flight;
  const std = f.std ? ` ${f.std.toISOString().slice(5, 16).replace("T", " ")}Z` : "";
  return `${f.callsign} (${f.route})${std}`;
}

export async function verify(fb: FbClient, flight: Flight, opts: { skipIfDone?: boolean; fresh?: boolean } = {}): Promise<Verified> {
  let skipIfDone = opts.skipIfDone ?? true;
  const fresh = opts.fresh ?? true;
  let pendingAck = ofpAckNeeded(flight);
  if (fresh) {
    flight = await refresh(fb, flight);
    pendingAck = pendingAck || ofpAckNeeded(flight);
  }
  const res = newVerified(flight);

  if (pendingAck) {
    try {
      await ackNewOfp(fb, flight);
      flight = await refresh(fb, flight);
      res.flight = flight;
      res.acked_ofp = true;
      skipIfDone = false;
    } catch (exc) {
      res.error = (exc as Error).message || String(exc);
      return res;
    }
  }

  if (skipIfDone && flight.is_verified) {
    res.already = true;
    res.ok = true;
    res.verified_by = flight.verified_by_name || "";
    res.verified_on = flight.verified_on ? flight.verified_on.toISOString().slice(0, 16).replace("T", " ") : "";
    return res;
  }

  const why = canVerify(flight);
  if (why) {
    res.error = why;
    return res;
  }

  let r: FbResp;
  try {
    r = await fb.post(`/webapi/sectors/${flight.id}/verify/${flight.plan_id ?? ""}`, null);
  } catch (exc) {
    res.error = `${(exc as Error).name || "Error"}: ${(exc as Error).message || exc}`;
    return res;
  }
  if (![200, 201, 204].includes(r.status)) {
    const t = (await r.text().catch(() => "")).slice(0, 160);
    res.error = `HTTP ${r.status}: ${t}`;
    return res;
  }
  let body: Record<string, unknown> = {};
  try {
    const j = await r.json();
    if (j && typeof j === "object") body = j as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  res.ok = true;
  res.verified_by = String(body["verified_by_name"] ?? "");
  const vo = body["verified_on"];
  res.verified_on = String((vo && typeof vo === "object" ? (vo as Record<string, unknown>)["date"] : vo) ?? "");
  return res;
}

export async function createVoyage(fb: FbClient, flight: Flight): Promise<number> {
  const have = (flight.raw || {})["voyage_id"];
  if (typeof have === "number" && have > 0) return have;
  const r = await fb.post("/webapi/voyages", { sectors: JSON.stringify([{ id: flight.id, order: 0 }]) });
  if (![200, 201].includes(r.status)) {
    const t = (await r.text().catch(() => "")).slice(0, 180);
    throw new VerifyError(`tạo voyage: HTTP ${r.status}${t ? " — " + t : ""}`);
  }
  let body: unknown;
  try {
    body = await r.json();
  } catch {
    throw new VerifyError("tạo voyage: server không trả JSON");
  }
  const rows = Array.isArray(body) ? body : [body];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rr = row as Record<string, unknown>;
    let vid = rr["voyage_id"];
    if (!vid) {
      for (const key of ["summary", "sectors"]) {
        const sub = rr[key];
        if (Array.isArray(sub) && sub.length && sub[0] && typeof sub[0] === "object") {
          vid = (sub[0] as Record<string, unknown>)["voyage_id"];
          if (vid) break;
        }
      }
    }
    if (vid) return Number(vid);
  }
  throw new VerifyError("tạo voyage: không thấy voyage_id trong phản hồi");
}

export const PACK_POLL_S = 1.5;
export const PACK_TIMEOUT_S = 420;

export async function buildPack(
  fb: FbClient,
  voyageId: number,
  opts: { printStyle?: string | undefined; printSize?: string | undefined; timeoutS?: number | undefined; onWait?: ((s: number) => void) | undefined; cancel?: { isSet: () => boolean } | undefined; sleep?: ((ms: number) => Promise<void>) | undefined } = {},
): Promise<void> {
  const printStyle = opts.printStyle ?? "DUPLEX";
  const printSize = opts.printSize ?? "A4";
  const timeoutS = opts.timeoutS ?? PACK_TIMEOUT_S;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const url = `/webapi/voyages/${voyageId}/pack?printStyle=${printStyle}&printSize=${printSize}`;
  const t0 = Date.now();
  for (;;) {
    if (opts.cancel?.isSet()) throw new VerifyError("đã huỷ khi đang sinh briefing");
    const r = await fb.get(url);
    if (![200, 201, 202].includes(r.status)) {
      const t = (await r.text().catch(() => "")).slice(0, 180);
      throw new VerifyError(`sinh briefing: HTTP ${r.status}${t ? " — " + t : ""}`);
    }
    let body: unknown;
    try {
      body = await r.json();
    } catch {
      return;
    }
    if (body === true) return;
    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      if (b["isProcessing"] === false) return;
      if (!("isProcessing" in b)) return;
    }
    const waited = (Date.now() - t0) / 1000;
    if (waited > timeoutS) throw new VerifyError(`sinh briefing quá ${timeoutS.toFixed(0)}s mà server vẫn báo đang xử lý`);
    opts.onWait?.(waited);
    await sleep(PACK_POLL_S * 1000);
  }
}

export async function releaseVoyage(fb: FbClient, voyageId: number): Promise<void> {
  const r = await fb.post(`/webapi/voyages/${voyageId}/releases`, null);
  if (![200, 201, 204].includes(r.status)) {
    const t = (await r.text().catch(() => "")).slice(0, 180);
    throw new VerifyError(`release voyage: HTTP ${r.status}${t ? " — " + t : ""}`);
  }
}

export async function verifyGreen(
  fb: FbClient,
  flight: Flight,
  opts: {
    skipIfDone?: boolean | undefined;
    printStyle?: string | undefined;
    printSize?: string | undefined;
    onStep?: ((msg: string) => void) | undefined;
    cancel?: { isSet: () => boolean } | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
  } = {},
): Promise<Verified> {
  const say = (msg: string) => opts.onStep?.(msg);
  const stopped = () => !!opts.cancel?.isSet();

  if (stopped()) return newVerified(flight, { error: "đã huỷ" });

  let res = await verify(fb, flight, { skipIfDone: opts.skipIfDone ?? true, fresh: true });
  flight = res.flight;
  if (!res.ok) return res;
  res.level = "vàng";
  if (stopped()) {
    res.ok = false;
    res.error = "đã huỷ sau khi verify — chưa lên XANH";
    return res;
  }

  if ((opts.skipIfDone ?? true) && alreadyGreen(flight) && !res.acked_ofp && !ofpAckNeeded(flight)) {
    res.already = true;
    res.level = "xanh";
    return res;
  }
  res.already = false;

  try {
    if (stopped()) throw new VerifyError("đã huỷ");
    say(`   · ${verifiedLabel(res)}: tạo voyage`);
    let vid: number;
    try {
      vid = await createVoyage(fb, flight);
    } catch (exc) {
      if (!String((exc as Error).message ?? exc).toLowerCase().includes("not been released")) throw exc;
      say(`   · ${verifiedLabel(res)}: plan mới nhất chưa release — acknowledge tam giác đỏ rồi verify lại`);
      await ackNewOfp(fb, flight);
      const again = await verify(fb, flight, { skipIfDone: false, fresh: true });
      if (!again.ok) throw new VerifyError(`verify lại vẫn không được — ${again.error}`);
      flight = again.flight;
      res.flight = flight;
      vid = await createVoyage(fb, flight);
    }
    res.voyage_id = vid;

    if (stopped()) throw new VerifyError("đã huỷ");
    say(`   · ${verifiedLabel(res)}: sinh briefing (voyage ${vid}) — có thể mất vài chục giây`);
    await buildPack(fb, vid, {
      printStyle: opts.printStyle,
      printSize: opts.printSize,
      onWait: (s) => say(`   · ${verifiedLabel(res)}: còn đang xử lý… ${s.toFixed(0)}s`),
      cancel: opts.cancel,
      sleep: opts.sleep,
    });

    if (stopped()) throw new VerifyError("đã huỷ khi đang sinh briefing");
    say(`   · ${verifiedLabel(res)}: release voyage`);
    await releaseVoyage(fb, vid);
    res.level = "xanh";
  } catch (exc) {
    res.ok = false;
    if (exc instanceof VerifyError) res.error = `đã VÀNG nhưng chưa lên XANH — ${exc.message}`;
    else res.error = `đã VÀNG nhưng chưa lên XANH — ${(exc as Error).name || "Error"}: ${(exc as Error).message || exc}`;
  }
  return res;
}

export async function unverify(fb: FbClient, flight: Flight): Promise<Verified> {
  const res = newVerified(flight);
  if (!flight.plan_id) {
    res.error = "chưa có OFP (plan_id rỗng)";
    return res;
  }
  let r: FbResp;
  try {
    r = await fb.del(`/webapi/sectors/${flight.id}/verify/${flight.plan_id}`);
  } catch (exc) {
    res.error = `${(exc as Error).name || "Error"}: ${(exc as Error).message || exc}`;
    return res;
  }
  res.ok = [200, 204].includes(r.status);
  if (!res.ok) res.error = `HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`;
  return res;
}

export async function verifyMany(
  fb: FbClient,
  flights: Flight[],
  opts: {
    skipIfDone?: boolean;
    dryRun?: boolean;
    green?: boolean;
    onProgress?: (text: string, res: Verified) => void;
    cancel?: { isSet: () => boolean };
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<Verified[]> {
  const items = flights;
  const out: Verified[] = [];
  const green = opts.green ?? true;
  const dryRun = !!opts.dryRun;

  for (let i = 0; i < items.length; i++) {
    const f = items[i]!;
    if (opts.cancel?.isSet()) break;
    const want = green ? "xanh" : "vàng";

    if (dryRun) {
      const res = newVerified(f);
      const doneGreen = alreadyGreen(f);
      let note: string;
      if (f.is_verified && (doneGreen || !green) && !ofpAckNeeded(f)) {
        res.already = res.ok = true;
        res.level = doneGreen ? "xanh" : "vàng";
        res.verified_by = f.verified_by_name || "";
        note = `đã ${res.level} sẵn`;
      } else {
        const why = canVerify(f);
        res.error = why;
        res.ok = !why;
        note = res.ok ? (f.is_verified ? "đã vàng, sẽ làm tiếp lên xanh" : `sẽ verify lên ${want}`) : why;
      }
      out.push(res);
      opts.onProgress?.(`[thử] ${verifiedLabel(res)} · ${note}`, res);
      continue;
    }

    opts.onProgress?.(`→ [${i + 1}/${items.length}] ${verifiedLabel(newVerified(f))} → ${want}`, newVerified(f));

    let res: Verified;
    if (green) {
      res = await verifyGreen(fb, f, {
        skipIfDone: opts.skipIfDone ?? true,
        cancel: opts.cancel,
        sleep: opts.sleep,
        onStep: opts.onProgress ? (m) => opts.onProgress!(m, newVerified(f)) : undefined,
      });
    } else {
      res = await verify(fb, f, { skipIfDone: opts.skipIfDone ?? true });
      if (res.ok) res.level = res.level || "vàng";
    }

    out.push(res);
    if (opts.onProgress) {
      let txt: string;
      if (res.already) txt = `· ${verifiedLabel(res)}: đã ${res.level || "verify"} sẵn (${res.verified_by || "?"})`;
      else if (res.ok) txt = `✓ ${verifiedLabel(res)} → ${res.level.toUpperCase()}  (${i + 1}/${items.length})`;
      else txt = `✗ ${verifiedLabel(res)}: ${res.error}`;
      opts.onProgress(txt, res);
    }
  }
  return out;
}
