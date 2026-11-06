import styles from '@/styles.css?raw';

export function patchDefectSourcePage(html: string): string {
  const tokens = (styles.match(/^  --defect-(?:summary|manual)-ink:[^\n]+/gm) ?? []).join('\n');
  return html.replace('    const enter = () => limAddAc(true);', `    const paintSource = () => {
      tr.dataset.defectSource = row.source === "summary" ? "summary" : "manual";
      tr.title = row.source === "summary" ? "Nguồn: Defect summary" : "Nguồn: Người dùng nhập";
    };
    paintSource();
    const manualEdit = (field, value) => {
      row[field] = value;
      row.source = "manual";
      paintSource();
      limTouch();
    };
    const enter = () => limAddAc(true);`)
    .replace('v => { limData.aircraft[i].reg = v; limTouch(); }', 'v => manualEdit("reg", v)')
    .replace('v => { limData.aircraft[i].defect = v; limTouch(); }', 'v => manualEdit("defect", v)')
    .replace('v => { limData.aircraft[i].limit = v; limTouch(); }', 'v => manualEdit("limit", v)')
    .replace('    const r = await fetch("/api/defect/summary", {', `    clearTimeout(limSaveTimer);
    if(limDirty && !await limSaveNow({quiet: true})) return false;
    const r = await fetch("/api/defect/summary", {`)
    .replace('</head>', `<style>:root{${tokens}}
#limAcBody tr[data-defect-source="summary"] input,#limAcBody tr[data-defect-source="summary"] textarea{color:var(--defect-summary-ink)!important}
#limAcBody tr[data-defect-source="manual"] input,#limAcBody tr[data-defect-source="manual"] textarea{color:var(--defect-manual-ink)!important}
</style></head>`);
}