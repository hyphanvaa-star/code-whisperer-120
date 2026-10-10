// Pure port of notam_check.verdict_of and notam_track.fleet_verdict.
import type { Flight } from '../core/models';
import type { Chart } from './aip_vn_chart';
import { bcOk, buildTuneCtx, closedRwysOf, isExerciseArea, isFireArea, isProhibitedArea, ofpNamedHits, pairRwyLabels, placeWindow, rwyInFlightWin, rwyRoleOf, sidStarHitsOf } from './notam_check_tune';

type N = Record<string, unknown>;
export type VerdictRow = { label: string; value: string; ident?: string; icao?: string; hit?: boolean };
export type VerdictSection = { key: string; title?: string; answer?: string; hit: boolean; rows?: VerdictRow[]; groups?: { title: string; id?: string; rows: VerdictRow[] }[] };
export type Verdict = { status: string; sections: VerdictSection[]; callsign?: string; tracked?: boolean; items?: N[] };
export type FleetItem = { id?: number; cs: string; dep: string; dest: string; hit_count?: number; verdict?: Verdict };
const arr = (v: unknown): N[] => Array.isArray(v) ? v.filter((x): x is N => !!x && typeof x === 'object') : [];
const str = (v: unknown) => String(v ?? '');
const blob = (n: N) => ['subject','condition','e_field','text','summary'].map(k => str(n[k])).join(' ').toUpperCase();
function q(raw: unknown) { const s = str(raw).replace(/[^A-Z]/gi,'').toUpperCase().replace(/^Q/,''); return s.length === 2 ? s : s.length === 4 ? s.slice(0,2) : ''; }
function phrase(b: string, p: string) { return /[^A-Z0-9]/.test(p) ? b.includes(p) : new RegExp(`(?<![A-Z0-9])${p}(?![A-Z0-9])`).test(b); }
export function classifyEffect(n: N, p: N = {}): string[] {
  const kind = str(p.kind || n.kind).toUpperCase(), subj = q(n.qsubj) || q(n.subject), cond = q(n.qcond) || q(n.condition), b = blob(n), tags: string[] = [];
  const closed = ['LC','CA','AJ'].includes(cond);
  if (['','A','APT'].includes(kind)) {
    const rw = subj === 'MR' || /\b(?:RWY|RUNWAY)\b.{0,24}\b(?:CLSD|CLOSED)\b/i.test(b);
    const ad = (subj === 'FA' && closed) || ['AD CLSD','AD CLOSED','AERODROME CLOSED','AERODROME CLSD','AIRPORT CLOSED','APT CLSD','CLOSED TO ALL ACFT','AD NOT AVBL','AERODROME NOT AVBL','DISCONTINUATION OF RECEIVING'].some(p => phrase(b,p));
    if (ad && subj !== 'MR') tags.push('ad_closed');
    if (rw && (closed || b.includes('CLSD') || b.includes('CLOSED'))) tags.push('rwy_closed');
  }
  if (subj === 'WM' || ['GUN FIR','LIVE FIR','ARTILLERY','FIRING RANGE','WEAPON FIR','ROCKET FIR','GUNNERY','FRNG EXER','LIVE AMMUNITION','SHELLING'].some(p => phrase(b,p))) tags.push('fire');
  if (['RD','WM','WR','RA','RM','RP','RO','RR','RT'].includes(subj) || isFireArea(n) || isProhibitedArea(n) || isExerciseArea(n)) tags.push('restrict');
  if (['AN','AR','AX','AT'].includes(subj) || ['ATS RTE','ATS ROUTE','RNAV RTE','RNAV ROUTE','CDR ARE ESTABLISHED','CDR ESTABLISHED','RE-ROUTE','REROUTE','RTE NOT AVBL','AWY NOT AVBL','AIRWAY NOT AVBL','DCT NOT AVBL','ROUTE CLOSED','RTE CLSD','AWY CLSD'].some(p => phrase(b,p))) tags.push('route');
  if (subj === 'GW' || ['GPS','GNSS','RAIM','SBAS','GBAS','WAAS','EGNOS','GLONASS','GALILEO'].some(p => phrase(b,p)) || /BEIDOU.{0,40}(?:SATELLITE|NAVIGATION|SIGNAL|GNSS|GPS|BDS|OUTAGE|UNRELIABLE|RAIM)|(?:SATELLITE|NAVIGATION|SIGNAL|GNSS|GPS|BDS|OUTAGE|UNRELIABLE|RAIM).{0,40}BEIDOU/.test(b)) tags.push('gps');
  if (subj === 'FF' || ['RFFS','RFF','FIRE FIGHTING AND RESCUE','FIREFIGHTING SERVICE','RESCUE AND FIRE'].some(p => phrase(b,p))) tags.push('rffs');
  if (!tags.some(t => ['ad_closed','rwy_closed','fire','restrict','route'].includes(t)) && ['EXTRA FUEL','ADDITIONAL FUEL','MORE FUEL','HOLDING FUEL','FUEL FOR HOLDING','FUEL FOR AIRBORNE HOLDING','TAKE MORE FUEL'].some(p => phrase(b,p))) tags.push('note');
  return tags;
}
function near(h: N, limit: number) {
  if (['ref','dot'].includes(str(h.impact)) || h.shape === 'dot' || h.dist_nm == null || h.dist_nm === '') return false;
  const d = Number(h.dist_nm); return Number.isFinite(d) && d <= limit;
}
export const hitCutsArea = (h: N) => near(h, 0.05);
export const hitOnRoute = (h: N) => near(h, 10);
const awyKey = (v: unknown) => str(v).toUpperCase().replace(/\s/g,'');
const nm = (a: number[], b: number[]) => Math.hypot((b[0]-a[0])*60, (b[1]-a[1])*60*Math.cos((a[0]+b[0])*Math.PI/360));
export function awySegmentAffects(n: N, points?: N[], chart?: Chart | null): boolean {
  if (points == null) return true;
  const b = `${str(n.e_field)}\n${str(n.text)}`.toUpperCase();
  const limits = [...b.matchAll(/\b([A-Z]{1,2}\d{1,4})\s*:\s*([A-Z]{2,5})\s*[-–]\s*([A-Z]{2,5})\b/g)].map(m => [m[1],m[2],m[3]]);
  for (const m of b.matchAll(/(?:^|\n)\s*-?\s*([A-Z]{1,2}\d{1,4})\s*(?=\n|$)/g)) limits.push([m[1],'','']);
  if (!limits.length) return true;
  const pool = [...(chart?.waypoints || []), ...(chart?.navaids || [])];
  for (const [awy,start,end] of limits) {
    const ours = points.filter(p => awyKey(p.airway) === awy);
    if (!start || !end) { if (ours.length) return true; continue; }
    const r = chart?.routes.find(r => awyKey(r.name) === awy);
    const seq = (r?.pts || []).map((pt,i) => ({ pt, name: r?.fixes?.[i] || pool.reduce((best,w) => nm(pt,[w.lat,w.lon]) < best.d ? {d:nm(pt,[w.lat,w.lon]),name:w.id} : best,{d:2.5,name:''}).name }));
    const at = (name: string) => {
      const idx = seq.findIndex(p => p.name === name); if (idx >= 0) return idx;
      const xy = pool.find(w => w.id === name); if (!xy) return -1;
      return closest([xy.lat,xy.lon]);
    };
    const closest = (pt: number[]) => { let idx = -1, best = 12; seq.forEach((p,i) => { const d = nm(pt,p.pt); if(d < best) {idx=i;best=d;} }); return idx; };
    const a = at(start), z = at(end);
    if (a < 0 || z < 0) { if (ours.some(p => [start,end].includes(str(p.name).toUpperCase()))) return true; continue; }
    const lo = Math.min(a,z), hi = Math.max(a,z);
    if (ours.some(p => { const name = str(p.name).toUpperCase(); if(seq.slice(lo,hi+1).some(s => s.name && s.name === name)) return true; const idx = closest([Number(p.lat),Number(p.lon)]); return idx >= lo && idx <= hi; })) return true;
  }
  return false;
}
const row = (label: string, value: string, ident = value, icao = label): VerdictRow => ({ label,value,ident,icao:icao.toUpperCase(),hit:true });
const ORDER = ['ad','rwy','area','ats','sidstar','gps','rffs','note'];
const TITLES = ['Sân bay','Đường băng (RWY)','Vùng hạn chế','ATS Route','SID / STAR','GPS / GNSS','RFFS','Ghi chú'];
const answer = (key: string, yes: boolean) => key === 'ad' ? `${yes?'có':'không có'} đóng cửa sân bay` : key === 'rwy' ? `${yes?'có':'không có'} đóng cửa rwy` : `${yes?'có':'không'} ảnh hưởng`;
function uniq(rows: VerdictRow[]): VerdictRow[] { const seen = new Set<string>(); return rows.filter(r => { const k=JSON.stringify([str(r.icao).toUpperCase(),r.ident,r.value,r.label]); if(seen.has(k)) return false; seen.add(k); return true; }); }
export function verdictOf(places: N[], flight: Flight, hits: N[], ofpText = '', points: N[] = [], chart?: Chart | null): Verdict {
  const cs = str(flight.callsign).trim().toUpperCase(), ctx = buildTuneCtx(flight,ofpText), tokens = ctx.tokens as Set<string>;
  const found: (N & { tags: string[]; ident: string; icao: string; kind: string; area: string })[] = [], ofp: typeof found = [], sid: VerdictRow[] = [];
  for (const p of places) {
    const uses = arr(p.uses); if(cs && uses.length && !uses.some(u => str(u.cs).trim().toUpperCase() === cs)) continue;
    const role = str(uses.find(u => str(u.cs).trim().toUpperCase() === cs)?.role || (ctx.roles as Record<string,string>)[str(p.code)]);
    for (const n of arr(p.notams)) {
      let tags = classifyEffect(n,p);
      if(tags.includes('ad_closed') && !bcOk(n,...placeWindow(p,ctx))) tags=tags.filter(t=>t!=='ad_closed');
      if(tags.includes('rwy_closed') && !rwyInFlightWin(n,rwyRoleOf(role,p,ctx),ctx)) tags=tags.filter(t=>t!=='rwy_closed');
      const base = {ident:str(n.ident),icao:str(p.code||n.icao),kind:str(p.kind),role,area:''};
      const named = tokens.size && awySegmentAffects(n,points,chart) ? ofpNamedHits(n,tokens) : [];
      if(named.length) ofp.push({...base,tags:['ofp'],area:named.join('/')});
      let sh = arr(n.sid_star_hits).filter(h => !cs || str(h.cs).trim().toUpperCase() === cs);
      if(!sh.length && ofpText) { let procs = sidStarHitsOf(n,ofpText,tokens); if(['DEP','ARR'].includes(role) && !rwyInFlightWin(n,role,ctx)) procs=[]; if(procs.length) sh=[{cs,procs,role}]; }
      for(const h of sh) { const procs=Array.isArray(h.procs)?h.procs.filter(Boolean).join('/'):''; if(procs&&base.ident) sid.push(row([str(h.cs||cs),procs].filter(Boolean).join(' ')||base.icao,base.ident,base.ident,base.icao)); }
      if(tags.length) found.push({...base,tags,closed:pairRwyLabels(closedRwysOf(n)),rffs_cat:blob(n).match(/\bCAT(?:EGORY)?\s*(\d{1,2})\b/)?.[1] || ''});
    }
  }
  const tagged = (tag: string) => found.filter(r=>r.tags.includes(tag));
  const ad=tagged('ad_closed').filter(r=>r.kind==='A'), rwy=tagged('rwy_closed').filter(r=>r.kind==='A');
  const area: typeof found = [], route: typeof found = [];
  for(const h of hits) { const tags=classifyEffect(h,{kind:h.kind,code:h.icao}); const r={ident:str(h.ident),icao:str(h.icao),kind:str(h.kind),area:str(h.area),tags}; if(hitCutsArea(h)&&tags.some(t=>['restrict','fire'].includes(t))) area.push(r); if(hitOnRoute(h)&&tags.includes('route')&&awySegmentAffects(h,points,chart)) route.push(r); }
  const rwyBy = new Map<string,VerdictRow>(); for(const r of rwy) if(!rwyBy.has(r.icao)) rwyBy.set(r.icao,row(r.icao,(r.closed as string[]).join(', ')||'?',r.ident,r.icao));
  const ats = new Map<string,{labs:string[];icao:string}>();
  for(const r of [...ofp,...route]) { if(!r.ident) continue; const held=ats.get(r.ident)||{labs:[],icao:r.icao}; const labs=r.area.toUpperCase().split(/[/,]+/).map(s=>s.trim()).filter(s=>s && (/^[A-Z]{1,2}\d{1,4}[A-Z]?$/.test(s)||/^[A-Z]{5}$/.test(s)||!(/^[A-Z]{3,4}-?\d{1,4}[A-Z]?$|^[A-Z]-\d{1,4}[A-Z]?$/.test(s)))); for(const l of labs.length?labs:held.labs.length?[]:[r.icao]) if(l&&!held.labs.includes(l)) held.labs.push(l); ats.set(r.ident,held); }
  const used=new Set([...ad,...rwy,...area,...route,...ofp].map(r=>r.ident).concat(sid.map(r=>str(r.ident))));
  const rows: Record<string,VerdictRow[]> = {
    ad:ad.map(r=>row(r.icao,r.ident)),rwy:[...rwyBy.values()],area:[],ats:[...ats].map(([id,r])=>row(r.labs.join('-')||r.icao||'—',id,id,r.icao)),sidstar:uniq(sid),
    gps:uniq(tagged('gps').map(r=>row(r.icao,r.ident))),rffs:uniq(tagged('rffs').map(r=>row([r.icao,r.rffs_cat?'CAT '+r.rffs_cat:''].filter(Boolean).join(' '),r.ident,r.ident,r.icao))),note:tagged('note').filter(r=>r.ident&&!used.has(r.ident)).map(r=>row(r.icao,r.ident))
  };
  const groups = ['FIR','Sân bay'].map(title=>({title,rows:uniq(area.filter(r=>(r.kind==='FIR')===(title==='FIR')).map(r=>row(r.icao||'—',r.ident,r.ident,r.icao)))})).filter(g=>g.rows.length);
  const sections=ORDER.map((key,i)=>({key,title:TITLES[i],answer:answer(key,key==='area'?area.length>0:rows[key].length>0),hit:key==='area'?area.length>0:rows[key].length>0,...(key==='area'?{groups}:{rows:rows[key]})}));
  const status=ad.length||area.length||route.length||ofp.length||sid.length?'risk':rwy.length?'wait':'clear';
  return {callsign:cs,tracked:true,status,sections,items:[...ad,...rwy,...area,...route,...ofp]};
}
export function fleetVerdict(items: FleetItem[]) {
  const rows: Record<string,VerdictRow[]> = Object.fromEntries(ORDER.map(k=>[k,[]]));
  const flags: Record<string,boolean> = Object.fromEntries(ORDER.map(k=>[k,false]));
  const ats=new Map<string,{id:string;rows:VerdictRow[]}>(), gps=new Map<string,VerdictRow[]>();
  for(const it of items) {
    const prefix=[it.cs.trim(),(it.dep||it.dest)?`${it.dep}–${it.dest}`:''].filter(Boolean).join(' ');
    for(const sec of it.verdict?.sections || []) {
      const key=sec.key; if(!(key in rows)||!sec.hit) continue; flags[key]=true;
      if(key==='ats') { const title=prefix||'—', held=ats.get(title)||{id:String(it.id||''),rows:[]}; held.rows=uniq([...held.rows,...(sec.rows||[]),...(sec.groups||[]).flatMap(g=>g.rows)]); ats.set(title,held); continue; }
      if(key==='gps') { for(const r of sec.rows||[]) {const place=str(r.icao||r.label).trim().toUpperCase()||'—'; gps.set(place,uniq([...(gps.get(place)||[]),{...r,label:'',icao:place==='—'?str(r.icao):place}]));} continue; }
      for(const g of [{title:'',rows:sec.rows||[]},...(sec.groups||[])]) {
        const pre=[prefix,g.title].filter(Boolean).join('  ');
        const add=['ad','rwy'].includes(key)?g.rows:g.rows.map(r=>({...r,label:[pre,r.label||r.value].filter(Boolean).join('  ').trim()}));
        rows[key].push(...add); if(['ad','rwy'].includes(key)) rows[key]=uniq(rows[key]);
      }
    }
  }
  const sections: VerdictSection[]=ORDER.map((key,i)=>({key,title:TITLES[i],answer:answer(key,flags[key]),hit:flags[key],rows:rows[key],...(key==='ats'?{groups:[...ats].filter(([,g])=>g.rows.length).map(([title,g])=>({title:title+':',id:g.id,rows:g.rows}))}:key==='gps'?{groups:[...gps].filter(([,rs])=>rs.length).map(([title,rs])=>({title,rows:rs}))}:{})}));
  const risk=items.filter(it=>it.verdict?.status==='risk').length;
  const bits=[`${items.length} chuyến quốc nội`]; for(const [key,text] of [['rwy','có RWY đóng'],['ats','có ATS'],['sidstar','có SID/STAR'],['gps','có GPS'],['rffs','có RFFS'],['area','có vùng hạn chế']]) if(flags[key]) bits.push(text);
  if(risk) bits.push(`${risk} chuyến dính`);
  return {status:risk||Object.values(flags).some(Boolean)?'risk':'clear',headline:bits.join(' · '),sections,flights:items.length,risk};
}
