# Regenerates src/lib/tool/data/aip_enr_lh.json from the Hungarian eAIP (HungaroControl) ENR 5.1/5.2/5.5 HTML tables.
# Download LH-ENR-5.x-en-HU.html of the effective AIRAC into /tmp/aip/lh5.x.html, then run: python3 scripts/gen_aip_enr_lh.py
import re, json, warnings
from collections import Counter
from bs4 import BeautifulSoup
warnings.filterwarnings('ignore')
EFF = '2026-09-03'
BASE = f'https://ais.hungarocontrol.hu/aip/{EFF}/{EFF}-AIRAC/html/eAIP/'
SRC = [('lh5.1.html', 'LH-ENR-5.1-en-HU.html', 'AIP Hungary ENR 5.1'), ('lh5.2.html', 'LH-ENR-5.2-en-HU.html', 'AIP Hungary ENR 5.2'),
       ('lh5.5.html', 'LH-ENR-5.5-en-HU.html', 'AIP Hungary ENR 5.5')]
LL = re.compile(r'(\d{6}(?:\.\d+)?)\s*([NS])\s*(\d{7}(?:\.\d+)?)\s*([EW])')
def dms(s, dl):
    i, _, d = s.partition('.')
    return int(i[:dl]) + int(i[dl:dl+2]) / 60 + float(i[dl+2:] + ('.' + d if d else '')) / 3600
def pt(m):
    la, lo = dms(m[0], 2), dms(m[2], 3)
    return [round(-la if m[1] == 'S' else la, 6), round(-lo if m[3] == 'W' else lo, 6)]
def ft(s):
    s = s.upper()
    m = re.search(r'FL\s*(\d{2,3})', s)
    if m: return int(m[1]) * 100
    m = re.search(r'(\d[\d ]{1,6})\s*(FT|M)\b', s)
    if m:
        v = int(m[1].replace(' ', '')); return v if m[2] == 'FT' else round(v * 3.28084)
    if 'UNL' in s: return 99999
    if re.search(r'\b(GND|SFC)\b', s): return 0
    return None
areas, skipped = {}, []
for f, page, doc in SRC:
    soup = BeautifulSoup(open('/tmp/aip/' + f, encoding='utf-8', errors='ignore').read(), 'lxml')
    for tr in soup.find_all('tr'):
        cells = [c.get_text('\n', strip=True) for c in tr.find_all(['td', 'th'])]
        if len(cells) < 2: continue
        m = re.match(r'\s*(LH[A-Z]{1,4}\d{1,3}[A-Z]{0,2})\s*(?:/\s*([^\n]*))?\n?(.*)', cells[0], re.S)
        if not m: continue
        key, title, geo = m[1], (m[2] or '').strip(), m[3]
        U = geo.upper()
        pts = [pt(x) for x in LL.findall(geo)]
        vert = [p.strip() for p in re.sub(r'\s+', ' ', cells[1]).split('/')]
        upper, lower = vert[0], (vert[1] if len(vert) > 1 else '')
        rem = re.sub(r'\s+', ' ', cells[-1]).strip()
        rec = {'name': f'{key} {title}'.strip(), 'fir': 'LHCC', 'source': BASE + page, 'document': doc, 'effective': EFF,
               'lower': lower, 'upper': upper, 'upperFt': ft(upper), 'activation': rem[:80]}
        circ = re.search(r'CIRCLE\s+(?:WITH\s+)?(?:A\s+)?RADIUS\s+(?:OF\s+)?(\d+(?:\.\d+)?)\s*(NM|KM|M)\b', U)
        if circ and len(pts) == 1:
            r = float(circ[1]); r = r if circ[2] == 'NM' else r / 1.852 if circ[2] == 'KM' else r / 1852
            rec.update(ring=[], circle={'center': pts[0], 'radiusNm': round(r, 3)})
        elif re.search(r'\bARC\b|BORDER|BOUNDARY|ALONG|FRONTIER', U):
            skipped.append((key, 'arc/border: ' + re.sub(r'\s+', ' ', geo)[:100])); continue
        elif len(pts) >= 3:
            if pts[0] == pts[-1]: pts = pts[:-1]
            rec['ring'] = pts
        else:
            skipped.append((key, f'{len(pts)} pts: ' + re.sub(r'\s+', ' ', geo)[:100])); continue
        if key in areas: continue
        areas[key] = rec
json.dump({'source': BASE, 'areas': areas, 'skipped': [k for k, _ in skipped]}, open('/dev-server/src/lib/tool/data/aip_enr_lh.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(areas), Counter(re.sub(r'\d.*', '', k) for k in areas))
print('skipped', len(skipped)); [print(' ', s) for s in skipped]
