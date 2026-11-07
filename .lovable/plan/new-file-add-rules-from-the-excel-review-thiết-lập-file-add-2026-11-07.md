# New file-add rules from the Excel review (Thiết lập file add)

All old rules are deleted, including the per-aircraft {REG} notice and TN LOW EGT. They are replaced by the 18 files in the Excel sheet. Each rule matches the departure, destination and alternate airports, except W27/W28/Q9, which keeps its WADD → VVNB route. A rule switches itself off after its end date.

## New rules

| # | File (title on FliteBrief, without extension) | Applies when |
|---|---|---|
| 1 | VVCR_EFF-20261012_TO-20261028_UNTIL_29NOV | Departure, destination or alternate is VVCR; until 29 Nov 2026 |
| 2 | ROUTE-W27-W28-Q9_EFF-20250220_TO-UFN_W27_W28_Q9_NOTE | Route WADD → VVNB |
| 3 | MULTI-SCOPE_EFF-MIXED_TO-MIXED_NOTICE_TO_PILOT_UPDATED_NEW | Every flight (the NEW version, already without VJC/FOP/2025-017 and VJC-FOET-21022026) |
| 4 | FLEET_EFF-20260812_TO-UFN_C-BAND_INTERFERENCE_AND_OPERATIONAL_LIMITATIONS | US (K…), Canada (C…), Australia (Y…) |
| 5 | CHINA_EFF-20260222_TO-UFN_SOP_CHINA | Mainland China (Z…, except ZK/ZM) |
| 6 | CHINA_EFF-REVIEW_TO-REVIEW_usage_on_China_flights | Mainland China |
| 7 | EFF_Standard Taxi Route (STR) | ZSHC |
| 8 | ZSWX_EFF-REVIEW_TO-REVIEW_NOTICE | ZSWX |
| 9 | EDDF_EFF-20261001_TO-20261028_EDDF_NavData_Alert | EDDF |
| 10 | LKPR_EFF-20261005_TO-SUPERSEDE_2023_Deicing_procedures | LKPR |
| 11 | LKPR_EFF-PUB20261029_TO-REVIEW_at_Prague_Airport_-_Introduction_for_new_aircraft_operators | LKPR |
| 12 | ALA-PRG_EFF-REVIEW_TO-REVIEW_LIST_ALA_PRG | UAAA or LKPR |
| 13 | MALAYSIA_EFF-20261017_TO-20271016_Malaysian_FAOC_Renewal_-_2026-2027 | Malaysia (WM…, WB…); until 16 Oct 2027 |
| 14 | RUSSIA_EFF-PUB202608_TO-REVIEW_SM_list_-_AUG.2026 | Russia (UE, UH, UI, UL, UN, UO, UR, US, UU, UW) |
| 15 | RUSSIA_EFF-PUB20260905_TO-REVIEW_and_Safety_Alert_No.8_FOR_RUSSIA_FLT | Russia |
| 16 | UFA_EFF-20260522T1900Z_TO-LIFTED_on_refueling_restrictions_AIRPORT_UFA | UWUU |
| 17 | UWKD_EFF-REVIEW_TO-SUPERSEDE_Information_letter-security_zone | UWKD |
| 18 | RCMQ_EFF-PUB20260117_TO-REVIEW_RMQ_REVIEW-NOEND_RMQ | RCMQ |

Notes:
- The Excel sheet calls the Hangzhou file "ZSHC_…_Taxi_Route_STR". The file in your RAR is named "EFF_Standard Taxi Route (STR)", so the plan uses the RAR name. Tell me if FliteBrief shows a different title.
- The RAR could not be read, but the file names inside it were readable. Rules only need the names, so this is enough.

## What changes for the team
- The team rule list (the admin key) is replaced with the 18 rules above. Each dispatcher's personal rule overrides are cleared too, so everyone uses the new rules.
- The built-in default list becomes the same 18 rules, so a reset never brings the old ones back.

## Technical details
- Add a condition `prefix_touches_alt` to `port/attch.ts`. It matches when departure, destination or either alternate equals one of the ICAO values or starts with one of the 1–2 letter prefixes. Exclusion values start with "!" (e.g. "!ZK", "!ZM").
- Single airports use the existing `touches_or_alt`. Rule 2 keeps `route`. Rule 3 uses `always`. End dates go in `effective_to`, which `activeToday` already respects.
- Replace `defaultRuleData()` and write the new list to app_settings `notice_rules` once, through a migration. Delete the `notice_rules@u:*` rows in the same migration.
- Tests in `port/__tests__/attch_rules.test.ts`:
  - ZGGG alternate → China files attached
  - ZKPY → no China files
  - VVCR after 29 Nov → no file
  - WADD → VVNB → W27 note
  - KLAX → C-band file
- Bump the version.
