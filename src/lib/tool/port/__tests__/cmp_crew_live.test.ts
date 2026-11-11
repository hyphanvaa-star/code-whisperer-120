import { describe, expect, it } from 'vitest';
import { cmpCellCrewChanges, cmpPilotChanges } from '../cmp_sync';
import { ofpCrew } from '../fpl_tool';

describe('Compare crew swap from live mismatch', () => {
  it('VJ154: CP+ 11332 replaces FliteBrief-only 9515', () => {
    const excel = '-BUI ANH KHOA(CP+) 11332; -YIN KOK JING(FO) 9727';
    const detail = 'Excel có mà FliteBrief không: 11332 · FliteBrief có mà Excel không: 9515';
    expect(cmpCellCrewChanges(excel, detail)).toEqual([{ key: 'cptText', from: '9515', to: '11332' }]);
  });
  it('CP and CP+ count as captain in Crewlist diffs', () => {
    expect(cmpPilotChanges('(CP) 1234; (FO) 5678', '(CP+) 4321; (FO) 5678')).toEqual([{ key: 'cptText', from: '1234', to: '4321' }]);
  });
  it('reads OFP crew line', () => {
    expect(ofpCrew('CAPT 13330 KONOVALO   FO 13054 LE ANH DISPATCHER PHAN THANH HY')).toEqual([
      { role: 'CAPT', id: '13330', name: 'KONOVALO' }, { role: 'FO', id: '13054', name: 'LE ANH' }]);
    expect(ofpCrew('CAPT 6065 GASSER AH FO 8763 IVAN LLODISPATCHER NGUYEN VAN A').map(p => p.name)).toEqual(['GASSER AH', 'IVAN LLO']);
  });
});
