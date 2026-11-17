"""Thailand ENR 5.1/5.2/5.3 snapshot -> src/lib/tool/data/aip_enr_th.json (CAAT eAIP).
Sub-areas get numeric/N/S suffixes (VTD30W2, VTD64N); a parent key keeps every part.
Border-following boundaries are skipped, arcs are kept as chords between published points."""
import json, re, sys, urllib.request
from bs4 import BeautifulSoup
AIRAC = sys.argv[1] if len(sys.argv) > 1 else "2026-06-11-AIRAC"
BASE = f"https://aip.caat.or.th/{AIRAC}/html/eAIP/VT-ENR-%s-en-GB.html"
CO = re.compile(r"(\d{4,6}(?:\.\d+)?)\s*([NS])\s*(\d{5,7}(?:\.\d+)?)\s*([EW])")
def dms(v, deg):
    d, rest = v[:deg], v[deg:]
    m = rest[:2]; s = rest[2:]
    x = int(d) + int(m) / 60
    if s.startswith('.'): x += float('0' + s) / 60
    elif s: x += float(s) / 3600
    return x
def pt(m):
    la = dms(m[0], 2) * (-1 if m[1] == 'S' else 1); lo = dms(m[2], 3) * (-1 if m[3] == 'W' else 1)
    return [round(la, 6), round(lo, 6)]
areas, skipped = {}, []
for sec in ("5.1", "5.2", "5.3"):
    url = BASE % sec
    html = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read().decode("utf-8", "ignore")
    soup = BeautifulSoup(html, "html.parser")
    for s in soup.find_all("span", class_="sdParams"): s.decompose()
    for tr in soup.find_all("tr"):
        txt = " ".join(tr.stripped_strings)
        m = re.match(r"\s*VT\s*([DPR])\s*(\d{1,3})\s*([A-Z])?\b\s*(.*)", txt)
        if not m: continue
        kind, num, suf, rest = m.group(1), m.group(2), m.group(3) or "", m.group(4)
        # "VTD30 W NAKHON…": a lone letter before the name is part of the designator in NOTAMs (VT D30W).
        if not suf:
            m2 = re.match(r"([A-Z])\s+[A-Z]{2,}", rest)
            if m2 and m2.group(1) in "WENS": suf = m2.group(1)
        base = f"VT{kind}{num}{suf}"
        sub = re.search(r"\bArea\s*(\d+)\b|\((North|South)\s*Area\)", txt, re.I)
        key = base + ((sub.group(1) or sub.group(2)[0].upper()) if sub else "")
        lim = re.search(r"((?:FL\s*\d+|UNL|ALT\s*[\d ]+ft|[\d ]+ft(?: AMSL| AGL)?)\s*/\s*(?:GND|SFC|FL\s*\d+|[\d ]+ft[^ ]*))", txt)
        circ = re.search(r"Circle\D{0,30}?(\d+(?:\.\d+)?)\s*NM\s*radius\s*cent(?:red|ered)\s*on\s*(?:point\s*)?", txt, re.I)
        pts = [pt(c) for c in CO.findall(txt.split("Type of restriction")[0])]
        entry = {"name": re.split(r"\s+(?:Area\b|\(North|\(South|Circle|A semi|Area1)", f"{base} {rest}")[0][:60].strip(), "fir": "VTBB", "ring": [], "source": url,
                 "document": f"AIP Thailand ENR {sec}", "effective": AIRAC[:10], "lower": lim.group(1) if lim else ""}
        if circ and pts:
            entry["circle"] = {"center": pts[0], "radiusNm": float(circ.group(1))}
        elif re.search(r"border|coast|along the", txt, re.I) and not circ:
            skipped.append(key); continue
        elif len(pts) >= 3:
            if pts[0] == pts[-1]: pts = pts[:-1]
            entry["ring"] = pts
        else:
            skipped.append(key); continue
        areas[key] = entry
        if sub and entry["ring"]:
            p = areas.setdefault(base, {**entry, "name": base, "ring": [], "parts": []})
            if "parts" in p: p["parts"].append(pts); p["ring"] = p["parts"][0]
for k, a in list(areas.items()):
    if k.endswith("W") and k[:-1] not in areas: pass
json.dump({"source": BASE % "5.x", "skipped": skipped, "areas": areas}, open("src/lib/tool/data/aip_enr_th.json", "w"), separators=(",", ":"))
print(len(areas), "areas; skipped", skipped)
