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
from datetime import datetime, timedelta
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


HANDLERS = {
    "gd_print": do_gd_print,
    "save_file": do_save_file,
    "pick_folder": do_pick_folder,
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
