import iataIcao from '../data/iata-icao.json';

export type ReqOfpAlternates = {
  alt1: string;
  alt2: string;
  talt: string;
  alternate_source: 'ofp';
};

/** Read only the already validated sector OFP, never a route library or KHB draft. */
export function reqOfpAlternates(text: string, atc: string, destination: string): ReqOfpAlternates {
  const src = text.toUpperCase();
  const map = iataIcao as Record<string, string>;
  const airport = (icao: string, writtenIata = ''): string => {
    if (!icao) return '';
    if (writtenIata) {
      if (map[writtenIata] !== icao) throw new Error(`OFP cũ: mã Alternate ${icao}/${writtenIata} không khớp — không soạn REQ.`);
      return writtenIata;
    }
    const matches = Object.entries(map).filter(([, code]) => code === icao);
    if (matches.length !== 1) throw new Error(`OFP cũ: chưa xác định được mã IATA của Alternate ${icao} — không soạn REQ.`);
    return matches[0]?.[0] || '';
  };
  const labelled: Record<string, { icao: string; iata: string }> = {};
  for (const m of src.matchAll(/^[ \t]*ALT([12])[ \t]+([A-Z]{4})(?:\/([A-Z]{3}))?\b/gm)) {
    const slot = m[1] || '';
    const icao = m[2] || '';
    const iata = m[3] || '';
    if (labelled[slot] && labelled[slot]?.icao !== icao) throw new Error(`OFP cũ: có nhiều sân ALT${slot} khác nhau — không soạn REQ.`);
    labelled[slot] = { icao, iata };
  }
  // Item 16 from the very same OFP covers a missing ALT DATA block and explicit
  // no-alternate plans. Stop at the next FPL field, including wrapped item 16.
  const dest = destination.toUpperCase();
  if (!/^[A-Z]{4}$/.test(dest)) throw new Error('OFP cũ: thiếu sân đến để đọc Alternate — không soạn REQ.');
  const item16 = new RegExp(`(?:^|\\n)[ \\t]*-${dest}\\d{4}\\b([^\\-]*)`).exec(atc.toUpperCase());
  const filed = (item16?.[1] || '').trim().split(/\s+/).filter(Boolean);
  if (filed.length > 2 || filed.some(code => !/^[A-Z]{4}$/.test(code))) throw new Error('OFP cũ: không đọc được Alternate trong ATC Plan — không soạn REQ.');
  if (!item16 && !labelled['1']) throw new Error('OFP cũ: chưa xác định được Alternate — không soạn REQ (không lấy sân mặc định).');
  for (const [slot, index] of [['1', 0], ['2', 1]] as const) {
    if (labelled[slot] && filed[index] && labelled[slot]?.icao !== filed[index]) throw new Error(`OFP cũ: ALT${slot} khác giữa ALT DATA và ATC Plan — không soạn REQ.`);
  }
  const alt1 = labelled['1'];
  const alt2 = labelled['2'];
  if (alt2 && !alt1 && !filed[0]) throw new Error('OFP cũ: thiếu ALT1 — không soạn REQ.');
  const takeoff = /\bTALT\/([A-Z]{4})\b/.exec(atc.toUpperCase())
    || /TAKE[ \t]*-?OFF[ \t]+ALT(?:N|ERNATE)?\b(?:[ \t]*[:=][ \t]*|[ \t]+)([A-Z]{4})\b/.exec(src);
  if (/\bTALT\//.test(atc.toUpperCase()) && !takeoff) throw new Error('OFP cũ: không đọc được TALT — không soạn REQ.');
  return {
    alt1: airport(alt1?.icao || filed[0] || '', alt1?.iata || ''),
    alt2: airport(alt2?.icao || filed[1] || '', alt2?.iata || ''),
    talt: airport(takeoff?.[1] || ''),
    alternate_source: 'ofp',
  };
}