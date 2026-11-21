"""Đóng gói Trợ lý PC từ danh sách cố định: python3 pc-agent/pack.py"""
import hashlib, json, shutil, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "public" / "agent"
APP = ["background.py", "pc_agent.py"] + sorted(
    str(p.relative_to(HERE)) for p in (HERE / "tool").rglob("*.py") if "__pycache__" not in p.parts)
version = next(l.split('"')[1] for l in (HERE / "pc_agent.py").read_text(encoding="utf-8").splitlines() if l.startswith("VERSION ="))

OUT.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUT / "app.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for f in APP:
        z.write(HERE / f, f)
# Người dùng chỉ tải đúng 1 file Bat-Tro-Ly.vbs; nó tự tải app.zip qua bootstrap.py.
(OUT / "tro-ly-pc.zip").unlink(missing_ok=True)
data = (OUT / "app.zip").read_bytes()
(OUT / "manifest.json").write_text(json.dumps({"version": version, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}))
shutil.copy2(HERE / "bootstrap.py", OUT / "bootstrap.py")
shutil.copy2(HERE / "Bat-Tro-Ly.vbs", OUT / "Bat-Tro-Ly.vbs")
print(version, len(data))
