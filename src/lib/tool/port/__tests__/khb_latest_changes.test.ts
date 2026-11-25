import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { patchKhbCrewSyncPage } from '../khb_crew_sync';

const html = patchKhbCrewSyncPage(readFileSync('src/tool/page.html', 'utf8'));
const start = html.indexOf('function ftApplyCrewDiff(');
const script = html.slice(start, html.indexOf('function ftChgClass(', start));
const route = readFileSync('src/routes/tool-page.ts', 'utf8');
const remapStart = route.indexOf('function ftRemap(snap){');
const remapScript = route.slice(remapStart, route.indexOf('function ftCrewChanged(){', remapStart));

function refreshRegistration(flt: string, dep: string, arr: string, editReg = 'VN-A580') {
  const old = {id: 100, flt, date: '06/11/26', dep, arr, etd: flt === '362' ? '18:15' : '19:40', reg: 'VN-A580'};
  const fresh = {...old, id: 575, reg: 'VN-A683'};
  const state = {...old, reg: editReg, extra: '45', pay: '20000'};
  const context = {ftRows: [old], ftCatalog: [fresh], ftEdit: {'100': state} as Record<string, typeof state>,
    ftCrewChanges: {source: 'hy3.xlsx', pair: 'hy2|hy3', rows: []},
    ftSt: (f: {id: number}) => context.ftEdit[String(f.id)],
    ftFillIdent: (st: object, f: object) => Object.assign(st, f), FT_CHG_KEYS: [['reg', 'reg']]};
  runInNewContext(remapScript + script + ';ftRemap([{f: ftRows[0], edit: ftEdit[100]}]);ftApplyCrewDiff("hy3.xlsx");', context);
  return {state: context.ftEdit['575'], flight: context.ftRows[0]};
}

describe('VJ362/363 new Crewlist after KHB remap', () => {
  it.each([['362', 'SGN', 'DLI'], ['363', 'DLI', 'SGN']])('%s updates the saved VN-A580 to Crewlist VN-A683', (flt, dep, arr) => {
    const result = refreshRegistration(flt, dep, arr);
    expect(result.state.reg).toBe('VN-A683');
    expect(result.flight.reg).toBe('VN-A683');
    expect(result.state.extra).toBe('45');
    expect(result.state.pay).toBe('20000');
  });
});

function apply(rows: unknown[], oldChange: Record<string, unknown> = {}, edits = {}) {
  const flight = { id: 717, flt: '717', date: '05/11/26', dep: 'DAD', arr: 'PQC', reg: 'VN-A580', etd: '10:50', utc: '03:50', cpt: '15399 NEW CAPT', fo: '7390 NEW FO' };
  const state = { ...flight, cptText: flight.cpt, foText: flight.fo, src: 'hy4.xlsx', chg: oldChange, chgFb: true, regFb: true, ...edits };
  const context = { ftRows: [flight], ftCatalog: [flight], ftEdit: { '717': state }, ftSt: () => state,
    ftCrewChanges: { source: 'hy4.xlsx', pair: 'hy3.xlsx|hy4.xlsx', rows },
    ftFillIdent: (st: object, f: object) => Object.assign(st, f), FT_CHG_KEYS: [['reg', 'reg'], ['etd', 'etd'], ['cptText', 'cpt'], ['foText', 'fo']] };
  const count = runInNewContext(script + ';ftApplyCrewDiff("hy4.xlsx")', context);
  return { count, state };
}

describe('KHB latest Crewlist comparison', () => {
  it('keeps completed green cells when the next Crewlist pair is stable until explicit Ack', () => {
    const result = apply([], {reg: {from: 'VN-A648', to: 'VN-A580', done: true}, cptText: {from: '0859 OLD', to: '15399 NEW CAPT', fbOk: true}, etd: {from: '09:50', to: '10:50', src: 'both', fbOk: true}});
    expect(Object.keys(result.state.chg)).toEqual(['reg', 'cptText', 'etd']);
    expect(result.state.chg).toMatchObject({reg:{done:true},cptText:{fbOk:true},etd:{fbOk:true}});
    expect(result.count).toBe(3);
    expect(result.state.reg).toBe('VN-A580');
  });
  it('highlights only a new aircraft change and does not inherit an earlier green verdict', () => {
    const result = apply([{flt: '717', route: 'DAD-PQC', day_new: '05/11', reg: {changed: true, old: 'VN-A648', new: 'VN-A580'}}], {reg: {from: 'VN-A677', to: 'VN-A648', done: true}});
    expect(result.count).toBe(1);
    expect(result.state.chg.reg).toMatchObject({from: 'VN-A648', to: 'VN-A580', src: 'crew'});
    expect(result.state.chg.reg).not.toHaveProperty('done', true);
    expect(result.state.chgFb).toBe(false);
  });
  it('preserves manual edits when merely clearing previous highlights', () => {
    const result = apply([], {}, {reg: 'VN-A554', cptText: '9999 MANUAL CAPT', extra: '45', pay: '16000'});
    expect(result.state).toMatchObject({reg: 'VN-A554', cptText: '9999 MANUAL CAPT', extra: '45', pay: '16000'});
  });
  it('repairs the old saved aircraft when the row already holds the new source', () => {
    const result = apply([{flt: '717', route: 'DAD-PQC', day_new: '05/11', reg: {changed: true, old: 'VN-A648', new: 'VN-A580'}}], {}, {reg: 'VN-A648'});
    expect(result.state.reg).toBe('VN-A580');
  });
  it('does not replace an unrelated manual aircraft with latest change evidence', () => {
    const result = apply([{flt: '717', route: 'DAD-PQC', day_new: '05/11', reg: {changed: true, old: 'VN-A648', new: 'VN-A580'}}], {}, {reg: 'VN-A554'});
    expect(result.state.reg).toBe('VN-A554');
  });
  it('never uses a same-number change from a different date or route', () => {
    const result = apply([{flt: '717', route: 'DAD-PQC', day_new: '04/11', reg: {changed: true, old: 'VN-A648', new: 'VN-A580'}}, {flt: '717', route: 'HAN-PQC', day_new: '05/11', reg: {changed: true, old: 'VN-A648', new: 'VN-A580'}}]);
    expect(result.count).toBe(0);
  });
  it.each(['crew', 'both', 'fpl'])('keeps unresolved %s markers through an unchanged new Crewlist', src => {
    const pending = {from: 'VN-A648', to: 'VN-A580', src};
    const result = apply([], {reg: pending}, {chgFb: false, regFb: false});
    expect(result.count).toBe(1);
    expect(result.state.chg.reg).toMatchObject(pending);
  });
  it('keeps pending CPT/FO even when aircraft and time already match', () => {
    const result = apply([], {cptText: {from: '0859 OLD', to: '15399 NEW CAPT', src: 'crew'}, foText: {from: '1234 OLD', to: '7390 NEW FO', src: 'both'}});
    expect(result.count).toBe(2);
    expect(result.state.chg).toHaveProperty('cptText');
    expect(result.state.chg).toHaveProperty('foText');
  });
  it('does not confuse row-level green with a pending time cell', () => {
    const result = apply([], {etd: {from: '09:50', to: '10:50', src: 'both', fbOk: false}}, {chgFb: true});
    expect(result.count).toBe(1);
    expect(result.state.chg).toHaveProperty('etd');
  });
  it('retains green on repeated reads of the same pair', () => {
    const change = {from: 'VN-A648', to: 'VN-A580', src: 'crew', fbOk: true};
    const result = apply([], {reg: change}, {chgPair: 'hy3.xlsx|hy4.xlsx'});
    expect(result.count).toBe(1);
    expect(result.state.chg.reg).toMatchObject(change);
  });
  it('keeps a pending warning after manual editing and preserves the typed value', () => {
    const result = apply([], {reg: {from: 'VN-A648', to: 'VN-A580', src: 'crew'}}, {reg: 'VN-A554', regFb: false, chgFb: false});
    expect(result.count).toBe(1);
    expect(result.state.reg).toBe('VN-A554');
    expect(result.state.chg.reg).toHaveProperty('to', 'VN-A580');
  });
  it('does not carry pending markers to a different full date or route', () => {
    const pending = {reg: {from: 'VN-A648', to: 'VN-A580', src: 'crew'}};
    for(const chgSector of ['717|05/11/25|DAD|PQC', '717|05/11/26|HAN|PQC']){
      const result = apply([], pending, {chgSector, regFb: false, chgFb: false});
      expect(result.count).toBe(0);
      expect(Object.keys(result.state.chg)).toEqual([]);
    }
  });
  it('a third aircraft replaces the pending target without inheriting green', () => {
    const result = apply([{flt: '717', route: 'DAD-PQC', day_new: '05/11', reg: {changed: true, old: 'VN-A648', new: 'VN-A580'}}],
      {reg: {from: 'VN-A677', to: 'VN-A648', src: 'both', fbOk: true}});
    expect(result.state.chg.reg).toMatchObject({from: 'VN-A648', to: 'VN-A580', src: 'crew', fbOk: false});
    expect(result.state.regFb).toBe(false);
  });
  it('keeps an Ack receipt through unchanged revisions without reviving the same aircraft change', () => {
    const receipt = {from:'VN-A648',to:'VN-A580',src:'crew',fbOk:true,acked:true};
    for(const rows of [[], [{flt:'717',route:'DAD-PQC',day_new:'05/11',reg:{changed:true,old:'VN-A648',new:'VN-A580'}}]]){
      const result = apply(rows, {reg:receipt});
      expect(result.state.chg.reg).toMatchObject(receipt);
      expect(result.count).toBe(0);
    }
  });
  it('never inherits Ack when a new aircraft target replaces the acknowledged change', () => {
    const result = apply([{flt:'717',route:'DAD-PQC',day_new:'05/11',reg:{changed:true,old:'VN-A648',new:'VN-A580'}}],
      {reg:{from:'VN-A677',to:'VN-A648',src:'crew',fbOk:true,acked:true}});
    expect(result.count).toBe(1);
    expect(result.state.chg.reg).toMatchObject({from:'VN-A648',to:'VN-A580',fbOk:false});
    expect(result.state.chg.reg).not.toHaveProperty('acked',true);
  });
});

describe('pending markers cannot migrate via loose Crewlist remapping', () => {
  const old = {id: 849, flt: '849', date: '25/11/26', dep: 'SGN', arr: 'DAD', etd: '10:00'};
  const pending = {chg: {reg: {from: 'VN-A648', to: 'VN-A580', src: 'crew'}}};
  it.each([
    {...old, id: 850, date: '26/11/26'},
    {...old, id: 850, arr: 'HAN'},
  ])('drops a different date/route rather than transferring the pending marker', fresh => {
    const context = {ftRows: [old], ftCatalog: [fresh], ftEdit: {'849': pending}};
    runInNewContext(remapScript + ';ftRemap([{f:ftRows[0],edit:ftEdit[849]}])', context);
    expect(context.ftRows.filter(Boolean)).toEqual([]);
    expect(Object.keys(context.ftEdit)).toEqual([]);
  });
  it('retains the pending marker through a unique same-sector delay and row renumber', () => {
    const fresh = {...old, id: 850, etd: '11:00'};
    const context = {ftRows: [old], ftCatalog: [fresh], ftEdit: {'849': pending} as Record<string, typeof pending>};
    runInNewContext(remapScript + ';ftRemap([{f:ftRows[0],edit:ftEdit[849]}])', context);
    expect(context.ftRows[0]?.id).toBe(850);
    expect(context.ftEdit['850']).toEqual(pending);
  });
  it('does not arbitrarily pick among duplicate changed schedules', () => {
    const context = {ftRows: [old], ftCatalog: [{...old,id:850,etd:'11:00'},{...old,id:851,etd:'12:00'}], ftEdit: {'849':pending}};
    runInNewContext(remapScript + ';ftRemap([{f:ftRows[0],edit:ftEdit[849]}])',context);
    expect(context.ftRows.filter(Boolean)).toEqual([]);
  });
});