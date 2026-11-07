# Batch actions in the Compare tab (Dữ liệu so sánh)

## What you will see
- Each action column header gets a small button that shows how many cells are waiting, e.g. "Đổi tất cả (3)":
  - CREW: change crew
  - REG AIMS / REG FPL: change aircraft
  - REQ (CFP): download the REQ files
  - ĐIỆN VĂN: export CHG
  - VERIFY: verify the red triangles
  - ĐỔI BRIEFING: rebuild and attach the BF
- The button is greyed out when there are 0 waiting cells. It only counts flights inside the current DSP filter (including handed-over DSPs) and the −6/+24h window.
- When you press it, one confirmation list opens. It shows each flight with callsign, route, date and change (e.g. VN-A543 → VN-A629, FO A → B). Every flight has a tick so you can skip one. Then press "Đồng ý".
- Flights run one after another, with a progress bar ("2/3 đang chạy…"). Each cell turns green or red, just as if you had clicked it yourself. If one flight fails, the rest keep going. At the end, a summary shows which flights succeeded and which failed, and why.

## Safety rules (unchanged from single clicks)
- Each flight goes through the same checks as clicking it by hand: correct flight/date/route, fresh FliteBrief data, and evidence from the Crewlist/FPL VER. A flight that fails a check is skipped, never guessed.
- Only one batch can run at a time. Background refreshes do not stop or repeat a batch.
- REQ files download one by one. CHG files bundle all chosen flights into one file, like the existing CHG/DLA export.

## Technical details
- New browser-safe module `src/lib/tool/port/cmp_batch.ts`, injected through the tool-page shim:
  - Collect pending cells per column from the existing action buttons already in each row. Use the live catalogue sector identity only, never row indexes.
  - Run sequentially by calling the existing per-cell handlers (crew/reg sync, `vReqCell`/chgreq, CHG export, `csQuickVerify`, BF rebuild) and awaiting each one.
  - Header button, confirmation modal and progress bar use the existing tool styles.
- Repaint only the rows each run touched. Rows are matched by sector identity.
- Tests in `port/__tests__/cmp_batch.test.ts`: pending selection respects the DSP filter and the time window, unticked flights are skipped, one failure does not stop the rest.
- Bump the version.
