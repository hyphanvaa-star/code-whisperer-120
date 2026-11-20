/* Browser-safe helpers for the NOTAM "Add chuyến" bar. Inlined into the tool
   page by the /tool-page shim (export keywords stripped), so keep every
   function self-contained. */
export function nmPinCsKey(raw){
  const blob = String(raw == null ? "" : raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if(!blob) return "";
  if(/^\d+$/.test(blob)) return "VJC" + blob;
  if(blob.indexOf("VJC") === 0) return blob;
  if(blob.indexOf("VJ") === 0 && /^\d+$/.test(blob.slice(2))) return "VJC" + blob.slice(2);
  return blob;
}
/* current: callsign of the flight being tracked ("" when none).
   pinned: callsigns this NOTAM is already pinned to.
   The button/input only ever target the current flight; earlier pins are
   listed separately so they never get re-pinned by accident. */
export function nmPinBarPlan(current, pinned){
  const cur = nmPinCsKey(current);
  const seen = {};
  const list = [];
  for(const cs of pinned || []){
    const k = nmPinCsKey(cs);
    if(!k || seen[k]) continue;
    seen[k] = 1;
    list.push(k);
  }
  const here = !!cur && list.indexOf(cur) >= 0;
  return {
    current: cur,
    pinnedHere: here,
    label: cur ? (here ? "Đã ghim " + cur + " ✓" : "+ Ghim " + cur) : "Add chuyến",
    /* One tap pins the tracked flight directly; the white box is only for
       other flights, so it never comes prefilled. */
    oneTap: !!cur && !here,
    input: "",
    placeholder: cur ? "Gõ số hiệu chuyến khác, ví dụ: 918, 869..." : "918 869 VJC210 …",
    pinned: list
  };
}
