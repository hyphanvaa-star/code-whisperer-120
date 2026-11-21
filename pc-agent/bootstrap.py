"""Khởi động Trợ lý PC kiểu tự phục hồi (không cần quyền admin, không cài lại).

Bat-Tro-Ly.vbs tải file này từ web rồi chạy bằng pythonw. File này:
  1. chọn thư mục chạy ghi được (D:\\.TroLyPC ẩn → %LOCALAPPDATA%\\SoheeTroLyPC),
  2. so phiên bản với /agent/manifest.json; thiếu/hỏng/cũ thì tải /agent/app.zip,
     kiểm SHA-256, biên dịch thử ở thư mục tạm rồi mới chép đè (lỗi → giữ bản cũ),
  3. cài thư viện còn thiếu (ẩn), rồi chạy background.py ngầm.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

BASE_URL = (os.environ.get("PC_AGENT_URL") or "https://soheedispatch.cloud").rstrip("/")
NO_WINDOW = 0x08000000
DETACHED = 0x00000008
LIBS = {"requests": "requests", "win32api": "pywin32", "openpyxl": "openpyxl", "selenium": "selenium"}


def version_tuple(v) -> tuple:
    return tuple(int(p) if p.isdigit() else 0 for p in str(v or "").strip().split(".")) if str(v or "").strip() else ()


def newer(remote, local) -> bool:
    return version_tuple(remote) > version_tuple(local)


def writable(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False


def choose_base(candidates=None) -> Path:
    if candidates is None:
        local = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
        candidates = [Path("D:\\.TroLyPC"), Path(local) / "SoheeTroLyPC", Path(tempfile.gettempdir()) / "SoheeTroLyPC"]
    for c in candidates:
        if writable(Path(c)):
            return Path(c)
    raise OSError("Không có thư mục nào ghi được cho trợ lý")


def local_version(base: Path) -> str:
    app = base / "app"
    if not ((app / "background.pyc").exists() or (app / "background.py").exists()):
        return ""
    if not ((app / "pc_agent.pyc").exists() or (app / "pc_agent.py").exists()):
        return ""
    try:
        return (base / "version.txt").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def fetch(url: str, timeout=30) -> bytes:
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "SoheeTroLy"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def install_update(base: Path, data: bytes, manifest: dict, python: str) -> None:
    """Kiểm hash, giải nén + biên dịch ở thư mục tạm, chỉ chép đè khi mọi bước OK."""
    if hashlib.sha256(data).hexdigest() != str(manifest.get("sha256", "")).lower():
        raise ValueError("Gói tải về bị hỏng (sai mã kiểm tra)")
    stage = base / "app.new"
    shutil.rmtree(stage, ignore_errors=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for n in z.namelist():
            if n.startswith("/") or ".." in Path(n).parts:
                raise ValueError("Gói có đường dẫn lạ")
        z.extractall(stage)
    for need in ("background.py", "pc_agent.py"):
        if not (stage / need).exists():
            raise ValueError(f"Gói thiếu {need}")
    if python:
        r = subprocess.run([python, "-m", "compileall", "-b", "-q", "-f", str(stage)],
                           capture_output=True, creationflags=NO_WINDOW if os.name == "nt" else 0)
        if r.returncode != 0:
            raise RuntimeError("Biên dịch gói mới lỗi")
        for py in stage.rglob("*.py"):
            if py.with_suffix(".pyc").exists():
                py.unlink()
        for cache in list(stage.rglob("__pycache__")):
            shutil.rmtree(cache, ignore_errors=True)
    app = base / "app"
    app.mkdir(parents=True, exist_ok=True)
    for f in stage.rglob("*"):
        if f.is_file():
            dest = app / f.relative_to(stage)
            dest.parent.mkdir(parents=True, exist_ok=True)
            # Xoá bản .py/.pyc cũ cùng tên để không chạy nhầm mã cũ.
            for twin in (dest.with_suffix(".py"), dest.with_suffix(".pyc")):
                if twin != dest and twin.exists():
                    twin.unlink()
            shutil.copy2(f, dest)
    shutil.rmtree(stage, ignore_errors=True)
    (base / "version.txt").write_text(str(manifest.get("version", "")), encoding="utf-8")


STATUS_FILE = "update_status.json"


def write_status(base: Path, ok: bool, want, have, error="") -> None:
    """Trợ lý đọc file này và báo lên web (nhãn cam cạnh AGENT) khi cập nhật lỗi."""
    try:
        (base / STATUS_FILE).write_text(json.dumps({
            "ok": bool(ok), "want": str(want or ""), "have": str(have or ""),
            "error": str(error or "")[:300], "at": int(time.time())}, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def console_python() -> str:
    exe = Path(sys.executable)
    if exe.name.lower() == "pythonw.exe" and (exe.parent / "python.exe").exists():
        return str(exe.parent / "python.exe")
    return str(exe)


def ensure_libs(python: str, log) -> None:
    missing = []
    for mod, pkg in LIBS.items():
        try:
            __import__(mod)
        except Exception:
            missing.append(pkg)
    if missing:
        log("Cài thư viện: " + ", ".join(missing))
        subprocess.run([python, "-m", "pip", "install", "--user", "--quiet", "--disable-pip-version-check", *missing],
                       creationflags=NO_WINDOW if os.name == "nt" else 0)


def wait_pid(pid: int, seconds=90) -> None:
    if os.name != "nt" or not pid:
        return
    import ctypes
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
    if h:
        k.WaitForSingleObject(h, seconds * 1000)
        k.CloseHandle(h)
    time.sleep(1)


def main(argv) -> int:
    base = choose_base()
    logf = base / "khoi-dong.log"

    def log(t):
        try:
            with logf.open("a", encoding="utf-8") as f:
                f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + t + "\n")
        except OSError:
            pass

    if "--after" in argv:
        try:
            wait_pid(int(argv[argv.index("--after") + 1]))
        except (ValueError, IndexError):
            pass
    if os.name == "nt":
        os.system(f'attrib +h "{base}" >nul 2>&1') if str(base).upper().startswith("D:") else None
    try:
        shutil.copy2(__file__, base / "bootstrap.py")
    except (OSError, shutil.SameFileError):
        pass
    python = console_python()
    have = local_version(base)
    want = ""
    try:
        manifest = json.loads(fetch(f"{BASE_URL}/agent/manifest.json?t={int(time.time())}"))
        want = str(manifest.get("version") or "")
        if newer(want, have) or not have:
            log(f"Cập nhật {have or '(chưa có)'} → {want}")
            install_update(base, fetch(f"{BASE_URL}/agent/app.zip?v={want}", 120), manifest, python)
            log("Cập nhật xong")
        write_status(base, True, want, local_version(base))
    except Exception as exc:  # mất mạng / gói lỗi → giữ bản đang có
        log(f"Không cập nhật được: {exc}")
        write_status(base, False, want, have, exc)
        if not have:
            if os.name == "nt":
                import ctypes
                ctypes.windll.user32.MessageBoxW(None, "Không tải được Trợ lý PC (kiểm tra mạng rồi bấm lại).", "Trợ lý Sohee", 48)
            return 1
    ensure_libs(python, log)
    app = base / "app"
    entry = app / "background.pyc"
    if not entry.exists():
        entry = app / "background.py"
    pyw = Path(sys.executable).with_name("pythonw.exe")
    runner = str(pyw if pyw.exists() else sys.executable)
    subprocess.Popen([runner, str(entry)], cwd=str(app), close_fds=True,
                     creationflags=(DETACHED | NO_WINDOW) if os.name == "nt" else 0)
    log(f"Đã chạy trợ lý bản {local_version(base)} tại {app}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
