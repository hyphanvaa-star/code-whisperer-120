/** A draft is data, never an executable UI object or a source for operational matching. */
export type KhbWorkspace = {
  rows: (Record<string, unknown> | null)[];
  edit: Record<string, unknown>;
  blank: Record<string, unknown>;
  dsp: string;
  efb: string;
  pld: boolean;
  extra: string;
  seq: string;
};

/** Self-contained so the isolated tool document uses exactly the same validation. */
export function normalizeKhbWorkspace(input: unknown): KhbWorkspace | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value['rows']) || value['rows'].length > 1000) return null;
  const safe = (v: unknown, depth = 0): unknown => {
    if (depth > 12) return null;
    if (v == null || typeof v === 'boolean') return v ?? null;
    if (typeof v === 'string') return v.slice(0, 20000);
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (Array.isArray(v)) return v.slice(0, 1000).map(x => safe(x, depth + 1));
    if (typeof v !== 'object') return null;
    const obj = v as Record<string, unknown>;
    if (typeof obj['nodeType'] === 'number') return null;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) {
      if (['__proto__', 'prototype', 'constructor', 'bolt', 'busy', 'el'].includes(key) || typeof item === 'function') continue;
      out[key] = safe(item, depth + 1);
    }
    return out;
  };
  const rows = value['rows'].map(row => row && typeof row === 'object' && !Array.isArray(row)
    ? safe(row) as Record<string, unknown> : null);
  const edit: Record<string, unknown> = {};
  const sourceEdit = value['edit'] && typeof value['edit'] === 'object' ? value['edit'] as Record<string, unknown> : {};
  for (const row of rows) {
    const id = row?.['id'];
    if ((typeof id === 'string' || typeof id === 'number') && Object.hasOwn(sourceEdit, String(id))) edit[String(id)] = safe(sourceEdit[String(id)]);
  }
  const blank: Record<string, unknown> = {};
  const sourceBlank = value['blank'] && typeof value['blank'] === 'object' ? value['blank'] as Record<string, unknown> : {};
  for (const [index, row] of Object.entries(sourceBlank)) {
    if (!/^\d{1,4}$/.test(index) || Number(index) >= 1000 || rows[Number(index)] || !row || typeof row !== 'object') continue;
    // Rendering creates thirty default blank rows; those are not user data.
    if (Object.entries(row).some(([key, v]) => !['rteAuto'].includes(key) && typeof v === 'string' && v.trim() && !(key === 'extra' && v === '0') && !(key === 'rte' && v === '1'))) blank[index] = safe(row);
  }
  const text = (key: string) => typeof value[key] === 'string' ? (value[key] as string).slice(0, 2000) : '';
  const state = { rows, edit, blank, dsp: text('dsp'), efb: text('efb'), pld: value['pld'] === true, extra: text('extra'), seq: text('seq') };
  return JSON.stringify(state).length <= 1500000 ? state : null;
}