# Regenerates src/lib/tool/data/aip_enr_extra.json from the Czech (aim.rlp.cz) and Kazakhstan (ans.kz) eAIP ENR 5.1/5.2 HTML tables.
# Download the HTML pages listed in SRC into /tmp/aip, split them into <tr>/<td> rows (*.rows.json), then run this script.
import re, json
SRC = {
 'lk51.html.rows.json': ('LKAA', 'https://aim.rlp.cz/eaip/html/eAIP/LK-ENR-5.1-en-GB.html', 'AIP Czech Republic ENR 5.1', '2025-02-20'),
 'lk52.html.rows.json': ('LKAA', 'https://aim.rlp.cz/eaip/html/eAIP/LK-ENR-5.2-en-GB.html', 'AIP Czech Republic ENR 5.2', ''),
 'kz_UA-ENR-5.1-en-GB.html.rows.json': ('UA', 'https://www.ans.kz/AIP/eAIP/2026-10-29-AIRAC/html/eAIP/UA-ENR-5.1-en-GB.html', 'AIP Kazakhstan ENR 5.1', '2026-10-29'),
}
LL = re.compile(r'(\d{4,6}(?:\.\d+)?)\s*([NS])\s*(\d{5,7}(?:\.\d+)?)\s*([EW])')
def dms(s, dl):
    i, _, d = s.partition('.')
    deg = int(i[:dl]); r = i[dl:]
    if len(r) == 2: return deg + float(r + ('.' + d if d else '')) / 60
    if len(r) == 4: return deg + int(r[:2]) / 60 + float(r[2:] + ('.' + d if d else '')) / 3600
    return None
def pt(m):
    la, lo = dms(m[0], 2), dms(m[2], 3)
    return [round(-la if m[1] == 'S' else la, 6), round(-lo if m[3] == 'W' else lo, 6)]
def ft(s):
    s = s.upper().replace('\n', ' ')
    m = re.search(r'FL\s*(\d{2,3})', s)
    if m: return int(m[1]) * 100
    m = re.search(r'(\d[\d ]{2,6})\s*(FT|M)\b', s)
    if m:
        v = int(m[1].replace(' ', ''))
        return v if m[2] == 'FT' else round(v * 3.28084)
    if re.search(r'\bUNL', s): return 99999
    return None
areas, skipped = {}, []
for f, (fir, src, doc, eff) in SRC.items():
    R = json.load(open('/tmp/aip/' + f))
    for i, c in enumerate(R):
        lat = c[0]
        zm = re.match(r'\s*(LKTRA\d+Z)\s+consists of PART 1 and PART 2', lat)
        if zm:
            key = zm[1]; p1 = R[i+1][0] if i+1 < len(R) else ''; p2 = R[i+2][0] if i+2 < len(R) else ''
            base = re.search(r'identical with (LKTRA\d+)', p1)
            ring2 = [pt(x) for x in LL.findall(p2)]
            if ring2 and ring2[0] == ring2[-1]: ring2 = ring2[:-1]
            if base and len(ring2) >= 3 and base[1] in areas:
                parts = [areas[base[1]]['ring'], ring2]
                areas[key] = {'name': key, 'fir': fir, 'source': src, 'document': doc, 'effective': eff,
                  'lower': c[1].split('/')[-1].strip(), 'upper': re.sub(r'\s+',' ',c[1].split('/')[0]).strip(), 'upperFt': ft(c[1].split('/')[0]),
                  'activation': '', 'ring': ring2, 'parts': parts}
            else: skipped.append((key, 'parts unresolved'))
            continue
        m = re.match(r'\s*((?:LK|UA)(?:TSA|TRA|P|R|D)\d{1,3}[A-Z]?)\b\s*(.*)', lat, re.S)
        if not m: continue
        key, rest = m[1], m[2]
        name_line = rest.strip().split('\n')[0].strip()
        name = (key + (' ' + name_line if name_line and not LL.search(name_line) and not re.match(r'A circle', name_line, re.I) else '')).strip()
        vert = c[1] if len(c) > 1 else ''
        parts = [p.strip() for p in re.split(r'/', vert.replace('\n', ' '))]
        upper = parts[0] if parts else ''; lower = parts[1] if len(parts) > 1 else ''
        rem = (c[2] if len(c) > 2 else '').replace('\n', ' ')
        act = re.search(r'Time:\s*(.{0,90}?)(?=\s{2,}|Remarks|Entry|ATS unit|Activity|$)', rem) or re.search(r'^(H24|NOTAM|HJ|HN)', rem.strip())
        U = rest.upper()
        pts = [pt(x) for x in LL.findall(rest)]
        rec = {'name': name, 'fir': fir, 'source': src, 'document': doc, 'effective': eff,
               'lower': lower, 'upperFt': ft(upper), 'upper': re.sub(r'\s+',' ',upper), 'activation': (act[1] if act else '').strip()}
        circ = re.search(r'CIRCLE\s+(?:OF\s+)?RADIUS\s+(?:OF\s+)?(\d+(?:\.\d+)?)\s*(NM|KM|M)', U)
        if circ and len(pts) == 1:
            r = float(circ[1]); r = r if circ[2] == 'NM' else r / 1.852 if circ[2] == 'KM' else r / 1852
            rec.update(ring=[], circle={'center': pts[0], 'radiusNm': round(r, 3)})
        elif re.search(r'ARC|BORDER|BOUNDARY|ALONG|FRONTIER|CLOCKWISE', U):
            skipped.append((key, 'arc/border: ' + re.sub(r'\s+', ' ', rest)[:120])); continue
        elif len(pts) >= 3:
            if pts[0] == pts[-1]: pts = pts[:-1]
            rec['ring'] = pts
        else:
            skipped.append((key, 'no coords: ' + re.sub(r'\s+', ' ', rest)[:120])); continue
        if key in areas: skipped.append((key, 'duplicate')); continue
        areas[key] = rec
json.dump({'areas': areas}, open('/dev-server/src/lib/tool/data/aip_enr_extra.json', 'w'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print(len(areas), Counter(k[:2] + re.sub(r'\d.*', '', k[2:]) for k in areas))
print('skipped', len(skipped)); [print(' ', s) for s in skipped]
