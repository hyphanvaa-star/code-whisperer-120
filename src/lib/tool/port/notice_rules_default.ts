// Team file-add rules from the CFP document review (Nov 2026). Browser-safe.
// Area rules match DEP, DEST or either alternate; "!XX" excludes a prefix.
export interface DefaultNoticeRule {
  name: string;
  condition: "always" | "has_reg" | "route" | "touches_or_alt" | "prefix_touches_alt";
  values: string[];
  files: string[];
  enabled: boolean;
  effective_to?: string;
}

const CHINA = ["Z", "!ZK", "!ZM"];
const RUSSIA = ["UE", "UH", "UI", "UL", "UN", "UO", "UR", "US", "UU", "UW"];

export const NOTICE_RULES_DEFAULT: DefaultNoticeRule[] = [
  { name: "MEL / Notice riêng theo tàu bay", condition: "has_reg", values: [], files: ["{REG}"], enabled: true },
  { name: "VVCR Cam Ranh (đến 29NOV)", condition: "touches_or_alt", values: ["VVCR"], files: ["VVCR_EFF-20261012_TO-20261028_UNTIL_29NOV"], enabled: true, effective_to: "2026-11-29" },
  { name: "Airways W27/W28/Q9 (WADD → VVNB)", condition: "route", values: ["WADD", "VVNB"], files: ["ROUTE-W27-W28-Q9_EFF-20250220_TO-UFN_W27_W28_Q9_NOTE"], enabled: true },
  { name: "Notice to Pilot chung", condition: "always", values: [], files: ["MULTI-SCOPE_EFF-MIXED_TO-MIXED_NOTICE_TO_PILOT_UPDATED_NEW"], enabled: true },
  { name: "5G C-Band (US / Canada / Australia)", condition: "prefix_touches_alt", values: ["K", "C", "Y"], files: ["FLEET_EFF-20260812_TO-UFN_C-BAND_INTERFERENCE_AND_OPERATIONAL_LIMITATIONS"], enabled: true },
  { name: "China SOP + APU", condition: "prefix_touches_alt", values: CHINA, files: ["CHINA_EFF-20260222_TO-UFN_SOP_CHINA", "CHINA_EFF-REVIEW_TO-REVIEW_usage_on_China_flights"], enabled: true },
  { name: "ZSHC Standard Taxi Route", condition: "touches_or_alt", values: ["ZSHC"], files: ["EFF_Standard Taxi Route (STR)"], enabled: true },
  { name: "ZSWX Notice", condition: "touches_or_alt", values: ["ZSWX"], files: ["ZSWX_EFF-REVIEW_TO-REVIEW_NOTICE"], enabled: true },
  { name: "EDDF NavData Alert", condition: "touches_or_alt", values: ["EDDF"], files: ["EDDF_EFF-20261001_TO-20261028_EDDF_NavData_Alert"], enabled: true },
  { name: "LKPR Prague", condition: "touches_or_alt", values: ["LKPR"], files: ["LKPR_EFF-20261005_TO-SUPERSEDE_2023_Deicing_procedures", "LKPR_EFF-PUB20261029_TO-REVIEW_at_Prague_Airport_-_Introduction_for_new_aircraft_operators"], enabled: true },
  { name: "ALA / PRG station contact", condition: "touches_or_alt", values: ["UAAA", "LKPR"], files: ["ALA-PRG_EFF-REVIEW_TO-REVIEW_LIST_ALA_PRG"], enabled: true },
  { name: "Malaysia FAOC (đến 16OCT2027)", condition: "prefix_touches_alt", values: ["WM", "WB"], files: ["MALAYSIA_EFF-20261017_TO-20271016_Malaysian_FAOC_Renewal_-_2026-2027"], enabled: true, effective_to: "2027-10-16" },
  { name: "Russia SM list + Safety Alert", condition: "prefix_touches_alt", values: RUSSIA, files: ["RUSSIA_EFF-PUB202608_TO-REVIEW_SM_list_-_AUG.2026", "RUSSIA_EFF-PUB20260905_TO-REVIEW_and_Safety_Alert_No.8_FOR_RUSSIA_FLT"], enabled: true },
  { name: "UFA refueling", condition: "touches_or_alt", values: ["UWUU"], files: ["UFA_EFF-20260522T1900Z_TO-LIFTED_on_refueling_restrictions_AIRPORT_UFA"], enabled: true },
  { name: "UWKD security zone", condition: "touches_or_alt", values: ["UWKD"], files: ["UWKD_EFF-REVIEW_TO-SUPERSEDE_Information_letter-security_zone"], enabled: true },
  { name: "RCMQ push back", condition: "touches_or_alt", values: ["RCMQ"], files: ["RCMQ_EFF-PUB20260117_TO-REVIEW_RMQ_REVIEW-NOEND_RMQ"], enabled: true },
];

/** Airport matches ICAO values or 1–2 letter prefixes; "!XX" excludes. */
export function prefixTouchesAlt(values: string[], airports: string[]): boolean {
  const v = values.map((x) => String(x).toUpperCase().trim()).filter(Boolean);
  const neg = v.filter((x) => x.startsWith("!")).map((x) => x.slice(1));
  const pos = v.filter((x) => !x.startsWith("!"));
  return airports.map((a) => String(a || "").toUpperCase().trim()).filter(Boolean).some((a) => {
    if (neg.some((n) => a.startsWith(n))) return false;
    return pos.some((p) => (p.length === 4 ? a === p : p.length <= 2 && a.startsWith(p)));
  });
}
