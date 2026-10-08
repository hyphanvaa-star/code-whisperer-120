# -*- coding: utf-8 -*-
"""Trợ lý PC cho Dispatch Board — chạy trên máy công ty.

Web gửi lệnh (in GD tới máy RICOH, ghi file xuống ổ D:, mở Outlook Web...);
script này nhận lệnh và thực hiện như tool gốc.

CÁCH DÙNG (không cần gõ lệnh):
    Double-click file "cai-tro-ly.bat" đi kèm — nó tự cài Python + thư viện
    rồi chạy trợ lý này. Cấu hình đã được ghi sẵn bên dưới (DEFAULT_*) hoặc
    trong file pc_agent_config.json nằm cạnh script. Muốn đổi thì sửa file
    pc_agent_config.json: {"url": ..., "token": ..., "tool_dir": ...}
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

VERSION = "1.6"
POLL_URL = "/api/public/pc-agent/poll"
REPORT_URL = "/api/public/pc-agent/report"
POLL_INTERVAL_S = 3

# Cấu hình mặc định — ghi sẵn để người dùng chỉ cần double-click, không gõ lệnh.
DEFAULT_URL = "https://sohee-dispatch-tool-v3.lovable.app"
DEFAULT_TOKEN = "Hydeptrai@123"


def _load_config() -> dict:
    """Ưu tiên: biến môi trường > pc_agent_config.json cạnh script > mặc định."""
    cfg: dict = {}
    cfg_path = Path(__file__).resolve().with_name("pc_agent_config.json")
    try:
        if cfg_path.is_file():
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {
        "url": (os.environ.get("PC_AGENT_URL") or (cfg.get("url") if "code-whisperer" not in str(cfg.get("url") or "") else "") or DEFAULT_URL).rstrip("/"),
        "token": os.environ.get("PC_AGENT_TOKEN") or cfg.get("token") or DEFAULT_TOKEN,
        "tool_dir": os.environ.get("PC_TOOL_DIR") or cfg.get("tool_dir") or "",
        "_cfg_path": cfg_path,
    }


_CFG = _load_config()
BASE_URL = _CFG["url"]
TOKEN = _CFG["token"]


def _save_config(**kw) -> None:
    """Ghi nhớ cấu hình (vd tool_dir người dùng chọn) vào pc_agent_config.json."""
    try:
        cur = {}
        p: Path = _CFG["_cfg_path"]
        if p.is_file():
            cur = json.loads(p.read_text(encoding="utf-8"))
        cur.update(kw)
        p.write_text(json.dumps(cur, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

FOLDER_NAME = "GENDEC"
PRINTER_HINT = "RICOH"
LOOKBACK_H = 7 * 24
# Excel 1-based sheet index, copies, orientation — same PRINT_PLAN as tool gốc.
PRINT_PLAN = [
    (3, 5, "portrait"),
    (5, 1, "landscape"),
    (6, 1, "landscape"),
    (7, 2, "landscape"),
]

RE_DIGITS = re.compile(r"\d+")
RE_AC = re.compile(r"VN[-\s]?A[-\s]?\d{3}", re.IGNORECASE)
RE_TAU = re.compile(r"T[AÀẢ]U", re.IGNORECASE)


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


# --------------------------------------------------------------------------- #
# Máy in
# --------------------------------------------------------------------------- #

def printer_status_text(status: int) -> str:
    bits = []
    table = [
        (0x00000001, "tạm dừng"), (0x00000002, "đang in"), (0x00000004, "lỗi"),
        (0x00000008, "hết giấy"), (0x00000010, "hết mực"), (0x00000020, "kẹt giấy"),
        (0x00000040, "sẵn sàng"), (0x00000080, "offline"), (0x00000200, "bận"),
        (0x00400000, "offline"), (0x00800000, "lỗi nghiêm trọng"),
    ]
    for bit, text in table:
        if status & bit:
            bits.append(text)
    return ", ".join(bits)


def list_printers() -> list[dict]:
    try:
        import win32print
    except ImportError:
        return []
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    try:
        rows = win32print.EnumPrinters(flags, None, 2)
    except Exception:
        rows = []
    try:
        default = str(win32print.GetDefaultPrinter() or "")
    except Exception:
        default = ""
    out = []
    for r in rows:
        name = str(r.get("pPrinterName") or "")
        status = int(r.get("Status") or 0)
        out.append({
            "name": name,
            "note": printer_status_text(status),
            "default": name == default,
        })
    return out


def resolve_printer(hint: str = "") -> str:
    printers = list_printers()
    names = [p["name"] for p in printers]
    if hint and hint in names:
        return hint
    for p in printers:
        if PRINTER_HINT.casefold() in p["name"].casefold():
            return p["name"]
    for p in printers:
        if p["default"]:
            return p["name"]
    return names[0] if names else ""


# --------------------------------------------------------------------------- #
# GD — Outlook GENDEC + in qua Excel
# --------------------------------------------------------------------------- #

def digits_of(text: str) -> str:
    found = RE_DIGITS.findall(str(text or ""))
    return found[-1] if found else ""


def contains_flight(text: str, flight: str) -> bool:
    want = digits_of(flight)
    if not want:
        return False
    return re.search(rf"(?<!\d){re.escape(want)}(?!\d)", str(text or "")) is not None


def normalize_reg(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(text or "").upper())


def pretty_reg(text: str) -> str:
    n = normalize_reg(text)
    m = re.fullmatch(r"(VN)A(\d{3})", n)
    return f"{m.group(1)}-A{m.group(2)}" if m else (str(text or "").strip() or n)


def extract_gd_reg(path: Path) -> str:
    """Đọc TÀU VNAxxx trong file GD (ưu tiên ô cạnh chữ TÀU)."""
    from openpyxl import load_workbook

    wb = load_workbook(path, data_only=True, read_only=True)
    near: list[str] = []
    all_regs: list[str] = []
    try:
        for ws in wb.worksheets:
            for row in ws.iter_rows(max_row=120, max_col=24, values_only=True):
                texts = [str(c).strip() for c in row if c not in (None, "")]
                if not texts:
                    continue
                joined = " ".join(texts)
                hits = [pretty_reg(m.group(0)) for m in RE_AC.finditer(joined)]
                all_regs.extend(hits)
                if any(RE_TAU.search(t) for t in texts):
                    near.extend(hits)
    finally:
        wb.close()
    if near:
        return near[0]
    uniq = list(dict.fromkeys(normalize_reg(x) for x in all_regs if x))
    return pretty_reg(uniq[0]) if uniq else ""


def _gendec_folders(ns) -> list:
    """Folder GENDEC: ưu tiên hộp chung OMC ('9. GENDEC'), rồi mail cá nhân."""
    found = []
    for store in ns.Stores:
        try:
            root = store.GetRootFolder()
        except Exception:
            continue
        stack = [root]
        while stack:
            folder = stack.pop()
            try:
                name = str(folder.Name or "")
            except Exception:
                continue
            if FOLDER_NAME.casefold() in name.casefold():
                found.append(folder)
            try:
                stack.extend(list(folder.Folders))
            except Exception:
                pass
    # Ưu tiên folder có số (9. GENDEC — hộp chung) lên trước.
    found.sort(key=lambda f: 0 if re.match(r"\d", str(f.Name or "")) else 1)
    return found


def download_gd(flight: str, dest: Path, say) -> Path:
    """Tìm mail GENDEC có số hiệu, tải file XLSX đính kèm."""
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        ns = outlook.GetNamespace("MAPI")
        folders = _gendec_folders(ns)
        if not folders:
            raise RuntimeError("không thấy thư mục GENDEC trong Outlook")
        since = datetime.now() - timedelta(hours=LOOKBACK_H)
        want = digits_of(flight)
        for folder in folders:
            say(f"· thư mục Outlook: {folder.Name}")
            items = folder.Items
            items.Sort("[ReceivedTime]", True)
            for mail in items:
                try:
                    if mail.ReceivedTime.replace(tzinfo=None) < since:
                        break
                    subj = str(mail.Subject or "")
                    body = str(getattr(mail, "Body", "") or "")[:2000]
                    if not (contains_flight(subj, want) or contains_flight(body, want)):
                        continue
                    atts = mail.Attachments
                    for i in range(1, atts.Count + 1):
                        att = atts.Item(i)
                        name = str(att.FileName or "")
                        if not name.lower().endswith((".xlsx", ".xlsm", ".xls")):
                            continue
                        if not contains_flight(name, want) and not contains_flight(subj, want):
                            continue
                        say(f"· thấy {name}")
                        dest.mkdir(parents=True, exist_ok=True)
                        path = dest / name
                        att.SaveAsFile(str(path))
                        return path
                except Exception:
                    continue
        raise RuntimeError(f"không thấy GD {want} trong {FOLDER_NAME} ({LOOKBACK_H // 24} ngày qua)")
    finally:
        pythoncom.CoUninitialize()


def print_sheets(path: Path, printer: str, say) -> None:
    """In qua Excel COM đúng PRINT_PLAN của tool gốc."""
    import pythoncom
    import win32com.client

    win_name = resolve_printer(printer)
    if not win_name:
        raise RuntimeError("không tìm thấy máy in (RICOH)")
    pythoncom.CoInitialize()
    excel = None
    try:
        excel = win32com.client.DispatchEx("Excel.Application")
        excel.Visible = False
        excel.DisplayAlerts = False
        try:
            excel.ActivePrinter = win_name
        except Exception:
            import win32print
            old = win32print.GetDefaultPrinter()
            win32print.SetDefaultPrinter(win_name)
            say(f"· đổi tạm máy in mặc định sang {win_name}")
        say(f"· máy in: {win_name}")
        wb = excel.Workbooks.Open(str(path), ReadOnly=True)
        try:
            for idx, copies, orient in PRINT_PLAN:
                if idx > wb.Worksheets.Count:
                    continue
                say(f"· in sheet {idx} × {copies} ({orient})")
                ws = wb.Worksheets(idx)
                ws.PageSetup.Orientation = 1 if orient == "portrait" else 2
                for copy_no in range(1, copies + 1):
                    ws.PrintOut(Copies=1, ActivePrinter=win_name)
                    say(f"  · sheet {idx}: đã gửi bản {copy_no}/{copies}")
        finally:
            wb.Close(SaveChanges=False)
    finally:
        if excel is not None:
            excel.Quit()
        pythoncom.CoUninitialize()


def _has_d() -> bool:
    try:
        return Path("D:/").exists()
    except OSError:
        return False


def _fix_drive(p) -> Path:
    r"""Máy không có ổ D thì mọi đích D:\... chuyển sang C:\... (giữ nguyên thư mục con)."""
    s = str(p or "")
    if s[:2].upper() == "D:" and not _has_d():
        s = "C:" + s[2:]
    return Path(s)


def _patch_config_drive(config) -> None:
    """config.get_path / ensure_d_folder của tool gốc cứng ổ D — bọc lại để rơi về ổ C."""
    if getattr(config, "_drive_patched", False):
        return
    gp = getattr(config, "get_path", None)
    if callable(gp):
        def get_path(*a, **k):
            return _fix_drive(gp(*a, **k))
        config.get_path = get_path
    ed = getattr(config, "ensure_d_folder", None)
    if callable(ed):
        def ensure_d_folder(*a, **k):
            try:
                res = ed(*a, **k)
            except Exception:
                res = gp(*a, **k) if callable(gp) else Path("C:/")
            out = _fix_drive(res)
            out.mkdir(parents=True, exist_ok=True)
            return out
        config.ensure_d_folder = ensure_d_folder
    config._drive_patched = True


def do_gd_print(payload: dict, say) -> dict:
    flight = str(payload.get("flight") or "")
    crew_regs = [str(r) for r in payload.get("crew_regs") or []]
    printer = str(payload.get("printer") or "")
    dest = _fix_drive(str(payload.get("dest") or "D:/GD"))

    say(f"▶ tìm GD {flight} trong {FOLDER_NAME}")
    path = download_gd(flight, dest, say)
    gd_reg = extract_gd_reg(path)
    say(f"· file: {path.name}")
    say(f"· tàu GD: {gd_reg or '—'}")
    say("· tàu crewlist: " + (" / ".join(crew_regs) or "—"))
    if gd_reg and crew_regs:
        if any(normalize_reg(gd_reg) == normalize_reg(r) for r in crew_regs):
            say(f"✓ tàu khớp: {gd_reg}")
        else:
            raise RuntimeError(
                f"tàu lệch — GD {gd_reg} nhưng crewlist {' / '.join(crew_regs)}. Không in."
            )
    print_sheets(path, printer, say)
    say("✓ đã gửi máy in")
    return {"gd_reg": gd_reg, "file": path.name}


# --------------------------------------------------------------------------- #
# Các lệnh khác
# --------------------------------------------------------------------------- #

def do_save_file(payload: dict, say) -> dict:
    d = _fix_drive(str(payload.get("dir") or "D:/"))
    name = str(payload.get("name") or "file.bin")
    raw = base64.b64decode(str(payload.get("data_b64") or ""))
    d.mkdir(parents=True, exist_ok=True)
    path = d / name
    path.write_bytes(raw)
    say(f"· đã ghi {path} ({len(raw):,} bytes)")
    return {"path": str(path)}


def do_pick_folder(payload: dict, say) -> dict:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        chosen = filedialog.askdirectory(title=str(payload.get("title") or "Chọn thư mục"), parent=root)
    finally:
        root.destroy()
    return {"path": chosen or ""}


def _find_tool_dir() -> Path:
    """Thư mục tool gốc (chứa atc_check.py, config.py) trên máy công ty.
    Tự tìm; nếu không thấy thì hiện hộp thoại chọn thư mục MỘT lần rồi ghi nhớ."""
    cfg_dir = str(_CFG.get("tool_dir") or "").strip()
    bundled = Path(__file__).resolve().parent / "tool"
    cands = [bundled] if (bundled / "atc_check.py").is_file() else []
    cands += [Path(cfg_dir)] if cfg_dir else []
    cands += [
        Path("C:/DispatchBoard"), Path("D:/DispatchBoard"),
        Path.home() / "DispatchBoard", Path.home() / "Desktop" / "DispatchBoard",
    ]
    for c in cands:
        if (c / "atc_check.py").is_file():
            return c
    # Hỏi người dùng một lần bằng hộp thoại chọn thư mục, rồi ghi nhớ.
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox
        root = tk.Tk(); root.withdraw(); root.attributes("-topmost", True)
        messagebox.showinfo(
            "Trợ lý Dispatch Board",
            "Chọn thư mục tool gốc (thư mục chứa file atc_check.py / config.py).\n"
            "Chỉ phải chọn MỘT lần — trợ lý sẽ ghi nhớ.",
            parent=root,
        )
        chosen = filedialog.askdirectory(title="Chọn thư mục tool gốc (DispatchBoard)", parent=root)
        root.destroy()
        if chosen and (Path(chosen) / "atc_check.py").is_file():
            _save_config(tool_dir=chosen)
            _CFG["tool_dir"] = chosen
            return Path(chosen)
    except Exception:
        pass
    raise RuntimeError(
        "không tìm thấy thư mục tool gốc (atc_check.py) — sửa \"tool_dir\" trong "
        "file pc_agent_config.json cạnh script trỏ tới thư mục DispatchBoard"
    )


def do_aviweb_check(payload: dict, say) -> dict:
    """Check trạng thái FPL trên AviWeb bằng Chrome thật (Selenium) — chạy đúng
    code atc_check.py của tool gốc, tài khoản lấy từ config.py trên máy này."""
    tool_dir = _find_tool_dir()
    if str(tool_dir) not in sys.path:
        sys.path.insert(0, str(tool_dir))
    os.chdir(tool_dir)  # config.py / profile Chrome của tool gốc dùng đường dẫn tương đối
    import atc_check  # noqa: E402  (module của tool gốc)

    callsigns = [str(c) for c in payload.get("callsigns") or []]
    headless = bool(payload.get("headless", True))
    say(f"· dùng tool gốc tại {tool_dir}")

    def on_progress(d: dict) -> None:
        if d.get("type") == "line" and d.get("text"):
            say(str(d["text"]), str(d.get("cls") or ""))

    res = atc_check.check_flights(callsigns, headless=headless, on_progress=on_progress)
    return {
        "ok": res.ok,
        "failed": res.failed,
        "results": [
            {"callsign": r.callsign, "status": r.status, "flight_time": r.flight_time,
             "reg": r.reg, "dof": r.dof, "error": r.error, "ok": r.ok}
            for r in res.results
        ],
    }


def do_aviweb_submit(payload: dict, say) -> dict:
    """Gửi FPL lên AviWeb bằng Chrome thật — chạy atcfpl.py của tool gốc."""
    import inspect
    tool_dir = _find_tool_dir()
    if str(tool_dir) not in sys.path:
        sys.path.insert(0, str(tool_dir))
    os.chdir(tool_dir)
    import atcfpl  # noqa: E402  (module của tool gốc)

    name = str(payload.get("name") or "ATC.txt")
    dest = tool_dir / "data" / "atc"
    dest.mkdir(parents=True, exist_ok=True)
    fpath = dest / name
    fpath.write_text(str(payload.get("text") or ""), encoding="utf-8")
    say(f"· file ATC: {fpath}")

    def on_progress(d) -> None:
        if isinstance(d, dict):
            if d.get("text"):
                say(str(d["text"]), str(d.get("cls") or ""))
        elif d:
            say(str(d))

    fn = None
    for cand in ("submit_file", "submit_atc_file", "run_file", "submit_fpl_file",
                 "submit_all", "run_submit", "submit", "run", "main"):
        f = getattr(atcfpl, cand, None)
        if callable(f):
            fn = f
            break
    if fn is None:
        raise RuntimeError("atcfpl.py không có hàm gửi FPL quen thuộc — gửi file atcfpl.py cho Lovable để nối đúng")

    values = {
        "path": str(fpath), "file": str(fpath), "file_path": str(fpath), "filepath": str(fpath),
        "atc_file": str(fpath), "headless": bool(payload.get("headless", True)),
        "limit": payload.get("limit"), "only_labels": payload.get("only_labels") or None,
        "on_progress": on_progress, "progress": on_progress, "cancel": _NoCancel(),
        "cancel_event": _NoCancel(),
    }
    sig = inspect.signature(fn)
    args, kwargs = [], {}
    for pname, prm in sig.parameters.items():
        if pname in values:
            if prm.kind == prm.POSITIONAL_ONLY:
                args.append(values[pname])
            else:
                kwargs[pname] = values[pname]
        elif prm.default is prm.empty and prm.kind in (prm.POSITIONAL_ONLY, prm.POSITIONAL_OR_KEYWORD):
            args.append(str(fpath))
    say(f"· chạy atcfpl.{fn.__name__}()")
    res = fn(*args, **kwargs)

    def g(k, default=None):
        if isinstance(res, dict):
            return res.get(k, default)
        return getattr(res, k, default)

    bad = g("bad") or g("failed_items") or []
    bad = [b if isinstance(b, dict) else {"flight": str(getattr(b, "flight", b))} for b in bad]
    ok = g("ok", 0)
    failed = g("failed", len(bad))
    return {
        "ok": len(ok) if isinstance(ok, (list, tuple)) else int(ok or 0),
        "failed": len(failed) if isinstance(failed, (list, tuple)) else int(failed or 0),
        "bad": bad,
        "pending": list(g("pending") or []),
    }


class _NoCancel:
    """Trợ lý PC chưa có kênh huỷ việc đang chạy từ xa — xem README mục Hạn chế."""

    def is_set(self) -> bool:
        return False


def _fpl_dir() -> Path:
    """Thư mục nhận Excel FPL VER. Tool gốc cứng D:\\FPL nhưng không phải máy
    nào cũng có ổ D — thiếu thì rơi về C:\\FPL."""
    if _has_d():
        return Path(r"D:\FPL")
    return Path(r"C:\FPL")


def _patch_fpl_watch(mod):
    r"""owa_fpl_watch gốc cứng đích D:\FPL — máy không có ổ D thì trỏ sang C:\FPL."""
    fpl = str(_fpl_dir())
    for attr in ("DEST", "DEST_DIR", "FPL_DIR", "EXCEL_DIR", "DEST_EXCEL"):
        cur = str(getattr(mod, attr, "") or "")
        if cur.startswith(("D:", "D:/", "D:\\")):
            try:
                setattr(mod, attr, fpl)
            except Exception:
                pass


def _load_owa_modules():
    """Nạp outlook_web_pib / config từ PC_TOOL_DIR — code gốc y hệt tool Windows."""
    tool_dir = _find_tool_dir()
    if str(tool_dir) not in sys.path:
        sys.path.insert(0, str(tool_dir))
    os.chdir(tool_dir)  # config.py / profile Chrome OWA dùng đường dẫn tương đối
    import config  # noqa: E402  (module của tool gốc)
    _patch_config_drive(config)
    import outlook_web_pib  # noqa: E402  (module của tool gốc)
    # Máy không có ổ D: chuyển mọi đích FPL/Excel sang C:\FPL trước khi watcher chạy.
    fpl = _fpl_dir()
    try:
        fpl.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    for mod in (config, outlook_web_pib):
        for attr in ("EXCEL_DIR", "FPL_DIR", "DEST_DIR", "DEST"):
            cur = str(getattr(mod, attr, "") or "")
            if cur.startswith(("D:", "D:/", "D:\\")):
                try:
                    setattr(mod, attr, str(fpl))
                except Exception:
                    pass
    return config, outlook_web_pib


def do_owa_login(payload: dict, say) -> dict:
    """Mở Chrome Outlook Web thật (Selenium) — đúng code start_owa_login() của
    tool gốc, chạy trên máy công ty vì Worker không mở được trình duyệt."""
    _, outlook_web_pib = _load_owa_modules()
    cancel = _NoCancel()

    # Web gửi kèm tài khoản OWA trong payload (kênh job có token) — ưu tiên
    # hơn credentials.json trên máy để auto-login không phụ thuộc file local.
    creds = None
    u = str(payload.get("user") or "").strip()
    p = str(payload.get("pass") or "")
    if u and p:
        creds = (u, p)

    say("▶ Mở Chrome Outlook Web — auto-login nếu đã lưu owa_username/owa_password "
        "(MFA thì xác nhận tay).")
    try:
        outlook_web_pib.ensure_session(
            timeout_s=420.0, on_status=lambda m: say(m), cancel=cancel,
            creds=creds,
        )
    except outlook_web_pib.OwaCancelled as exc:
        say(f"— {exc}")
        return {"logged_in": False, "owa_state": "stale", "cancelled": True}
    say("✓ Đã xác nhận Outlook Web đọc được mailbox.")
    try:
        import owa_fpl_watch  # noqa: E402  (module của tool gốc)
        _patch_fpl_watch(owa_fpl_watch)
        if owa_fpl_watch.ensure_running():
            say("▶ Theo dõi OMC / FLIGHT PLAN mỗi 15 giây.")
        else:
            say("⚠ Phiên Outlook đã có nhưng chưa bật được FPL watch.", "bad")
    except Exception as exc:
        say(f"⚠ FPL watch: {exc}", "bad")
    return {"logged_in": True, "owa_state": "healthy"}


def do_owa_fpl_watch(payload: dict, say) -> dict:
    """Trạng thái watcher OMC / FLIGHT PLAN — đúng owa_fpl_watch.status() gốc."""
    _load_owa_modules()
    import owa_fpl_watch  # noqa: E402  (module của tool gốc)
    _patch_fpl_watch(owa_fpl_watch)
    after = int(payload.get("after") or 0)
    # Trợ lý vừa khởi động lại thì số thứ tự dòng log về 0 — web còn giữ số cũ
    # nên không thấy dòng nào. Số "after" lớn hơn hiện tại → gửi lại từ đầu.
    if after > int(getattr(owa_fpl_watch, "_seq", 0) or 0):
        after = 0
    st = owa_fpl_watch.status(after=after)
    _sync_fpl_dir(st)
    # Web không đọc được ổ máy công ty: gửi kèm file Excel FPL VER (old/new)
    # để web lưu vào kho Excel, tab "Dữ liệu thay đổi theo ver" mới so được.
    try:
        ver = st.get("ver") or {}
        import config  # noqa: E402
        dirs = [Path(st.get("dest_excel") or "data/excel"), Path(st.get("dest") or "."), Path(getattr(config, "EXCEL_DIR", "") or "data/excel"), Path("data/excel"), _fpl_dir()]
        ups = []
        for name in {ver.get("old") or "", ver.get("new") or ""}:
            if not name or name in _SENT_VER:
                continue
            for d in dirs:
                f = d / name
                if f.is_file() and f.stat().st_size < 25 * 1024 * 1024:
                    ups.append({"name": name, "b64": base64.b64encode(f.read_bytes()).decode()})
                    _SENT_VER.add(name)
                    break
        if ups:
            st["uploads"] = ups
    except Exception as e:  # không làm hỏng lượt dò
        st.setdefault("lines", []).append({"text": f"⚠ Không gửi được file FPL VER lên web: {e}", "cls": "bad"})
    return st


_SENT_VER: set = set()
_SYNCED_FPL: set = set()


def _sync_fpl_dir(st: dict) -> None:
    r"""Watcher gốc chỉ copy sang D:\FPL lúc tải mới. Nếu FPL hôm nay đã nằm sẵn
    trong data/excel (tool gốc tải trước đó, hoặc lúc ấy không có ổ D) thì thư mục
    FPL vẫn trống — chép bù các file FPL VER (cũ/mới + mọi FPL hôm nay) sang đó."""
    try:
        import config  # noqa: E402
        dest = _fpl_dir()
        dest.mkdir(parents=True, exist_ok=True)
        src = Path(st.get("dest_excel") or getattr(config, "EXCEL_DIR", "") or "data/excel")
        if not src.is_dir() or src.resolve() == dest.resolve():
            return
        ver = st.get("ver") or {}
        names = {ver.get("old") or "", ver.get("new") or ""}
        today = time.strftime("%Y-%m-%d")
        for f in src.glob("*.xls*"):
            if re.search(r"FLIGHT\s*PLAN|\bFPL\b", f.name, re.I) and \
                    time.strftime("%Y-%m-%d", time.localtime(f.stat().st_mtime)) == today:
                names.add(f.name)
        copied = []
        for name in names:
            if not name:
                continue
            f, t = src / name, dest / name
            if not f.is_file() or (t.is_file() and t.stat().st_size == f.stat().st_size):
                continue
            shutil.copy2(f, t)
            copied.append(name)
        for name in copied:
            if name in _SYNCED_FPL:
                continue
            _SYNCED_FPL.add(name)
            st.setdefault("lines", []).append({"text": f"✓ chép {name} → {dest}", "cls": "ok"})
            log(f"  ✓ chép {name} → {dest}")
    except Exception as e:
        st.setdefault("lines", []).append({"text": f"⚠ Không chép được FPL sang {_fpl_dir()}: {e}", "cls": "bad"})


def do_owa_pib(payload: dict, say) -> dict:
    """Tải PIB qua Outlook Web — cùng logic start_pib_download() của tool gốc,
    dùng outlook_web_pib.download() thật (Selenium + Outlook REST)."""
    config, outlook_web_pib = _load_owa_modules()

    want = [str(c).strip().upper() for c in (payload.get("callsigns") or []) if str(c).strip()]
    if not want:
        raise RuntimeError("Chưa có số hiệu chuyến bay nào trong cột PIB/WX.")
    hours = float(payload.get("hours") or 10.0)
    overwrite = bool(payload.get("overwrite"))
    cancel = _NoCancel()

    events: list[dict] = []

    def emit(ev: dict) -> None:
        events.append(ev)

    def line(text: str, cls: str = "") -> None:
        emit({"type": "line", "text": text, "cls": cls})
        say(text, cls)

    def digits(s: str) -> str:
        return re.sub(r"\D", "", str(s or ""))

    back = {digits(c): c for c in want if digits(c)}

    def to_input(cs: str) -> str:
        return back.get(digits(cs), cs)

    now = datetime.now(timezone.utc)
    lo, hi = now - timedelta(hours=hours), now + timedelta(hours=hours)
    line(
        f"▶ {len(want)} chuyến · cửa sổ ±{hours:g}h: "
        f"{lo.astimezone():%d/%m %H:%M} → {hi.astimezone():%d/%m %H:%M} LT"
        f"  (= {lo:%d/%m %H:%M} → {hi:%d/%m %H:%M} UTC)"
    )

    seen: set[str] = set()

    def progress(text: str, cs: str = "") -> None:
        if text in seen:
            return
        seen.add(text)
        emit({"type": "line", "text": f"  {text}", "found": to_input(cs)})

    def auth_status(text: str) -> None:
        lower = text.lower()
        if "mfa" in lower or "đăng nhập trên" in lower:
            state = "interactive_required"
        elif "sẵn sàng" in lower:
            state = "healthy"
        elif "kiểm tra" in lower:
            state = "checking"
        else:
            state = "refreshing"
        emit({"type": "owa_state", "text": text, "state": state})
        line(f"· {text}")

    def run_owa(*, force: bool):
        token = outlook_web_pib.ensure_fresh_token(
            timeout_s=420.0, on_status=auth_status, cancel=cancel, force=force,
        )
        line("· nguồn: Outlook Web — PIB chung OMC (SGN/HAN/DAD), thiếu thì mail cá nhân")
        return outlook_web_pib.download(
            token, since=lo, until=hi, callsigns=set(want),
            overwrite=overwrite, on_progress=progress,
            out_dir=config.get_path("pibwx"), cancel=cancel,
        )

    owa_failure: Exception | None = None
    auth_failed = False
    try:
        res = run_owa(force=False)
    except outlook_web_pib.OwaCancelled:
        return {"cancelled": True, "ok": 0, "skipped": 0, "failed": 0, "missing": [],
                "source": "none", "events": events}
    except outlook_web_pib.OwaAuthError as exc:
        line(f"⚠ Phiên Outlook Web đổi giữa lúc tải: {exc}", "bad")
        emit({"type": "owa_state", "text": "Phiên Outlook Web hết hiệu lực", "state": "stale"})
        outlook_web_pib.invalidate_session()
        auth_failed = True
        try:
            line("· Tự làm mới phiên và thử lại một lần…")
            res = run_owa(force=True)
        except outlook_web_pib.OwaCancelled:
            return {"cancelled": True, "ok": 0, "skipped": 0, "failed": 0, "missing": [],
                    "source": "none", "events": events}
        except Exception as retry_exc:
            owa_failure = retry_exc
    except Exception as exc:
        owa_failure = exc

    source = "owa"
    if owa_failure is None:
        saved, skipped = len(res.new), len(res.saved) - len(res.new)
        errors = list(res.errors)
        got = set(res.by_callsign)
        emit({"type": "owa_state", "text": "Outlook Web sẵn sàng", "state": "healthy"})
        try:
            import owa_fpl_watch  # noqa: E402  (module của tool gốc)
            _patch_fpl_watch(owa_fpl_watch)
            owa_fpl_watch.ensure_running()
        except Exception as exc:
            say(f"· không bật được tự tải FPL sau PIB: {exc}")
    else:
        if isinstance(owa_failure, outlook_web_pib.OwaAuthError):
            auth_failed = True
            outlook_web_pib.invalidate_session()
        emit({"type": "owa_state", "text": str(owa_failure),
              "state": "stale" if auth_failed else "error"})
        line(f"✗ Outlook Web không khả dụng: {owa_failure}", "bad")
        line("· Dùng Outlook desktop (cache offline)…")
        try:
            import outlook_pib  # noqa: E402  (module của tool gốc)
            res = outlook_pib.download(
                days=hours / 24.0, callsigns=set(want), overwrite=overwrite,
                out_dir=config.get_path("pibwx"),
            )
            saved, skipped = len(res.new), len(res.saved) - len(res.new)
            errors = list(res.errors)
            got = set(res.by_callsign)
            source = "outlook_desktop"
            seen_names: set[str] = set()
            for f in res.saved:
                if f.path.name in seen_names:
                    continue
                seen_names.add(f.path.name)
                emit({
                    "type": "line",
                    "text": f"  {'· đã có sẵn: ' if f.skipped else '✓ tải mới: '}{f.path.name}",
                    "found": to_input(f.callsign),
                })
        except Exception as exc2:
            line(f"✗ không đọc được Outlook desktop: {exc2}", "bad")
            line("✗ Không tải được PIB vì nguồn Outlook không khả dụng.", "bad")
            return {"ok": 0, "skipped": 0, "failed": len(want), "missing": want,
                    "auth_failed": auth_failed, "source": "none", "events": events}

    got_d = {digits(c) for c in got}
    missing = [c for c in want if digits(c) not in got_d]
    for c in missing:
        line(f"✗ {c}: không thấy PIB trong cửa sổ ±{hours:g}h", "bad")
    for e in errors[:10]:
        line(f"✗ {e}", "bad")

    manifest = [
        {"callsign": f.callsign, "filename": f.path.name,
         "new": not f.skipped, "source": source}
        for f in res.saved
        if f.path.is_file() and f.path.stat().st_size > 0
    ]
    manifest = list({x["filename"].casefold(): x for x in manifest}.values())
    return {
        "ok": saved, "skipped": skipped, "failed": len(missing), "missing": missing,
        "files": manifest, "source": source, "auth_failed": auth_failed,
        "folder": str(config.get_path("pibwx")), "events": events,
    }


def _owa_driver(outlook_web_pib):
    """Tìm driver Selenium Chrome OWA mà module gốc đang giữ (thử vài tên biến
    thường gặp vì không đọc được source gốc)."""
    for attr in ("driver", "_driver", "DRV", "drv", "_DRV", "get_driver", "current_driver"):
        d = getattr(outlook_web_pib, attr, None)
        if callable(d):
            try:
                d = d()
            except Exception:
                d = None
        if d is not None and hasattr(d, "get_cookies"):
            return d
    return None


def do_owa_draft(payload: dict, say) -> dict:
    """Soạn nháp trong HỘP THƯ CHUNG omc@vietjetair.com trên Outlook Web (OWA),
    đúng hành vi tool gốc — KHÔNG mở Outlook desktop.

    Cách làm: dùng phiên Chrome OWA đã đăng nhập (Selenium) để lấy cookie +
    X-OWA-CANARY, rồi gọi OWA REST API tạo draft trong mailbox chung
    (POST /api/v2.0/users/omc@vietjetair.com/messages + FileAttachment).
    Cuối cùng mở thẻ Drafts của hộp thư chung trên Chrome để người dùng
    kiểm tra và bấm Send tay. Không gửi thư."""
    config, outlook_web_pib = _load_owa_modules()
    cancel = _NoCancel()

    subject = str(payload.get("subject") or "")
    body = str(payload.get("body") or "")
    to = str(payload.get("to") or "")
    cc = str(payload.get("cc") or "")
    attachments = payload.get("attachments") or []
    mailbox = str(payload.get("mailbox") or getattr(config, "SHARED_MAILBOX", "") or "omc@vietjetair.com")

    say("▶ Kiểm tra phiên Outlook Web…")
    outlook_web_pib.ensure_session(timeout_s=420.0, on_status=lambda m: say(m), cancel=cancel)
    driver = _owa_driver(outlook_web_pib)
    if driver is None:
        raise RuntimeError("Không tìm thấy cửa sổ Chrome Outlook Web của tool gốc.")

    cookies = {c["name"]: c["value"] for c in driver.get_cookies()}
    canary = cookies.get("X-OWA-CANARY", "")
    sess = requests.Session()
    sess.headers.update({
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json",
        "X-OWA-CANARY": canary,
        "User-Agent": "Mozilla/5.0",
    })
    base = "https://outlook.office.com/api/v2.0/users/" + mailbox

    msg = {
        "Subject": subject,
        "Body": {"ContentType": "Text", "Content": body},
    }
    if to:
        msg["ToRecipients"] = [{"EmailAddress": {"Address": a.strip()}} for a in to.split(";") if a.strip()]
    if cc:
        msg["CcRecipients"] = [{"EmailAddress": {"Address": a.strip()}} for a in cc.split(";") if a.strip()]

    r = sess.post(base + "/messages", json=msg, cookies=cookies, timeout=60)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"OWA từ chối tạo nháp trong {mailbox}: HTTP {r.status_code} — {r.text[:300]}")
    draft_id = r.json().get("Id")
    say(f"✓ nháp trong hộp thư chung {mailbox}: {subject}")

    for i, att in enumerate(attachments):
        name = str((att or {}).get("name") or f"attachment_{i}.txt")
        data_b64 = str((att or {}).get("data_b64") or "")
        ra = sess.post(
            f"{base}/messages/{draft_id}/attachments",
            json={"@odata.type": "#Microsoft.OutlookServices.FileAttachment",
                  "Name": name, "ContentBytes": data_b64},
            cookies=cookies, timeout=120,
        )
        if ra.status_code not in (200, 201):
            raise RuntimeError(f"OWA từ chối đính kèm {name}: HTTP {ra.status_code} — {ra.text[:300]}")
        say(f"· đính kèm {name}")

    try:
        driver.get(f"https://outlook.office.com/mail/{mailbox}/drafts")
        say("▶ Đã mở thư mục Nháp của hộp thư chung trên Chrome.")
    except Exception:
        say("· không mở được thẻ Drafts — nháp vẫn nằm trong hộp thư chung.")
    return {"subject": subject, "mailbox": mailbox, "draft_id": draft_id}


def do_outlook_draft(payload: dict, say) -> dict:
    """Soạn nháp Outlook desktop (COM) — ATC/EZFW hoặc mail khác từ web, không
    gửi. Tương đương đoạn tạo MailItem trong tool gốc (atc_ezfw / outlook
    draft): CreateItem(0) = olMailItem, .Attachments.Add() file tạm giải mã từ
    base64, rồi .Save() (và .Display() nếu máy có màn hình) — người dùng tự
    điền người nhận và bấm Send trên Outlook thật."""
    import pythoncom
    import win32com.client

    subject = str(payload.get("subject") or "")
    body = str(payload.get("body") or "")
    to = str(payload.get("to") or "")
    cc = str(payload.get("cc") or "")
    html = payload.get("html")
    attachments = payload.get("attachments") or []

    pythoncom.CoInitialize()
    tmp_dir = Path(os.environ.get("TEMP", ".")) / "pc-agent-draft"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_paths: list[Path] = []
    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        mail = outlook.CreateItem(0)  # olMailItem
        mail.Subject = subject
        if html:
            mail.HTMLBody = str(html)
        else:
            mail.Body = body
        if to:
            mail.To = to
        if cc:
            mail.CC = cc
        for i, att in enumerate(attachments):
            name = str((att or {}).get("name") or f"attachment_{i}.txt")
            data_b64 = str((att or {}).get("data_b64") or "")
            raw = base64.b64decode(data_b64) if data_b64 else b""
            path = tmp_dir / f"{i}_{name}"
            path.write_bytes(raw)
            tmp_paths.append(path)
            mail.Attachments.Add(str(path))
            say(f"· đính kèm {name} ({len(raw):,} bytes)")
        mail.Save()
        try:
            mail.Display(False)
        except Exception:
            say("· không mở được cửa sổ soạn thư (máy không có màn hình?) — nháp vẫn nằm trong Drafts")
        say(f"✓ nháp Outlook: {subject}")
        return {"subject": subject}
    finally:
        pythoncom.CoUninitialize()
        for p in tmp_paths:
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass

def _find_pdf(obj, depth=0):
    """Tìm file PDF / bytes PDF trong kết quả trả về của module gốc."""
    if depth > 4 or obj is None:
        return None
    if isinstance(obj, (bytes, bytearray)) and bytes(obj[:4]) == b"%PDF":
        return bytes(obj)
    if isinstance(obj, (str, Path)):
        try:
            f = Path(obj)
            if f.suffix.lower() == ".pdf" and f.is_file():
                return f
        except Exception:
            return None
        return None
    if isinstance(obj, dict):
        for k in ("pdf", "path", "file", "pdf_path", "saved", "data", "content"):
            if k in obj:
                r = _find_pdf(obj[k], depth + 1)
                if r is not None:
                    return r
        vals = obj.values()
    elif isinstance(obj, (list, tuple, set)):
        vals = obj
    else:
        vals = [getattr(obj, a) for a in ("path", "pdf", "file", "content", "data") if hasattr(obj, a)]
    for v in vals:
        r = _find_pdf(v, depth + 1)
        if r is not None:
            return r
    return None


def _meta(obj, *keys):
    if isinstance(obj, dict):
        for k in keys:
            if obj.get(k):
                return str(obj[k])
    for k in keys:
        v = getattr(obj, k, None)
        if v:
            return str(v)
    if isinstance(obj, (list, tuple)):
        for v in obj:
            m = _meta(v, *keys)
            if m:
                return m
    return ""


def do_defect_pdf(payload: dict, say) -> dict:
    """Tải PDF "AIRCRAFT TECHNICAL SUMMARY" hôm nay qua Outlook Web — gọi đúng
    defect_summary.py của tool gốc; web tự đọc PDF thành bảng Tàu/Defect."""
    import inspect
    _, outlook_web_pib = _load_owa_modules()
    import defect_summary  # noqa: E402  (module của tool gốc)
    say("▶ Tìm mail AIRCRAFT TECHNICAL SUMMARY hôm nay…")
    fn = getattr(defect_summary, "fetch_today_pdf", None) or getattr(defect_summary, "pull_today")
    params = inspect.signature(fn).parameters
    kw = {}
    if "on_status" in params:
        kw["on_status"] = lambda m: say(str(m))
    if "on_progress" in params:
        kw["on_progress"] = lambda *a: say(" ".join(map(str, a)))
    args = []
    first = next(iter(params), "")
    if first in ("token", "tok", "access_token") or "token" in params:
        token = outlook_web_pib.ensure_fresh_token(timeout_s=420.0, on_status=lambda m: say(m), cancel=_NoCancel(), force=False)
        if first in ("token", "tok", "access_token"):
            args.append(token)
        else:
            kw["token"] = token
    res = fn(*args, **kw)
    pdf = _find_pdf(res)
    if pdf is None:
        raise RuntimeError(f"Không thấy file PDF defect summary trong kết quả: {str(res)[:300]}")
    if isinstance(pdf, Path):
        name, data = pdf.name, pdf.read_bytes()
    else:
        name, data = (_meta(res, "name", "filename") or "defect_summary.pdf"), pdf
    say(f"✓ Lấy được {name}")
    return {
        "name": name, "b64": base64.b64encode(data).decode(),
        "subject": _meta(res, "subject", "Subject"),
        "sent": _meta(res, "sent", "sent_at", "SentDateTime", "when"),
        "slot": _meta(res, "slot"),
    }


RE_EFB = re.compile(r"EFB-[A-Z0-9]+(?:[/.-][A-Z0-9]+)*", re.I)


def _efb_via_owa_session(say) -> dict | None:
    """Dùng phiên Outlook Web (Chrome) đã đăng nhập sẵn — không mở Outlook PC."""
    try:
        config, ow = _load_owa_modules()
        token = ow._load_cached_token() or ow._load_cached_token(ow.MAIL_TOKEN_CACHE)
        if not token:
            raise RuntimeError("không có token cache")
    except Exception as e:
        say(f"· chưa có phiên Outlook Web ({e})")
        return None
    s = ow._rest_session(token)
    boxes = [getattr(config, "OMC_SHARED_MAILBOX", "") or "", ""]
    for box in boxes:
        label = box or "hộp cá nhân"
        hits = []
        # $search quét MỌI thư mục (mail EFB có thể bị rule chuyển khỏi Inbox).
        queries = [
            ("/messages", {"$search": '"subject:EFB"', "$top": "50",
                           "$select": "Subject,BodyPreview,ReceivedDateTime"}),
            ("/mailfolders/inbox/messages", {"$orderby": "ReceivedDateTime desc", "$top": "200",
                           "$select": "Subject,BodyPreview,ReceivedDateTime"}),
        ]
        for path, params in queries:
            try:
                r = s.get(ow.rest_root(box) + path, params=params, timeout=30)
            except Exception as e:
                say(f"· lỗi đọc Outlook Web ({label}): {e}")
                continue
            if r.status_code != 200:
                say(f"· Outlook Web {label} {path}: HTTP {r.status_code} {r.text[:160]}")
                continue
            vals = r.json().get("value", [])
            say(f"· {label} {path}: {len(vals)} mail")
            for m in vals:
                subj = str(m.get("Subject") or "")
                hit = RE_EFB.search(subj) or (
                    "efb" in subj.casefold() and RE_EFB.search(str(m.get("BodyPreview") or "")))
                if hit:
                    hits.append((str(m.get("ReceivedDateTime") or ""), hit.group(0), subj))
            if hits:
                break
        if hits:
            hits.sort(reverse=True)
            when, val, subj = hits[0]
            say(f"✓ Mã EFB mới nhất (Outlook Web, {label}): {val}")
            return {"value": val, "subject": subj, "when": when}
        say(f"· không thấy mail EFB trong {label}")
    return None


def do_owa_efb(payload: dict, say) -> dict:
    """Đọc mã EFB mới nhất từ mail EFB hộp thư chung OMC. Ưu tiên phiên
    Outlook Web đã đăng nhập; chỉ dùng Outlook desktop (COM) khi không có."""
    say("▶ Tìm mail EFB qua phiên Outlook Web đã đăng nhập...")
    got = _efb_via_owa_session(say)
    if got:
        return got
    if not payload.get("allow_desktop"):
        raise RuntimeError("Không tìm thấy mail EFB qua Outlook Web (xem các dòng · ở trên). Có thể điền tay ô EFB.")
    import pythoncom
    import win32com.client

    say("▶ Tìm mail EFB mới nhất trong Outlook...")
    pythoncom.CoInitialize()
    try:
        outlook = win32com.client.Dispatch("Outlook.Application")
        ns = outlook.GetNamespace("MAPI")
        # Duyệt mọi store; ưu tiên thư mục có chữ EFB, sau đó tới Inbox.
        # Lưu ý: duyệt ns.Stores có thể văng lỗi OLE khi Outlook chưa cấu hình
        # xong tài khoản — khi đó quay về hộp thư mặc định (Inbox).
        efb_folders, inboxes = [], []
        stores = []
        try:
            count = ns.Stores.Count
            for i in range(1, count + 1):
                try:
                    stores.append(ns.Stores.Item(i))
                except Exception:
                    pass
        except Exception as e:
            say(f"· không duyệt được danh sách hộp thư ({e}) — dùng Inbox mặc định")
        for store in stores:
            try:
                root = store.GetRootFolder()
            except Exception:
                continue
            stack = [root]
            while stack:
                folder = stack.pop()
                try:
                    name = str(folder.Name or "")
                except Exception:
                    continue
                if "efb" in name.casefold():
                    efb_folders.append(folder)
                elif name.casefold() == "inbox":
                    inboxes.append(folder)
                try:
                    stack.extend(list(folder.Folders))
                except Exception:
                    pass
        if not efb_folders and not inboxes:
            try:
                inboxes.append(ns.GetDefaultFolder(6))  # olFolderInbox
            except Exception as e:
                raise RuntimeError(
                    "Outlook chưa sẵn sàng (chưa đăng nhập/cấu hình tài khoản): "
                    f"{e}"
                )
        for folder in efb_folders + inboxes:
            say(f"· thư mục Outlook: {folder.Name}")
            items = folder.Items
            items.Sort("[ReceivedTime]", True)
            scanned = 0
            for mail in items:
                scanned += 1
                if scanned > 60:
                    break
                try:
                    subj = str(mail.Subject or "")
                except Exception:
                    continue
                if "efb" not in subj.casefold():
                    continue
                body = str(getattr(mail, "Body", "") or "")[:3000]
                m = RE_EFB.search(subj) or RE_EFB.search(body)
                if not m:
                    continue
                when = ""
                try:
                    when = mail.ReceivedTime.isoformat()
                except Exception:
                    pass
                say(f"✓ Mã EFB mới nhất: {m.group(0)} ({subj[:60]})")
                return {"value": m.group(0), "subject": subj, "when": when}
        raise RuntimeError("Không thấy mail EFB nào trong hộp thư chung.")
    finally:
        pythoncom.CoUninitialize()


HANDLERS = {
    "gd_print": do_gd_print,
    "save_file": do_save_file,
    "pick_folder": do_pick_folder,
    "aviweb_check": do_aviweb_check,
    "aviweb_submit": do_aviweb_submit,
    "owa_login": do_owa_login,
    "owa_fpl_watch": do_owa_fpl_watch,
    "owa_pib": do_owa_pib,
    "owa_draft": do_owa_draft,
    "outlook_draft": do_outlook_draft,
    "defect_pdf": do_defect_pdf,
    "owa_efb": do_owa_efb,
}


# --------------------------------------------------------------------------- #
# Vòng lặp chính
# --------------------------------------------------------------------------- #

def post(path: str, body: dict) -> dict:
    r = requests.post(
        BASE_URL + path,
        json=body,
        headers={"x-pc-agent-token": TOKEN},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def main() -> int:
    if not BASE_URL or not TOKEN:
        print("Thiếu PC_AGENT_URL hoặc PC_AGENT_TOKEN — xem README.md")
        return 2
    log(f"Trợ lý PC v{VERSION} — kết nối {BASE_URL}")
    check_paths: list[str] = []
    while True:
        try:
            paths_exist = {"D:\\": _has_d()}
            for p in check_paths:
                try:
                    paths_exist[p] = _fix_drive(p).is_dir()
                except OSError:
                    paths_exist[p] = False
            d = post(POLL_URL, {
                "version": VERSION,
                "printers": list_printers(),
                "paths_exist": paths_exist,
            })
            check_paths = [str(p) for p in d.get("check_paths") or []]
            for job in d.get("jobs") or []:
                jid, kind = job["id"], job["kind"]
                log(f"◆ lệnh {kind} ({jid[:8]})")
                lines: list[dict] = []

                def say(text: str, cls: str = "") -> None:
                    lines.append({"text": text, "cls": cls})
                    log("  " + text)

                handler = HANDLERS.get(kind)
                try:
                    if handler is None:
                        raise RuntimeError(f"trợ lý không biết lệnh {kind!r}")
                    result = handler(job.get("payload") or {}, say)
                    result["lines"] = lines
                    post(REPORT_URL, {"id": jid, "ok": True, "result": result})
                    log(f"✓ xong {kind}")
                except Exception as exc:
                    traceback.print_exc()
                    post(REPORT_URL, {
                        "id": jid, "ok": False,
                        "result": {"error": str(exc), "lines": lines},
                    })
                    log(f"✗ {kind}: {exc}")
        except KeyboardInterrupt:
            return 0
        except Exception as exc:
            log(f"lỗi kết nối: {exc} — thử lại sau 10s")
            time.sleep(10)
            continue
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    sys.exit(main())
