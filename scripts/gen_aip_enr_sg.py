"""Singapore ENR 5.1 / 5.2 / 5.3 -> src/lib/tool/data/aip_enr_sg.json (CAAS eAIP).
Only boundaries fully defined by coordinates, circles or lat/long boxes are kept;
areas that follow another boundary (ATZ, coastline) are listed in "skipped", never guessed."""
import html, json, math, re, urllib.request
EFF = "2026-10-29"
BASE = "https://aim-sg.caas.gov.sg/aim-content/uploads/aip/12-NOV-2026/AIP/2026-10-29-000000/html/eAIP/SG-ENR-{}-en-GB.html"
PT = re.compile(r"(\d{2})(\d{2})(\d{2}(?:\.\d+)?)([NS])\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)([EW])")

def get(sec):
    req = urllib.request.Request(BASE.format(sec), headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")

def rows(sec):
    s = re.sub(r"<del.*?</del>", "", get(sec), flags=re.S)
    s = re.sub(r"<br[^>]*>", " / ", s)
    out = []
    for r in re.findall(r"<tr.*?</tr>", s, flags=re.S):
        cells = [html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c))).strip() for c in re.findall(r"<t[dh].*?</t[dh]>", r, flags=re.S)]
        out.append(cells)
    return out

def dd(m):
    la = int(m[1]) + int(m[2]) / 60 + float(m[3]) / 3600
    lo = int(m[5]) + int(m[6]) / 60 + float(m[7]) / 3600
    return [round(-la if m[4] == "S" else la, 6), round(-lo if m[8] == "W" else lo, 6)]

def pts(text): return [dd(m) for m in PT.finditer(text)]

def ring(p):
    return p[:-1] if len(p) > 3 and p[0] == p[-1] else p

def ft(s):
    s = s.upper()
    m = re.search(r"FL\s*(\d+)", s)
    if m: return int(m[1]) * 100
    m = re.search(r"([\d,]+)\s*FT", s)
    return int(m[1].replace(",", "")) if m else None

def lower(s):
    parts = [p.strip() for p in s.split("/") if p.strip()]
    return parts[-1] if len(parts) > 1 else ("GND" if "GND" in s.upper() else "")

def capsule(c1, c2, r_nm, n=12):
    """Two circles joined by their tangential lines (stadium shape)."""
    k = math.cos(math.radians((c1[0] + c2[0]) / 2))
    to_xy = lambda p: ((p[1]) * 60 * k, p[0] * 60)
    to_ll = lambda x, y: [round(y / 60, 6), round(x / 60 / k, 6)]
    (x1, y1), (x2, y2) = to_xy(c1), to_xy(c2)
    a = math.atan2(y2 - y1, x2 - x1)
    out = []
    for cx, cy, start in ((x2, y2, a - math.pi / 2), (x1, y1, a + math.pi / 2)):
        for i in range(n + 1):
            t = start + math.pi * i / n
            out.append(to_ll(cx + r_nm * math.cos(t), cy + r_nm * math.sin(t)))
    return out

areas, skipped = {}, {}
def add(key, name, fir, sec, upper_s, low_s, remark, ring_=None, circle=None, note=""):
    a = {"name": name, "fir": fir, "ring": ring_ or [], "source": BASE.format(sec),
         "document": f"AIP Singapore ENR {sec}" + (f" ({note})" if note else ""), "effective": EFF,
         "lower": low_s, "upperFt": ft(upper_s), "activation": re.sub(r"\s*/\s*", " ", remark).strip()[:240]}
    if circle: a["circle"] = circle
    areas[key] = a

# ---- ENR 5.1: P / R / D tables, one row per area.
ID = re.compile(r"^(W[SM][PRD]\d+[A-Z]?)\b\s*(.*)$")
for cells in rows("5.1"):
    if len(cells) < 2: continue
    m = ID.match(cells[0])
    if not m: continue
    key, rest = m[1], m[2]
    name = (key + " " + re.split(r"\s*/\s*|\s+(?=\d{6}|A circle|An arc|Area|BTN)", rest)[0]).strip()
    up_low, remark = cells[1], (cells[2] if len(cells) > 2 else "")
    upper_s, low_s = up_low.split("/")[0], lower(up_low)
    if re.search(r"GND\s*$", upper_s.strip()) and "/" not in up_low:
        upper_s, low_s = upper_s.replace("GND", ""), "GND"
    p = pts(rest)
    circ = re.search(r"circle,?\s*(\d*\.?\d+)\s*NM radius,?\s*centred at", rest, re.I)
    box = re.search(r"BTN LAT (\d{6}[NS]) (\d{6}[NS]) and LONG (\d{7}[EW]) / ?(\d{7}[EW])|BTN LAT (\d{6}[NS]) (\d{6}[NS]) and LONG (\d{7}[EW]) (\d{7}[EW])", rest)
    if "along the boundar" in rest.lower() or "coinciding with the coastline" in rest.lower():
        skipped[key] = "boundary follows another airspace/coastline"; continue
    if key == "WSP24":
        c = pts(rest)
        add(key, name, "WSJC", "5.1", upper_s, low_s, remark, ring_=capsule(c[0], c[1], 150 / 1852), note="two 150 m circles joined by tangents")
        continue
    if key == "WSD4":
        # Arc closing segment is not published; keep the full 3.5 NM circle as a conservative superset.
        add(key, name, "WSJC", "5.1", upper_s, low_s, remark, circle={"center": p[0], "radiusNm": 3.5}, note="drawn as full 3.5 NM circle")
        continue
    if circ:
        r = circ[1]
        r_nm = float(r) if "." in r or not r.startswith("0") else float(r)  # "06NM" is published as 6 NM
        add(key, name, "WSJC", "5.1", upper_s, low_s, remark, circle={"center": p[0], "radiusNm": r_nm})
        continue
    if box:
        g = [x for x in box.groups() if x]
        la = sorted(int(x[:2]) + int(x[2:4]) / 60 for x in g[:2]); lo = sorted(int(x[:3]) + int(x[3:5]) / 60 for x in g[2:])
        r_ = [[la[1], lo[0]], [la[1], lo[1]], [la[0], lo[1]], [la[0], lo[0]]]
        add(key, name, "WSJC", "5.1", upper_s, low_s, remark, ring_=[[round(a, 6), round(b, 6)] for a, b in r_])
        continue
    if "arc" in rest.lower():
        skipped[key] = "arc boundary (already bundled from AIP Malaysia)"; continue
    if len(p) >= 4:
        add(key, name, "WSJC", "5.1", upper_s, low_s, remark, ring_=ring(p)); continue
    skipped[key] = "unparsed"

# ---- ENR 5.2: light aircraft training areas (title row followed by limits row).
title = None
for cells in rows("5.2"):
    t = cells[0] if cells else ""
    if len(cells) == 1 and t.isupper():
        title = t; continue
    if len(cells) == 2 and t.startswith("LIGHT AIRCRAFT TRAINING AREA"):
        # Title row carrying a description: the limits follow in the next row.
        title = t; continue
    if not title or len(cells) < 2: continue
    if "along the b" in t.lower():
        skipped[title] = "follows Sembawang ATZ boundary"; title = None; continue
    if title.startswith("LIGHT AIRCRAFT TRAINING AREA") and len(pts(t)) >= 4:
        suffix = title.rsplit(" ", 1)[-1]
        add(f"WSLATA{suffix}", title, "WSJC", "5.2", cells[1].split("/")[0], cells[1].split("/")[1].strip(), cells[2] if len(cells) > 2 else "Daylight VMC training", ring_=ring(pts(t)))
    elif title == "LOW FLYING OPERATIONS":
        skipped[title] = "only described by islands/longitudes, no closed boundary"
    title = None

# ---- ENR 5.3: weather balloon release point, equipment descends within 60 NM.
s53 = re.sub(r"<[^>]+>", " ", get("5.3"))
bal = PT.search(s53[s53.find("Upper Air Observatory"):])
add("WS53BALLOON", "UPPER AIR OBSERVATORY", "WSJC", "5.3", "115000 FT", "GND",
    "Daily release 2330 and 1040 UTC (cut-off 0030/1230 UTC); ozonesonde 3rd/4th week 2330-0030 UTC; descent within 60 NM",
    circle={"center": dd(bal), "radiusNm": 60})
skipped["PENGERANG INTEGRATED COMPLEX"] = "refers to AIP Malaysia, no coordinates in AIP Singapore"

json.dump({"source": BASE.format("5.x"), "areas": areas, "skipped": skipped},
          open("src/lib/tool/data/aip_enr_sg.json", "w"), separators=(",", ":"))
print(len(areas), "areas;", "skipped:", skipped)
for k, v in areas.items(): print(k, v["name"], v["upperFt"], v["lower"], len(v["ring"]), v.get("circle"))
