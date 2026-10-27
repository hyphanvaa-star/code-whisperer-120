import { describe, expect, it } from 'vitest';
import { crewChangeMatches } from '../khb_crew_sync';

describe('VJ642 current FliteBrief crew', () => {
  const crew = [{username: 'VJC15399', job: {name: 'Captain'}}, {username: 'VJC7390', job: {name: 'First Officer'}}];
  it('already updated CPT 15399 is green without another write', () => {
    expect(crewChangeMatches(crew, 'Captain', '0859 SARNO SEMEN SOLINAP', '15399 ACHMAD PRAHERDI')).toBe(true);
  });
  it('already updated FO 7390 is green separately', () => {
    expect(crewChangeMatches(crew, 'First Officer', '1234 OLD PILOT', '7390 PHAN TIEN DAT')).toBe(true);
  });
  it('old pilot still present is not complete', () => {
    expect(crewChangeMatches([...crew, {username: 'VJC0859', job: {name: 'Captain'}}], 'Captain', '0859 OLD', '15399 NEW')).toBe(false);
  });
  it('wrong role or deadheading does not acknowledge CPT', () => {
    expect(crewChangeMatches(crew, 'First Officer', '0859 OLD', '15399 NEW')).toBe(false);
    expect(crewChangeMatches([{...crew[0], deadheading: true}], 'Captain', '0859 OLD', '15399 NEW')).toBe(false);
  });
});