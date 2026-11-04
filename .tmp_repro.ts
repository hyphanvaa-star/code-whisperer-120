import { createClient } from '@supabase/supabase-js';
import { handlers } from './src/lib/tool/handlers/excel.server';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const uid = '17a2acd2-ff3e-45d2-90dd-bcd55ff38d4a';
const mk = (route: string, q: string) => ({ request: new Request('http://x/'+route+'?'+q), url: new URL('http://x'+route+'?'+q), params: new URLSearchParams(q), route, userId: uid, supabase: sb as any, json: async () => ({}) });
const base = 'days=1&file=hy2.xlsx';
const cmp: any = await (handlers as any)['GET /api/excel/compare'](mk('/api/excel/compare', base));
if (cmp.error) { console.log('ERR', cmp.error); process.exit(); }
const wanted = ['ĐINH XUÂN THANH','DINH XUAN THANH','BUI T H NHUNG','PHAN THANH HY'];
const rows = cmp.table.filter((r: any) => r.in_excel && wanted.some(w => String(r.dsp||'').toUpperCase().includes(w.split(' ')[0])));
console.log('table', cmp.table.length, 'in_excel rows', rows.length);
for (const r of rows.slice(0,40)) console.log(r.sector_id, r.callsign, r.dsp, r.route);
const ids = rows.map((r: any) => r.sector_id);
const crew: any = await (handlers as any)['GET /api/excel/crew'](mk('/api/excel/crew', base+'&ids='+ids.join(',')));
console.log('crew err', crew.error, 'got', Object.keys(crew.crew||{}).length);
for (const r of rows) console.log(r.callsign, r.dsp, (crew.crew||{})[r.sector_id] ? 'OK' : 'MISSING');
