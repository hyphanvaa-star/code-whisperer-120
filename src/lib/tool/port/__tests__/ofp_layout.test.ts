import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { fixedWidthPage } from '@/lib/pdf-text-layout';
import { extractAtc, extractEzfw } from '../atc_ezfw';
import { cutVerifiedEzfw, type EzfwSector } from '../khb_ezfw';
import { ofpLayoutFromPdf } from '../ofp_layout';
import atc from './fixtures/ATC_VJC7527.txt?raw';
import ezfw from './fixtures/EZFW_VJC7527.txt?raw';

const sample = ezfw.replace(/\r\n/g, '\n').trim() + '\n';
const sector: EzfwSector = { id: 7527, callsign: 'VJC7527', std: new Date('2026-10-20T18:10:00Z'), reg: 'VN-A629', dep_iata: 'CAN', dep_icao: 'ZGGG', dest_iata: 'HAN', dest_icao: 'VVNB' };

async function positionedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  for (const source of [atc, sample]) {
    const page = doc.addPage([612, 792]);
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    lines.forEach((line, row) => {
      // Deliberately write right-to-left fragments; extraction must rely on
      // positions, not content-stream order, missing spaces or EOL hints.
      const runs = [...line.matchAll(/\S+(?: \S+)*/g)].reverse();
      for (const run of runs) {
        page.drawText(run[0], { x: 48 + run.index * 6, y: 750 - row * 12, size: 10, font });
      }
    });
  }
  return doc.save();
}

describe('OFP layout shared by mail draft and KHB EZFW', () => {
  it('restores the indented FUEL TIME header and separates fuel/time columns', () => {
    const item = (str: string, column: number, y: number) => ({ str, width: str.length * 6, fontName: 'Courier', transform: [10, 0, 0, 10, 48 + column * 6, y] });
    expect(fixedWidthPage([
      item('TIME', 30, 700), item('FUEL', 23, 700),
      item('TRIP', 0, 688), item('1:33', 30, 688), item('4960', 23, 688),
      item('PLAN 1755', 0, 724),
    ])).toBe('PLAN 1755\n\n                       FUEL   TIME\nTRIP                   4960   1:33');
  });

  it('mail draft preserves every column and signature on the supplied EZFW sample', async () => {
    const text = await ofpLayoutFromPdf(await positionedPdf());
    expect(extractEzfw(text)).toBe(sample);
    expect(extractAtc(text)).toBe(atc.replace(/\r\n/g, '\n').trim() + '\n');
  });

  it('KHB creates the same sample from PDF after flight/date/aircraft validation', async () => {
    const text = await ofpLayoutFromPdf(await positionedPdf());
    expect(cutVerifiedEzfw(text, sector)).toEqual([
      { name: 'ATC_VJC7527.txt', text: atc.replace(/\r\n/g, '\n').trim() + '\n' },
      { name: 'EZFW_VJC7527.txt', text: sample },
    ]);
  });
});