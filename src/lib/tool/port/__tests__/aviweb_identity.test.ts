import { afterEach, describe, expect, it, vi } from 'vitest';
import { AviWebSession, checkFlightsOnline } from '../aviweb';
vi.mock('../../creds.server', () => ({ env: (key: string) => key.endsWith('USERNAME') ? 'test' : 'test-password' }));
const identity = { VJC807: { dof: '261025', dep: 'VVTS', arr: 'VTBS' } };
const fpl = (dof: string, time: string) => `(FPL-VJC807-IS\n-A321/M-S\n-VVTS${time}\n-N0450F330 DCT\n-VTBS0130\n-DOF/${dof} REG/VNA629)`;
afterEach(() => vi.restoreAllMocks());
describe('AviWeb date safety', () => {
  it('skips yesterday 0745 and reads today 0830 even if yesterday is first', async () => {
    vi.spyOn(AviWebSession.prototype, 'connect').mockResolvedValue();
    vi.spyOn(AviWebSession.prototype, 'fetchRows').mockResolvedValue([
      { cells: ['VJC807'], status: 'Filed', key: 'old', tablePid: '1' },
      { cells: ['VJC807'], status: 'Filed', key: 'today', tablePid: '1' },
    ]);
    vi.spyOn(AviWebSession.prototype, 'viewFpl').mockImplementation(async row => row.key === 'old' ? fpl('261024', '0745') : fpl('261025', '0830'));
    const results = await checkFlightsOnline(['VJC807'], undefined, identity);
    expect(results[0]).toMatchObject({ ok: true, dof: '261025', flight_time: '0830' });
  });
  it('returns no EOBT when only yesterday exists', async () => {
    vi.spyOn(AviWebSession.prototype, 'connect').mockResolvedValue();
    vi.spyOn(AviWebSession.prototype, 'fetchRows').mockResolvedValue([{ cells: ['VJC807'], status: 'Filed', key: 'old', tablePid: '1' }]);
    vi.spyOn(AviWebSession.prototype, 'viewFpl').mockResolvedValue(fpl('261024', '0745'));
    const results = await checkFlightsOnline(['VJC807'], undefined, identity);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.flight_time).toBeUndefined();
  });
});