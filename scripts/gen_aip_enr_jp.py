"""Regenerate src/lib/tool/data/aip_enr_jp.json from AIP Japan ENR 5.2 / 5.3 PDFs.
Usage: python scripts/gen_aip_enr_jp.py JP-ENR-5.2-en-JP.pdf JP-ENR-5.3-en-JP.pdf
Only numbered published points are used; arcs are drawn as chords between their end points."""
import json, re, sys, pdfplumber
COORD = re.compile(r"(\d{2})(\d{2})(\d{2}(?:\.\d+)?)N/?(\d{3})(\d{2})(\d{2}(?:\.\d+)?)E")
NUM = re.compile(r"^\((\d{1,2})\)")
SUB = re.compile(r"^(?:[A-Z]|\d{1,2})-\d{1,2}$")
REGION = re.compile(r"^\((HK|TH|KK|CK|CS|KS|SM)\)$")
REG_NAME = {"Hokkaido": "HK", "Tohoku": "TH", "Kanto/": "KK", "Chubu/": "CK", "Kinki/": "CK", "Chugoku/": "CS", "Kyushu": "KS", "Shimojishima": "SM"}

def dms(m):
    lat = int(m[1]) + int(m[2]) / 60 + float(m[3]) / 3600
    lon = int(m[4]) + int(m[5]) / 60 + float(m[6]) / 3600
    return [round(lat, 6), round(lon, 6)]

def parse(path, kind, out):
    base = region = None; coord_x = None
    for page in pdfplumber.open(path).pages:
        ws = sorted(page.extract_words(), key=lambda w: (round(w["top"]), w["x0"]))
        txt = " ".join(w["text"] for w in ws)
        if kind == "52" and "Area" not in txt: continue
        starts = []
        for i, w in enumerate(ws):
            nxt = ws[i + 1]["text"] if i + 1 < len(ws) else ""
            if (w["text"] == "The" and nxt == "airspace") or w["text"] == "Within":
                starts.append(w)
        if not starts: continue
        coord_x = min(s["x0"] for s in starts)
        starts = [s for s in starts if abs(s["x0"] - coord_x) < 6]
        foot = next((w["top"] for w in ws if w["text"].startswith("Civil") and w["top"] > 600), page.height)
        for bi, s in enumerate(starts):
            y0 = s["top"]; y1 = starts[bi + 1]["top"] if bi + 1 < len(starts) else foot
            left = [w for w in ws if w["x0"] < coord_x - 3 and y0 - 14 <= w["top"] < y1]
            for j, w in enumerate(left):
                if kind == "52" and w["text"] == "Area" and w["top"] <= y0 + 12 and j + 1 < len(left) and re.fullmatch(r"[A-Z]|\d", left[j + 1]["text"]):
                    base = left[j + 1]["text"]
                if kind == "53":
                    if w["text"] in REG_NAME: region = REG_NAME[w["text"]]
                    m = REGION.match(w["text"])
                    if m: region = m[1]
            mid = (y0 + y1) / 2
            subs = [w["text"] for w in sorted((w for w in left if SUB.match(w["text"]) and w["top"] < y1 - 2), key=lambda w: abs(w["top"] - mid))]
            body = [w for w in ws if w["x0"] >= coord_x - 3 and w["x0"] < coord_x + 230 and y0 <= w["top"] < y1]
            parts, cur, last = [], [], 0
            for k, w in enumerate(body):
                m = COORD.search(w["text"])
                if not m: continue
                n = NUM.match(w["text"])
                if not n and k > 0: n = re.fullmatch(r"\((\d{1,2})\)", body[k - 1]["text"])
                if not n: continue  # arc centres / references are not boundary points
                num = int(n[1])
                if num <= last and len(cur) >= 3: parts.append(cur); cur = []
                if num != last: cur.append(dms(m))
                last = num
            if len(cur) >= 3: parts.append(cur)
            if not parts: continue
            if kind == "52":
                if not base: continue
                sub = subs[0] if subs else None
                key, name = (f"RJAREA{sub}", f"Area {sub}") if sub else (f"RJAREA{base}", f"Area {base}")
                doc = "AIP Japan ENR 5.2 JSDF Training/Testing Areas"
            else:
                if not region or not subs: continue
                key, name = f"RJ{region}{subs[0]}", f"{region} {subs[0]}"
                doc = "AIP Japan ENR 5.3 Civil Aircraft Training/Testing Areas"
            a = out.setdefault(key, {"name": name, "fir": "RJJJ", "document": doc, "parts": []})
            a["parts"].extend(parts)
    return out

out = {}
parse(sys.argv[1], "52", out); parse(sys.argv[2], "53", out)
for a in out.values(): a["ring"] = a["parts"][0]
for k, a in out.items():
    if len(a["parts"]) == 1: del a["parts"]
json.dump({"source": "https://aisjapan.mlit.go.jp/", "areas": dict(sorted(out.items()))}, open("src/lib/tool/data/aip_enr_jp.json", "w"), separators=(",", ":"))
print(len(out)); print(" ".join(sorted(out)))
