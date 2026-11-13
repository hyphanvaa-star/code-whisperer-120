"""India ENR 5.2 TRA/TSA + ENR 5.3 balloon areas -> src/lib/tool/data/aip_enr_in.json.
Border/river-following or partial-arc boundaries are skipped, never guessed."""
import json, math, re, sys, urllib.request, bs4
BASE = "https://aim-india.aai.aero/eAIP_Archive/16-04-2026/eAIP/IN-ENR%20{}-en-GB.html"
FIR = {"5": "VABF", "6": "VECF", "7": "VIDF", "8": "VOMF"}
PT = re.compile(r"(\d{2})(\d{2})(\d{2}(?:\.\d+)?)([NS])\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)([EW])")
def get(n): return urllib.request.urlopen(urllib.request.Request(BASE.format(n), headers={"User-Agent": "Mozilla/5.0"}), timeout=40).read().decode("utf-8", "ignore")
def dd(m):
    la = int(m[1]) + int(m[2]) / 60 + float(m[3]) / 3600; lo = int(m[5]) + int(m[6]) / 60 + float(m[7]) / 3600
    return [round(-la if m[4] == "S" else la, 5), round(-lo if m[8] == "W" else lo, 5)]
def brg(c, p):
    y = (p[1] - c[1]) * math.cos(math.radians(c[0])); return math.atan2(y, p[0] - c[0])
def arc(c, r, a, b, cw):
    t0, t1 = brg(c, a), brg(c, b); out = []
    if cw:
        while t1 < t0: t1 += 2 * math.pi
    else:
        while t1 > t0: t1 -= 2 * math.pi
    n = max(4, int(abs(t1 - t0) / math.radians(5)))
    for i in range(1, n):
        t = t0 + (t1 - t0) * i / n
        out.append([round(c[0] + r / 60 * math.cos(t), 5), round(c[1] + r / 60 * math.sin(t) / math.cos(math.radians(c[0])), 5)])
    return out
def ft(s):
    s = s.upper().strip()
    if "UNL" in s: return 99999
    m = re.search(r"FL\s*(\d+)", s)
    if m: return int(m[1]) * 100
    m = re.search(r"([\d,]+)\s*FT", s)
    return int(m[1].replace(",", "")) if m else None
def parse(text):
    t = text.upper()
    if re.search(r"BORDER|BANK OF|SMALLER ARC|BETWEEN \d+ AND", t): return None
    m = re.search(r"CIRCULAR AREA CENTRED|CIRCULAR AREA CENTERED|CIRCLE OF", t)
    if re.search(r"^.*CIRCULAR AREA", t) and m:
        p = PT.search(t); r = re.search(r"([\d.]+)\s*(NM|KM)\s*RADIUS|RADIUS (?:OF )?([\d.]+)\s*(NM|KM)", t)
        if p and r:
            v, u = (r[1], r[2]) if r[1] else (r[3], r[4])
            return {"circle": {"center": dd(p), "radiusNm": round(float(v) / (1.852 if u == "KM" else 1), 3)}}
        return None
    ring = []; pos = 0
    ARC = re.compile(r"(COUNTER\s*-?\s*CLOCKWISE|ANTI\s*-?\s*CLOCKWISE|CLOCKWISE)\s+ARC\s+OF\s+(?:A\s+)?(?:CIRCLE\s+(?:OF\s+)?)?([\d.]+)\s*NM\s+RADIUS\s+CENT(?:RED|ERED)\s+(?:ON|AT)[^()\d]*\(?\s*")
    while True:
        a = ARC.search(t, pos)
        seg = t[pos:a.start() if a else len(t)]
        ring += [dd(m) for m in PT.finditer(seg)]
        if not a: break
        c = PT.match(t, a.end())
        if not c or not ring: return None
        rest = t[c.end():]; e = PT.search(rest)
        if not e: return None
        cen, end = dd(c), dd(e)
        ring += arc(cen, float(a[2]), ring[-1], end, a[1].startswith("CLOCK")) + [end]
        pos = c.end() + e.end()
    return {"ring": ring} if len(ring) >= 3 else None
areas = {}; skipped = []
s = bs4.BeautifulSoup(get("5.2"), "html.parser")
for r in s.find_all("table")[1].find_all("tr")[1:]:
    c = [x.get_text(" ", strip=True) for x in r.find_all("td")]
    m = c and re.match(r"(T[RS]A)\s*(\d{3})\s*\(?([A-Z])?\)?\s*\[([^\]]+)\]", c[0])
    if not m: continue
    g = parse(c[0][m.end():])
    ident = f"{m[1]}{m[2]}{'(' + m[3] + ')' if m[3] else ''}"
    if not g: skipped.append(ident); continue
    lim = (c[1] if len(c) > 1 else "").split("/")
    areas[f"IN{m[1]}{m[2]}{m[3] or ''}"] = {"name": f"{ident} {m[4].strip().upper()}", "fir": FIR[m[2][0]],
        **g, "upperFt": ft(lim[0]) if lim else None, "lower": lim[1].strip() if len(lim) > 1 else "",
        "source": BASE.format("5.2").replace("%20", " "), "document": "India eAIP ENR 5.2"}
json.dump({"areas": areas, "skipped": skipped}, open("src/lib/tool/data/aip_enr_in.json", "w"), separators=(",", ":"))
print(len(areas), "areas; skipped", skipped)
