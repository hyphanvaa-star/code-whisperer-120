import { describe, expect, it } from 'vitest';
import { patchCmpValidationPage } from '../cmp_validation';

const patched = patchCmpValidationPage('function renderCompareTable(d, opts){');
const start = patched.indexOf('const cmpNotes =');
const end = patched.indexOf('let cmpRegReadSeq', start);

describe('Editable Compare notes', () => {
  it('retains typed notes on redraw and reload without sharing another sector or user', () => {
    localStorage.clear();
    let uid = 'dispatcher-a';
    const makeFactory = () => new Function('document', 'window', 'localStorage', 'cmpActionFlight',
      patched.slice(start, end) + '\nreturn cmpNoteCell;')(
        document, { parent: { __fbUserId: () => uid } }, localStorage, () => ({ std: '2026-10-27T08:00:00Z' }),
      );
    const cell = makeFactory();
    const row = { sector_id: 64200, callsign: 'VJC642', dep: 'VVTS', arr: 'VVNB' };
    const input = cell(row).querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'Kiểm tra lại tải';
    input.dispatchEvent(new Event('input'));
    expect(cell(row).querySelector('textarea').value).toBe('Kiểm tra lại tải');
    expect(makeFactory()(row).querySelector('textarea').value).toBe('Kiểm tra lại tải');
    expect(cell({ ...row, sector_id: 64201 }).querySelector('textarea').value).toBe('');
    uid = 'dispatcher-b';
    expect(cell(row).querySelector('textarea').value).toBe('');
  });
});