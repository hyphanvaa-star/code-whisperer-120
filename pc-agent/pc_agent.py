# -*- coding: utf-8 -*-
"""Trợ lý PC cho Dispatch Board — chạy trên máy công ty.

Web gửi lệnh (in GD tới máy RICOH, ghi file xuống ổ D:, mở hộp thoại chọn
thư mục); script này nhận lệnh và thực hiện như tool gốc.

Cài đặt (một lần):
    pip install requests pywin32 openpyxl

Chạy:
    set PC_AGENT_URL=https://code-whisperer-834.lovable.app
    set PC_AGENT_TOKEN=<token do quản trị cấp>
    python pc_agent.py
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

VERSION = "1.0"
POLL_URL = "/api/public/pc-agent/poll"
REPORT_URL = "/api/public/pc-agent/report"
POLL_INTERVAL_S = 3

BASE_URL = os.environ.get("PC_AGENT_URL", "").rstrip("/")
TOKEN = os.environ.get("PC_AGENT_TOKEN", "")

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


def do_gd_print(payload: dict, say) -> dict:
    flight = str(payload.get("flight") or "")
    crew_regs = [str(r) for r in payload.get("crew_regs") or []]
    printer = str(payload.get("printer") or "")
    dest = Path(str(payload.get("dest") or "D:/GD"))

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
    d = Path(str(payload.get("dir") or "D:/"))
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
    """Thư mục tool gốc (chứa atc_check.py, config.py) trên máy công ty."""
    env_dir = os.environ.get("PC_TOOL_DIR", "").strip()
    cands = [Path(env_dir)] if env_dir else []
    cands += [
        Path("C:/DispatchBoard"), Path("D:/DispatchBoard"),
        Path.home() / "DispatchBoard", Path.home() / "Desktop" / "DispatchBoard",
    ]
    for c in cands:
        if (c / "atc_check.py").is_file():
            return c
    raise RuntimeError(
        "không tìm thấy thư mục tool gốc (atc_check.py) — đặt biến môi trường "
        "PC_TOOL_DIR trỏ tới thư mục DispatchBoard"
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



class _NoCancel:
    """Trợ lý PC chưa có kênh huỷ việc đang chạy từ xa — xem README mục Hạn chế."""

    def is_set(self) -> bool:
        return False


def _load_owa_modules():
    """Nạp outlook_web_pib / config từ PC_TOOL_DIR — code gốc y hệt tool Windows."""
    tool_dir = _find_tool_dir()
    if str(tool_dir) not in sys.path:
        sys.path.insert(0, str(tool_dir))
    os.chdir(tool_dir)  # config.py / profile Chrome OWA dùng đường dẫn tương đối
    import config  # noqa: E402  (module của tool gốc)
    import outlook_web_pib  # noqa: E402  (module của tool gốc)
    return config, outlook_web_pib


def do_owa_login(payload: dict, say) -> dict:
    """Mở Chrome Outlook Web thật (Selenium) — đúng code start_owa_login() của
    tool gốc, chạy trên máy công ty vì Worker không mở được trình duyệt."""
    _, outlook_web_pib = _load_owa_modules()
    cancel = _NoCancel()

    say("▶ Mở Chrome Outlook Web — auto-login nếu đã lưu owa_username/owa_password "
        "(MFA thì xác nhận tay).")
    try:
        outlook_web_pib.ensure_session(
            timeout_s=420.0, on_status=lambda m: say(m), cancel=cancel,
        )
    except outlook_web_pib.OwaCancelled as exc:
        say(f"— {exc}")
        return {"logged_in": False, "owa_state": "stale", "cancelled": True}
    say("✓ Đã xác nhận Outlook Web đọc được mailbox.")
    try:
        import owa_fpl_watch  # noqa: E402  (module của tool gốc)
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
    after = int(payload.get("after") or 0)
    return owa_fpl_watch.status(after=after)


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


HANDLERS = {
    "gd_print": do_gd_print,
    "save_file": do_save_file,
    "pick_folder": do_pick_folder,
    "aviweb_check": do_aviweb_check,
    "owa_login": do_owa_login,
    "owa_fpl_watch": do_owa_fpl_watch,
    "owa_pib": do_owa_pib,
    "outlook_draft": do_outlook_draft,
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
            paths_exist = {}
            for p in check_paths:
                try:
                    paths_exist[p] = Path(p).is_dir()
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
