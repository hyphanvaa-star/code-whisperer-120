import { describe, expect, it } from 'vitest';
import { cellsForRow, crewFbEmpty, crewVerdict } from '../excelcmp_compare';
import type { Crew, Flight } from '../../core/models';

const crew = (username: string, deadheading = false) => ({ username, full_name: username, deadheading }) as unknown as Crew;
const raw = '-NGUYEN VAN A(CP) 1234; -TRAN VAN B(FO) 5678';

describe('crew compare when FliteBrief has no crew yet', () => {
  it('does not count a freshly pushed flight without crew as wrong crew', () => {
    const [n, why] = crewVerdict(raw, []);
    expect(n).toBe(0);
    expect(crewFbEmpty(why)).toBe(true);
  });

  it('DHD-only crew on FliteBrief still counts as no crew assigned', () => {
    const [n, why] = crewVerdict(raw, [crew('vj9999', true)]);
    expect(n).toBe(0);
    expect(crewFbEmpty(why)).toBe(true);
  });

  it('still flags a real mismatch once FliteBrief has crew', () => {
    const [n, why] = crewVerdict(raw, [crew('vj1234'), crew('vj4321')]);
    expect(n).toBe(1);
    expect(crewFbEmpty(why)).toBe(false);
  });

  it('marks the Compare cell as not assigned instead of a mismatch', () => {
    const flight = { crews: [] } as unknown as Flight;
    const cells = cellsForRow(flight, { Crew: raw }, { crew: 'Crew' }, ['crew']);
    expect(cells['crew']?.same).toBe(true);
    expect(cells['crew']?.fb_empty).toBe(true);
  });
});
