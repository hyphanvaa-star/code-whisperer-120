# Regenerates src/lib/tool/data/aip_enr_lr.json from AIP Romania ENR 5.1/5.2 PDFs (aisro.ro).
# Download LR_ENR_5_1_en.pdf / LR_ENR_5_2_en.pdf into /tmp/aip, then run: python3 scripts/gen_aip_enr_lr.py
import re, json, pypdf
from collections import Counter
EFF = '2026-10-29'
BASE = f'https://www.aisro.ro/aip/{EFF}/DOCS/AIP/ENR/ENR5/'
SRC = [('LR_ENR_5_1_en.pdf', 'AIP Romania ENR 5.1'), ('LR_ENR_5_2_en.pdf', 'AIP Romania ENR 5.2')]
LL = re.compile(r'(\d{6}(?:\.\d+)?)\s*([NS])\s*(\d{7}(?:\.\d+)?)\s*([EW])')
ID = re.compile(r'^(LR(?:TRA|TSA|CBA|P|R|D)\d{1,3}[A-Z]{0,2})\b(?:\s+(?![a-z])(.*))?$')
NOISE = re.compile(r'^(AIP|ROMANIA|ROMATSA.*|AIRAC AIP AMDT.*|ENR 5\.\d+-\d+.*|\d{1,2} [A-Z]{3} \d{4}.*|Civil Aviation Authority|1 2 3|Identification, name.*|Remarks.*|Upper limit.*|Lower limit.*)$')
VERT = re.compile(r'(FL\s*\d{2,3}|\d[\d ]{0,6}\s*(?:FT|M)\b(?:\s*(?:AMSL|MSL|AGL|QNH|ALT|SFC))?|GND|SFC|UNL)', re.I)
VSTART = re.compile(r'^(FL\s*\d|\d[\d ]*\s*(?:FT|M)\b|GND|SFC|UNL|Vertical limits|Active|Time of activity|H24)', re.I)
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
for f, doc in SRC:
    lines = [l.strip() for p in pypdf.PdfReader('/tmp/aip/' + f).pages for l in p.extract_text().split('\n')]
    lines = [l for l in lines if l and not NOISE.match(l)]
    blocks, cur = [], None
    for l in lines:
        m = ID.match(l)
        if m:
            cur = [m[1], (m[2] or '').strip(), []]; blocks.append(cur); continue
        if re.match(r'^(TEMPORARY|PROHIBITED|RESTRICTED|DANGER|CROSS|\d+\.\s)', l): cur = None; continue
        if cur: cur[2].append(l)
    for key, title, body in blocks:
        # Lateral limits end at the first vertical-limit/activity line; notes below may cite other coordinates.
        stop = next((i for i, l in enumerate(body) if VSTART.match(l)), len(body))
        geo = ' '.join(body[:stop])
        text = ' '.join(body)
        U = geo.upper()
        hits = list(LL.finditer(geo))
        if not hits: skipped.append((key, 'no coords')); continue
        geo_end = hits[-1].end()
        circ = re.search(r'CIRCLE(?:\s+OF)?,?\s*(?:RADIUS\s*)?(?:OF\s*)?(\d+(?:\.\d+)?)\s*(NM|KM)', U[:geo_end + 5])
        tail = geo[geo_end:] + ' ' + ' '.join(body[stop:])
        tail = re.sub(r'^\s*(?:,?\s*except[^.]*?\.|-?\s*to point of origin\.?)', '', tail, flags=re.I)
        v = VERT.findall(tail[:80])
        upper, lower = (v[0] if v else ''), (v[1] if len(v) > 1 else '')
        name = key + (' ' + title if title and not LL.search(title) else '')
        rec = {'name': re.sub(r'\s+', ' ', name).strip(), 'fir': 'LRBB', 'source': BASE + f, 'document': doc, 'effective': EFF,
               'lower': lower.strip(), 'upper': upper.strip(), 'upperFt': ft(upper)}
        act = re.search(r'Active:\s*(by NOTAM|H24|by ATC|[^.]{0,60})', text, re.I)
        if act: rec['activation'] = act[1].strip()
        pts = [pt(m.groups()) for m in hits]
        if circ and len(pts) == 1:
            r = float(circ[1]); rec.update(ring=[], circle={'center': pts[0], 'radiusNm': round(r if circ[2] == 'NM' else r / 1.852, 3)})
        elif re.search(r'\bARC\b|BORDER|BOUNDARY|ALONG|FRONTIER', U[:geo_end + 5]):
            skipped.append((key, 'arc/border')); continue
        elif len(pts) >= 3:
            if pts[0] == pts[-1]: pts = pts[:-1]
            rec['ring'] = pts
        else:
            skipped.append((key, f'{len(pts)} pts')); continue
        if key in areas: continue  # PDF repeats some pages; first published row wins
        areas[key] = rec
json.dump({'source': BASE, 'areas': areas, 'skipped': [k for k, _ in skipped]}, open('/dev-server/src/lib/tool/data/aip_enr_lr.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(areas), Counter(re.sub(r'\d.*', '', k) for k in areas))
print('skipped', len(skipped)); [print(' ', s) for s in skipped]
