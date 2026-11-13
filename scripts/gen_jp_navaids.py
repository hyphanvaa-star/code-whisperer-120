#!/usr/bin/env python3
"""Japan radio navaid positions for AIP SUP arc centres ("radius of 45NM of Kajiki VOR").

Inputs are `pdftotext -layout` dumps of the current Japan eAIP (Japan SWIM login):
  GEN 2.5 (ident -> station name/facility), ENR 4.1 and every AD 2 (positions).
Usage: gen_jp_navaids.py GEN25.txt ENR41.txt AD_DIR OUT.json
Only published coordinates are written; a station without one is left out.
"""
import json, re, sys, glob

def dms(v: str, deg: int) -> float:
    v = v.rstrip('NE')
    d, m, s = float(v[:deg]), float(v[deg:deg + 2]), float(v[deg + 2:])
    return round(d + m / 60 + s / 3600, 6)

ROW = re.compile(r'^\s*(VOR/DME|VORTAC|VOR|TACAN|DME|NDB)\s+([A-Z]{2,3})\s.*?(\d{6}(?:\.\d+)?)N')
LON = re.compile(r'(\d{7}(?:\.\d+)?)E')

def positions(path: str, out: dict):
    lines = open(path, encoding='utf-8', errors='ignore').read().splitlines()
    for i, ln in enumerate(lines):
        m = ROW.match(ln)
        if not m:
            continue
        lon = LON.search(ln[m.end():]) or next((LON.search(x) for x in lines[i + 1:i + 4] if LON.search(x)), None)
        if not lon:
            continue
        kind, ident = m.group(1), m.group(2)
        out.setdefault(ident, {}).setdefault(kind, [dms(m.group(3), 2), dms(lon.group(1), 3)])

def main():
    gen, enr, ad_dir, dst = sys.argv[1:5]
    pos: dict = {}
    positions(enr, pos)
    for f in sorted(glob.glob(ad_dir.rstrip('/') + '/*.txt')):
        positions(f, pos)
    names: dict = {}
    for ln in open(gen, encoding='utf-8', errors='ignore'):
        m = re.match(r'^\s*([A-Z]{2,3})\s+([A-Z][A-Za-z\-\. ]+?)\s+\(.*?\)\s+(VOR/DME|VORTAC|VOR|TACAN|NDB|DME)\b', ln)
        if not m:
            continue
        ident, name, fac = m.group(1), m.group(2).strip().upper(), m.group(3)
        p = pos.get(ident, {})
        # VORTAC/VOR-DME centres are the VOR antenna when published separately.
        pt = p.get('VOR') or p.get(fac) or p.get('VORTAC') or p.get('VOR/DME') or p.get('TACAN') or p.get('DME') or p.get('NDB')
        if not pt:
            continue
        names.setdefault(name, {})[fac] = {'id': ident, 'pt': pt}
    doc = {'_source': 'Japan eAIP GEN 2.5 / ENR 4.1 / AD 2.19 (Japan SWIM)', 'navaids': dict(sorted(names.items()))}
    json.dump(doc, open(dst, 'w'), ensure_ascii=False, indent=0, separators=(',', ':'))
    print(len(names), 'stations')

if __name__ == '__main__':
    main()
