/** Browser-safe: start the Compare read as soon as a filter changes instead of
 *  after the main board and the 2-day catalogue finish loading. */

/** True when a fast Compare read already started for this exact scope within ttl; consumes it. */
export function cmpFastClaim(starts: Map<string, number>, scope: string, now: number, ttlMs = 60000): boolean {
  const at = starts.get(scope);
  if (at === undefined) return false;
  starts.delete(scope);
  return now - at >= 0 && now - at <= ttlMs;
}

const must = (html: string, from: string, to: string): string => {
  if (!html.includes(from)) throw new Error('cmp_dsp_fast: anchor missing: ' + from.slice(0, 60));
  return html.replace(from, to);
};

export function patchCmpDspFastPage(html: string): string {
  let out = must(html, 'async function loadFlights(refresh, quiet){', `const cmpFastClaim = ${cmpFastClaim.toString()};
const cmpFastStarts = new Map();
function cmpFastStart(){
  if(!xls) return;
  const scope = qs();
  cmpFastStarts.clear();
  cmpFastStarts.set(scope, Date.now());
  lastCmp = null;
  runCompare();
}
async function loadFlights(refresh, quiet){`);
  out = must(out, `    lastCmp = null;
    if(xls){
      estStartAuto();
      runCompare({freshOfp: grantOfp});
    }`, `    if(xls){
      estStartAuto();
      if(grantOfp || !cmpFastClaim(cmpFastStarts, qs(), Date.now())){ lastCmp = null; runCompare({freshOfp: grantOfp}); }
    } else lastCmp = null;`);
  out = must(out, '$("#fDispatcher").onchange = () => { markDspSelect(); loadFlights(false); };',
    '$("#fDispatcher").onchange = () => { markDspSelect(); cmpFastStart(); loadFlights(false); };');
  out = must(out, 'debounce = setTimeout(() => loadFlights(false), 220);',
    'debounce = setTimeout(() => { cmpFastStart(); loadFlights(false); }, 220);');
  out = must(out, '$("#fWindow").onchange = async () => {\n  await loadFlights(false);',
    '$("#fWindow").onchange = async () => {\n  cmpFastStart();\n  await loadFlights(false);');
  return out;
}
