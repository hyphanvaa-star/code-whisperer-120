// Giới hạn đặc biệt dạng chọn sẵn — dùng chung cho trang tool (chèn qua shim) và server.
// Một dòng: { rule, acs: ["ALL"|"REG:VNA202"|"TYPE:A21N"|"GROUP:Tên"], apts: ["VN"|"INTL"|"SEA"|"NEA"|"VVTS"…], note }
export const SR_RULES = [
  { id: "DOMESTIC_ONLY", label: "Chỉ bay nội địa Việt Nam (không bay quốc tế)", apt: false },
  { id: "NO_DOMESTIC", label: "Không bay nội địa Việt Nam", apt: false },
  { id: "SEA_ONLY", label: "Chỉ bay trong Đông Nam Á", apt: false },
  { id: "ONLY_APTS", label: "Chỉ bay đi/đến các sân đã chọn", apt: true },
  { id: "ONLY_ACS_APTS", label: "Chỉ các tàu đã chọn được bay đến các sân đã chọn", apt: true },
  { id: "NO_OPS_APTS", label: "Không bay đi/đến các sân đã chọn", apt: true },
  { id: "NO_DEP_APTS", label: "Không cất cánh từ các sân đã chọn", apt: true },
  { id: "NO_ARR_APTS", label: "Không hạ cánh tại các sân đã chọn", apt: true },
  { id: "NO_DEST_ALT", label: "Không dùng sân đã chọn làm dự bị đến (ALT1/ALT2)", apt: true },
  { id: "NO_TO_ALT", label: "Không dùng sân đã chọn làm dự bị cất cánh (TALT)", apt: true },
  { id: "NO_ANY_ROLE", label: "Không dùng sân đã chọn ở bất kỳ vai trò nào (DEP/DEST/ALT/TALT)", apt: true },
  { id: "NO_EDTO", label: "Không khai thác EDTO/ETOPS", apt: false },
  { id: "NOTE", label: "Lưu ý khác (chỉ cảnh báo vàng, ghi chú tự nhập)", apt: true },
];
export const SR_REGIONS = [
  { id: "VN", label: "Tất cả sân bay Việt Nam" },
  { id: "INTL", label: "Tất cả sân bay quốc tế (ngoài VN)" },
  { id: "SEA", label: "Đông Nam Á" },
  { id: "NEA", label: "Đông Bắc Á (Nhật, Hàn, TQ, Đài, HK, Macau)" },
  { id: "SA", label: "Nam Á (Ấn Độ…)" },
  { id: "OCE", label: "Úc / châu Đại Dương" },
];
const IATA_ICAO = {
  HAN: "VVNB", SGN: "VVTS", DAD: "VVDN", HPH: "VVCI", CXR: "VVCR", VCA: "VVCT", VCL: "VVCA", PXU: "VVPK",
  THD: "VVTX", PQC: "VVPQ", HUI: "VVPB", BMV: "VVBM", VII: "VVVH", VDH: "VVDH", DLI: "VVDL", TBB: "VVTH",
  DIN: "VVDB", UIH: "VVPC", VDO: "VVVD", VKG: "VVRG", CAH: "VVCM", VCS: "VVCS",
};
const norm = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");
export function srIcao(code) { const n = norm(code); return n.length === 3 ? IATA_ICAO[n] || n : n; }
export function srRegionOf(code) {
  const c = srIcao(code);
  if (!c) return "";
  if (c.length === 3) return "INTL";
  const p = c.slice(0, 2), p1 = c[0];
  if (p === "VV") return "VN";
  if (["VD", "VL", "VT", "VY", "WM", "WB", "WS", "WI", "WA", "WR", "WQ", "RP", "WP"].includes(p)) return "SEA";
  if (["RJ", "RO", "RK", "RC", "VH", "VM", "ZM", "ZK"].includes(p) || p1 === "Z") return "NEA";
  if (["VA", "VI", "VO", "VE", "VC", "VN", "VG", "VR", "VQ", "OP"].includes(p)) return "SA";
  if (p1 === "Y" || p1 === "N") return "OCE";
  return "OTHER";
}
export function srAptIn(apts, code) {
  const c = srIcao(code);
  if (!c) return false;
  const r = srRegionOf(c);
  return (apts || []).some((t) => {
    const u = norm(t);
    if (u === "VN" || u === "SEA" || u === "NEA" || u === "SA" || u === "OCE") return r === u;
    if (u === "INTL") return r !== "VN";
    return srIcao(u) === c;
  });
}
function typeMatch(token, ac) {
  const w = norm(token), a = norm(ac);
  if (!w || !a) return false;
  if (w === "A21N" || w.includes("NEO")) return a.includes("A21N") || (a.includes("321") && a.includes("N"));
  if (["A333", "A330", "A332", "330", "333"].includes(w)) return /A33|^33/.test(a);
  if (w === "A320" || w === "320" || w === "A20N") return (a.includes("320") || a.includes("A20N")) && !a.includes("321");
  if (w === "A321" || w === "321") return (a.includes("321") || a.includes("A21")) && !(a.includes("A21N") || a.includes("NEO"));
  return a.includes(w);
}
const regKey = (r) => norm(r).replace(/^VN/, "");
export function srAcMatch(acs, reg, acType, groups, depth) {
  const list = acs || [];
  const neg = list.filter((t) => String(t || "").startsWith("NOT:"));
  if (neg.length) {
    const pos = list.filter((t) => !String(t || "").startsWith("NOT:"));
    if (pos.length && !srAcMatch(pos, reg, acType, groups, depth)) return false;
    return !srAcMatch(neg.map((t) => String(t).slice(4)), reg, acType, groups, depth);
  }
  return list.some((t) => {
    const s = String(t || "");
    if (s === "ALL") return true;
    if (s.startsWith("REG:")) return !!regKey(reg) && regKey(s.slice(4)) === regKey(reg);
    if (s.startsWith("TYPE:")) return typeMatch(s.slice(5), acType);
    if (s.startsWith("GROUP:") && (depth || 0) < 3) {
      const g = (groups || []).find((x) => x && x.name === s.slice(6));
      return !!g && srAcMatch(g.items, reg, acType, groups, (depth || 0) + 1);
    }
    return false;
  });
}
export function srAcLabel(acs) {
  return (acs || []).map((t) => (t === "ALL" ? "Tất cả tàu" : String(t).startsWith("NOT:") ? "trừ " + srAcLabel([String(t).slice(4)]) : String(t).replace(/^(REG|TYPE|GROUP):/, (m) => (m === "GROUP:" ? "nhóm " : "")))).join(", ");
}
export function srAptLabel(apts) {
  return (apts || []).map((t) => { const r = SR_REGIONS.find((x) => x.id === t); return r ? r.label : t; }).join(", ");
}
export function srRuleLabel(id) { const r = SR_RULES.find((x) => x.id === id); return r ? r.label : id; }

// Presentation only: a permitted destination is not an operational warning.
export function srOnlyAircraftDisplay(row, f, groups) {
  if (!row || row.rule !== "ONLY_ACS_APTS") return [];
  const rule = "Chỉ các tàu đã chọn được bay đến sân bay " + srAptLabel(row.apts);
  const permitted = srAcMatch(row.acs, f.reg, f.ac, groups);
  const hits = srEvaluate(row, f, groups);
  const result = hits.map(h => ({kind: "special", check: "special", severity: h.sev,
    text: (f.reg || f.ac || "Tàu") + ": " + (row.note || "Giới hạn tàu được phép"),
    limit: rule, evidence: h.role + " — " + h.text}));
  if (permitted && srAptIn(row.apts, f.dest)) result.push({kind: "special", check: "special", severity: "success",
    text: (f.reg || f.ac) + ": ĐẠT — " + (row.note || "Tàu được phép"),
    limit: rule, evidence: "Được phép bay đến " + srIcao(f.dest)});
  return result;
}

/**
 * f: {reg, ac, dep, dest, alt1, alt2, talt, etops}
 * Trả [{role, sev:"critical"|"warning", text}] — role: DEP|DEST|ALT1|ALT2|TALT
 */
export function srEvaluate(row, f, groups) {
  if (!row || !row.rule) return [];
  const acHit = srAcMatch(row.acs, f.reg, f.ac, groups);
  if (row.rule === "ONLY_ACS_APTS" ? acHit : !acHit) return [];
  const out = [];
  const name = (row.note ? row.note + " — " : "") + srRuleLabel(row.rule);
  const who = (f.reg || f.ac || "Tàu") + ": ";
  const add = (role, sev, why) => out.push({ role, sev, text: who + name + " — " + why });
  const roles = [["DEP", f.dep], ["DEST", f.dest], ["ALT1", f.alt1], ["ALT2", f.alt2], ["TALT", f.talt]].filter((p) => norm(p[1]));
  const at = (r) => roles.filter((p) => r.includes(p[0]));
  const apts = row.apts || [];
  const route = at(["DEP", "DEST"]);
  switch (row.rule) {
    case "DOMESTIC_ONLY": {
      route.forEach(([r, c]) => { if (srRegionOf(c) !== "VN") add(r, "critical", r + " " + c + " không phải sân Việt Nam"); });
      const foreign = (f.firs || []).map(norm).filter((x) => x && !x.startsWith("VV"));
      if (foreign.length) add("FIR " + foreign.join(", "), "critical", "đường bay ATC FPL đi qua FIR nước ngoài " + foreign.join(", "));
      break;
    }
    case "NO_DOMESTIC":
      if (route.length === 2 && route.every(([, c]) => srRegionOf(c) === "VN"))
        route.forEach(([r, c]) => add(r, "critical", "chặng nội địa, " + r + " " + c));
      break;
    case "SEA_ONLY":
      route.forEach(([r, c]) => { const g = srRegionOf(c); if (g !== "VN" && g !== "SEA") add(r, "critical", r + " " + c + " ngoài Đông Nam Á"); });
      break;
    case "ONLY_APTS":
      route.forEach(([r, c]) => { if (!srAptIn(apts, c)) add(r, "critical", r + " " + c + " không nằm trong danh sách cho phép"); });
      break;
    case "ONLY_ACS_APTS": at(["DEST"]).forEach(([r, c]) => { if (srAptIn(apts, c)) add(r, "critical", "tàu không nằm trong danh sách được bay đến " + c); }); break;
    case "NO_OPS_APTS": route.forEach(([r, c]) => { if (srAptIn(apts, c)) add(r, "critical", r + " " + c); }); break;
    case "NO_DEP_APTS": at(["DEP"]).forEach(([r, c]) => { if (srAptIn(apts, c)) add(r, "critical", r + " " + c); }); break;
    case "NO_ARR_APTS": at(["DEST"]).forEach(([r, c]) => { if (srAptIn(apts, c)) add(r, "critical", r + " " + c); }); break;
    case "NO_DEST_ALT": at(["ALT1", "ALT2"]).forEach(([r, c]) => { if (srAptIn(apts, c)) add(r, "critical", c + " được chọn làm " + r); }); break;
    case "NO_TO_ALT": at(["TALT"]).forEach(([r, c]) => { if (srAptIn(apts, c)) add(r, "critical", c + " được chọn làm " + r); }); break;
    case "NO_ANY_ROLE": roles.forEach(([r, c]) => { if (srAptIn(apts, c)) add(r, "critical", c + " xuất hiện ở " + r); }); break;
    case "NO_EDTO": if (f.etops) add("DEP", "critical", "chuyến có EDTO/ETOPS"); break;
    case "NOTE":
      if (!apts.length) add("DEP", "warning", "áp dụng cho tàu này");
      else roles.forEach(([r, c]) => { if (srAptIn(apts, c)) add(r, "warning", r + " " + c); });
      break;
  }
  return out;
}
