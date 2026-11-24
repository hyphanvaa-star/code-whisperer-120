// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { patchKhbPayloadPage, payloadPair } from '../khb_payload';

const page = patchKhbPayloadPage(readFileSync(join(__dirname, '../../../../tool/page.html'), 'utf8'));

function loadCell() {
  const start = page.indexOf('let ftPldFocusId');
  const end = page.indexOf('let ftEstBusy');
  const src = page.slice(start, end);
  const state: Record<string, any> = {};
  const env = {
    ftSt: (f: any) => (state[f.id] ||= { pay: '', est: '' }),
    ftPayloadPair: payloadPair,
    ftEstAutoLater: () => {},
    ftEstIdentity: (f: any) => String(f.id),
    ftPayloadSector: () => null,
    W_CACHE: {},
    ofpFitsFlight: () => true,
    ftOfpPending: new Set(),
  };
  const make = new Function(...Object.keys(env), src + '; return ftPldCell;');
  return { ftPldCell: make(...Object.values(env)) as (f: any) => HTMLTableCellElement, state };
}

function row(cell: HTMLTableCellElement) {
  const tr = document.createElement('tr');
  const flt = document.createElement('td');
  const inp = document.createElement('input');
  inp.title = 'Gõ số hiệu rồi Enter.';
  flt.appendChild(inp);
  tr.append(flt, cell);
  document.body.innerHTML = '';
  const tb = document.createElement('tbody');
  tb.appendChild(tr);
  document.body.appendChild(tb);
  return tr;
}

describe('KHB manual payload', () => {
  it('keeps the typed payload as soon as it is typed, before leaving the field', () => {
    const { ftPldCell, state } = loadCell();
    const f = { id: 849 };
    const td = ftPldCell(f);
    row(td);
    const input = td.querySelector('input')!;
    input.value = '21500';
    input.dispatchEvent(new Event('input'));
    expect(state[849].pay).toBe('21500');
    expect(state[849].pldManual).toBe(true);
  });

  it('marks the typed payload red and shows PLD tag under the flight number', () => {
    const { ftPldCell } = loadCell();
    const td = ftPldCell({ id: 1 });
    const tr = row(td);
    const input = td.querySelector('input')!;
    input.value = '18000';
    input.dispatchEvent(new Event('input'));
    expect(input.classList.contains('ft-pld-manual')).toBe(true);
    expect(tr.querySelector('.ft-pay')?.textContent).toBe('PLD 18000');
  });

  it('a table redraw keeps showing the typed payload', () => {
    const { ftPldCell } = loadCell();
    const f = { id: 7 };
    const td = ftPldCell(f);
    row(td);
    const input = td.querySelector('input')!;
    input.value = '22950';
    input.dispatchEvent(new Event('input'));
    const again = ftPldCell(f);
    row(again);
    expect(again.querySelector('input')!.value).toBe('22,950');
  });

  it('clearing the field removes the manual payload and its tag', () => {
    const { ftPldCell, state } = loadCell();
    const td = ftPldCell({ id: 3 });
    const tr = row(td);
    const input = td.querySelector('input')!;
    input.value = '15000';
    input.dispatchEvent(new Event('input'));
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(state[3].pay).toBe('');
    expect(state[3].pldManual).toBe(false);
    expect(tr.querySelector('.ft-pay')).toBeNull();
  });
});

describe('Auto Rounding PLD respects typed payloads', () => {
  it('skips flights with a typed payload when rounding', () => {
    expect(page).toContain('if(st.pldManual && st.pay != null && String(st.pay).trim() !== ""){ st.payManual = true; ftPldKept++; continue; }');
    expect(page).toContain('let ftPldKept = 0;');
  });
  it('turning rounding off keeps typed payloads', () => {
    expect(page).toContain('for(const f of ftRows) if(f && !ftSt(f).pldManual){ const st = ftSt(f); st.pay = ""; st.payManual = false; }');
  });
  it('REQ export sends the typed payload even when rounding is off', () => {
    expect(page).toContain('if(st.pay != null && String(st.pay).trim() !== "") items[items.length - 1].pay = st.pay;');
  });
});
