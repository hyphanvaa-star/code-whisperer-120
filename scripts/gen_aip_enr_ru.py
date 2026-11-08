# Regenerates src/lib/tool/data/aip_enr_ru.json from AIP Russia ENR 5.1 (caica.ru).
#   curl -o /tmp/ru/enr5.1.pdf https://www.caica.ru/ANI_Official/Aip/aip/enr/enr5/enr5.1.pdf
#   pdftotext -bbox /tmp/ru/enr5.1.pdf /tmp/ru/all.html && python3 scripts/gen_aip_enr_ru.py
# Columns are split by x position (identification | limits | remarks). Only the English
# (N/E coordinate) text is used; boundaries along state borders/coasts are skipped, never guessed.
import re, json, math, html, sys
from collections import Counter

SRC = 'https://www.caica.ru/ANI_Official/Aip/aip/enr/enr5/enr5.1.pdf'
IN = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ru/all.html'
OUT = '/dev-server/src/lib/tool/data/aip_enr_ru.json'
W = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
ID = re.compile(r'^(U[HLNRSUW])([PRD])(\d{1,4}[A-Z]?)$')
CYR = re.compile(r'[А-Яа-яЁё]')
LL = re.compile(r'(\d{6}(?:\.\d+)?)\s*([NS])\s*(\d{7}(?:\.\d+)?)\s*([EW])')
DATE = re.compile(r'^\d{2} [A-Z]{3} \d{2}$')
MON = {m: i + 1 for i, m in enumerate('JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split())}

def dms(s, dl):
    i, _, d = s.partition('.')
    return int(i[:dl]) + int(i[dl:dl + 2]) / 60 + float(i[dl + 2:] + ('.' + d if d else '')) / 3600
def pt(m):
    la, lo = dms(m[0], 2), dms(m[2], 3)
    return [round(-la if m[1] == 'S' else la, 5), round(-lo if m[3] == 'W' else lo, 5)]
def nm(r, u):
    r = float(r); u = u.upper()
    return r if u == 'NM' else r / 1.852 if u == 'KM' else r / 1852

def lines_of(page):
    words = [(float(m[1]), float(m[2]), html.unescape(m[5])) for m in W.finditer(page)]
    words = [w for w in words if 70 < w[1] < 790]  # drop running header/footer
    words.sort(key=lambda w: (round(w[1] / 3), w[0]))
    rows = []
    for w in words:
        if rows and abs(rows[-1][0] - w[1]) < 4: rows[-1][1].append(w)
        else: rows.append([w[1], [w]])
    out = []
    for _, ws in rows:
        ws.sort()
        cols = ([], [], [])
        for x, _, t in ws:
            # Cyrillic look-alikes inside English text: 0475500Е, Н24, КМ, М.
            t = re.sub(r'(?<=\d)[ЕЕ](?=[,.;]?$)', 'E', t)
            t = {'Н24': 'H24', 'КМ': 'KM', 'М': 'M'}.get(t, t)
            c = 0 if x < 352 else 1 if x < 470 else 2
            if c == 0 and x > 250 and re.fullmatch(r'\d+/\d+|AGL|AMSL|ASL|GND|UNL|FL\d{2,3}', t): c = 1
            cols[c].append((x, t))
        if len(cols[0]) == 1 and re.fullmatch(r'\d{1,3}', cols[0][0][1]): cols[0].clear()  # page numbers
        out.append(cols)
    return out

def page_date(page):
    words = [html.unescape(m[5]) for m in W.finditer(page) if float(m[2]) < 70]
    s = ' '.join(words)
    m = re.search(r'(\d{2}) (JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC) (\d{2})', s)
    return f'20{m[3]}-{MON[m[2]]:02d}-{m[1]}' if m else ''

ARC = re.compile(r'(counter-?clockwise|anti-?clockwise|clockwise)\s+(?:by|along)\s+(?:an?\s+)?arc\s+of\s+(?:a\s+)?circle\s+(?:with\s+)?(?:a\s+)?radius\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(KM|NM|M)\s+cent(?:re|er)d\s+(?:at|on)\s+' + LL.pattern + r'\s*(?:to)?', re.I)
CIRCLE = re.compile(r'^(?:a\s+)?circle\s+(?:with\s+)?(?:a\s+)?radius\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(KM|NM|M)\s+cent(?:re|er)d\s+(?:at|on)\s+' + LL.pattern + r'\s*$', re.I)
FILLER = re.compile(r'^[\s\-–−—,;.]*(?:then|to|and|далее)?[\s\-–−—,;.]*$', re.I)

def dist(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0]); dl = math.radians(b[1] - a[1])
    return 3440.065 * math.acos(max(-1, min(1, math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl))))
def brg(c, p):
    p1, p2 = math.radians(c[0]), math.radians(p[0]); dl = math.radians(p[1] - c[1])
    return math.degrees(math.atan2(math.sin(dl) * math.cos(p2), math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl))) % 360
def dest(c, b, d):
    p1, l1, t, a = math.radians(c[0]), math.radians(c[1]), math.radians(b), d / 3440.065
    p2 = math.asin(math.sin(p1) * math.cos(a) + math.cos(p1) * math.sin(a) * math.cos(t))
    l2 = l1 + math.atan2(math.sin(t) * math.sin(a) * math.cos(p1), math.cos(a) - math.sin(p1) * math.sin(p2))
    return [round(math.degrees(p2), 5), round((math.degrees(l2) + 540) % 360 - 180, 5)]
def arc(start, end, c, cw):
    b0, b1 = brg(c, start), brg(c, end)
    sweep = (b1 - b0) % 360 if cw else -((b0 - b1) % 360)
    if abs(sweep) < 1e-6: sweep = 360 if cw else -360
    r0, r1 = dist(c, start), dist(c, end)
    n = max(2, int(abs(sweep) / 5))
    return [dest(c, b0 + sweep * i / n, r0 + (r1 - r0) * i / n) for i in range(1, n)] + [end]

ELLIPSE = re.compile(r'^Ellipse centre coordinates\s+' + LL.pattern + r',?\s*dimensions of axes\s+(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*KM,?\s*azimuth of major axis\s+(\d+(?:\.\d+)?)\s*°?\s*$', re.I)
CORRIDOR = re.compile(r'^The route centre line:\s*(.*?)\s*±\s*(\d+(?:\.\d+)?)\s*(KM|NM)\s+wide from the centre line\s*$', re.I)
CIRC_ANY = re.compile(r'(?:a\s+)?circle\s+(?:with\s+)?(?:a\s+)?radius\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(KM|NM|M)\s+cent(?:re|er)d\s+(?:at|on)\s+' + LL.pattern, re.I)

def ring_circle(c, r, n=36):
    return [dest(c, 360 * i / n, r) for i in range(n)]

def geometry(text):
    """English lateral-limit text -> ('circle', c, r) | ('parts', [rings]) | (None, reason)."""
    t = re.sub(r'\s+', ' ', text).strip()
    # "Excluding boundaries of ULP2" / ", excluding X AD": keep the (larger) outer boundary.
    t = re.sub(r',?\s*excluding\b.*$', '', t, flags=re.I).strip()
    m = CIRCLE.match(t)
    if m: return ('circle', pt(m.groups()[2:]), round(nm(m[1], m[2]), 3))
    m = ELLIPSE.match(t)
    if m:
        c = pt(m.groups()[0:4]); a, b, az = float(m[5]) / 2 / 1.852, float(m[6]) / 2 / 1.852, float(m[7])
        ring = []
        for i in range(36):
            f = math.radians(10 * i)
            ring.append(dest(c, az + 10 * i, a * b / math.hypot(b * math.cos(f), a * math.sin(f))))
        return ('parts', [ring])
    m = CORRIDOR.match(t)
    if m:
        pts = [pt(x) for x in LL.findall(m[1])]
        w = nm(m[2], m[3])
        if len(pts) < 2 or not FILLER.match(LL.sub('', m[1])): return (None, 'corridor: ' + t[:80])
        parts = [ring_circle(p, w, 16) for p in pts]
        for a_, b_ in zip(pts, pts[1:]):
            h = brg(a_, b_)
            parts.append([dest(a_, h - 90, w), dest(b_, h - 90, w), dest(b_, h + 90, w), dest(a_, h + 90, w)])
        return ('parts', parts)
    circles = list(CIRC_ANY.finditer(t))
    if len(circles) > 1 and FILLER.match(CIRC_ANY.sub('', t)):
        cs = [(pt(c.groups()[2:]), nm(c[1], c[2])) for c in circles]
        if all(c[0] == cs[0][0] for c in cs):  # stacked tiers: outer circle covers every tier
            return ('circle', cs[0][0], round(max(c[1] for c in cs), 3))
        return ('parts', [ring_circle(c, r) for c, r in cs])
    if re.search(r'border|coast|boundary|shore|river|line of|parallel|meridian|sector|bearing|radial|along', t, re.I):
        return (None, 'border/other: ' + t[:110])
    parts, ring, pos = [], [], 0
    pending = None
    tokens = []
    for mm in re.finditer(ARC.pattern + '|' + LL.pattern, t, re.I):
        gap = t[pos:mm.start()]
        if not FILLER.match(gap): return (None, 'text: ' + gap.strip()[:80] + ' | ' + t[:80])
        pos = mm.end()
        tokens.append(mm)
    if not FILLER.match(t[pos:]): return (None, 'tail: ' + t[pos:].strip()[:80])
    for mm in tokens:
        if mm.group(1):  # arc
            if not ring: return (None, 'arc without start')
            g = mm.groups()
            pending = (pt(g[3:7]), not g[0].lower().startswith(('counter', 'anti')))
            continue
        p = pt(mm.groups()[7:11])
        if pending:
            ring += arc(ring[-1], p, pending[0], pending[1]); pending = None
        elif ring and len(ring) >= 3 and p == ring[0]:
            parts.append(ring); ring = []; continue
        else:
            ring.append(p)
    if pending: return (None, 'dangling arc')
    if len(ring) >= 3: parts.append(ring)
    elif ring: return (None, 'open ring')
    parts = [r[:-1] if r[0] == r[-1] else r for r in parts]
    return ('parts', parts) if parts else (None, 'no coords')

def ft_of(upper):
    u = upper.upper()
    m = re.search(r'FL\s*(\d{2,3})(?!\d)', u)
    if m: return int(m[1]) * 100
    m = re.search(r'\d+\s*/\s*(\d+)', u)
    if m: return int(m[1])
    m = re.search(r'(\d+)\s*FT', u)
    if m: return int(m[1])
    return 99999 if 'UNL' in u else None

pages = open(IN, encoding='utf-8').read().split('<page ')[1:]
areas, skipped, seen = {}, [], set()
cur = None
def flush():
    global cur
    if not cur: return
    key = cur['key']
    eng = ' '.join(l for l in cur['geo'] if not CYR.search(l))
    # Remarks text can drift left into the limits column; keep only limit vocabulary there.
    VT = re.compile(r'\d+/\d+|AGL|AMSL|ASL|MSL|GND|SFC|UNL|ALT|FL\d{2,4}|\d+', re.I)
    vert = [' '.join(w for w in l.split() if VT.fullmatch(w)) for l in cur['vert']]
    vert = [l for l in vert if l]
    rem = ' '.join(l for l in cur['rem'] if not CYR.search(l)).strip()
    upper = vert[0] if vert else ''
    lower = vert[1] if len(vert) > 1 else ''
    kind, *g = geometry(eng)
    rec = {'name': key, 'fir': key[:2], 'effective': cur['date'],
           'lower': lower, 'upper': upper, 'upperFt': max([f for f in (ft_of(v) for v in vert[::2]) if f is not None], default=None),
           'activation': 'AAB' if re.search(r'Availability Bulletin', rem, re.I) else rem[:90]}
    if kind == 'circle': rec.update(ring=[], circle={'center': g[0], 'radiusNm': g[1]})
    elif kind == 'parts':
        rec['ring'] = g[0][0]
        if len(g[0]) > 1: rec['parts'] = g[0]
    else: skipped.append((key, g[0])); cur = None; return
    areas[key] = rec; cur = None

done = False
for pi, page in enumerate(pages):
    date = page_date(page)
    for c1, c2, c3 in lines_of(page):
        t1 = ' '.join(t for _, t in c1)
        if len(c1) == 1 and c1[0][0] < 100 and ID.match(c1[0][1]):
            key = c1[0][1]
            if key in seen:  # second listing = operator contact table
                done = True; break
            flush(); seen.add(key)
            cur = {'key': key, 'date': date, 'geo': [], 'vert': [], 'rem': [], 'note': False}
            continue
        if not cur: continue
        if re.match(r'^(Примечани|Note|Notes)\b|^(PROHIBITED|RESTRICTED|DANGER) AREAS$|^(ЗАПРЕТНЫЕ|ОПАСНЫЕ) ЗОНЫ|^ЗОНЫ ОГРАНИЧЕНИЯ|^Contact information', t1):
            cur['note'] = True
        if re.fullmatch(r'[123\s]+', t1 + ' ' + ' '.join(t for _, t in c2 + c3)): continue  # repeated column header
        if cur['note']: continue
        cur['geo'].append(t1)
        if c2: cur['vert'].append(' '.join(t for _, t in c2))
        if c3: cur['rem'].append(' '.join(t for _, t in c3))
    if done: break
flush()
json.dump({'source': SRC, 'document': 'AIP Russia ENR 5.1', 'areas': areas}, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(areas), Counter(k[:3] for k in areas))
print('skipped', len(skipped), Counter(s[1].split(':')[0] for s in skipped))
for s in skipped: print(' ', s)
