"""Theo dõi hộp thư chung OMC / thư mục FLIGHT PLAN — bản chạy trong trợ lý PC.

Thay thế module ``owa_fpl_watch`` của tool gốc (không cần file gốc nữa):
- ``ensure_running()``: bật luồng nền dò thư mỗi 15 giây, tải file Excel
  FPL (FLIGHT PLAN / UPDATE VER…) về thư mục Excel của tool.
- ``status(after=0)``: trả trạng thái + các dòng log + ver old/new để web
  hiển thị và lưu file lên kho.

Dùng lại phiên Outlook Web của ``outlook_web_pib`` (token + REST session).
"""
from __future__ import annotations

import base64
import json
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import config  # module của tool gốc (CACHE_DIR, OMC_SHARED_MAILBOX, get_path…)
import outlook_web_pib as owa

POLL_S = 15.0
FOLDER_NAME = "FLIGHT PLAN"
STATE_FILE = config.CACHE_DIR / "owa_fpl_watch.json"

_RE_XLSX = re.compile(r"\.(xlsx|xlsm)$", re.I)
_RE_FPL = re.compile(r"FLIGHT\s*PLAN|\bFPL\b", re.I)
_RE_CREW = re.compile(r"CREW\s*LIST|\bCRL\b", re.I)
_RE_UPDATE = re.compile(r"\bUPDATE\b", re.I)
_RE_VER = re.compile(r"\bVER\s*(\d{1,3})\b", re.I)

_lock = threading.RLock()
_thread: threading.Thread | None = None
_stop = threading.Event()

_state: dict[str, Any] = {
    "running": False,
    "last_at": 0.0,
    "count": 0,
    "items": [],   # [{id, subject, at}]
    "lines": [],   # [{text, cls, at}]
    "ver": {"old": "", "new": ""},
    "error": "",
    "seen": [],    # message ids đã xử lý
}


def _excel_dir() -> Path:
    for getter in (
        lambda: config.get_path("excel"),
        lambda: config.get_path("fpl"),
        lambda: Path(getattr(config, "EXCEL_DIR", "")),
    ):
        try:
            p = Path(getter())
            if str(p) and str(p) != ".":
                p.mkdir(parents=True, exist_ok=True)
                return p
        except Exception:
            continue
    p = Path("data/excel")
    p.mkdir(parents=True, exist_ok=True)
    return p


def _log(text: str, cls: str = "") -> None:
    with _lock:
        _state["lines"].append({"text": text, "cls": cls, "at": time.time()})
        del _state["lines"][:-200]


def _ver_of(text: str) -> int:
    m = _RE_VER.search(text or "")
    return int(m.group(1)) if m else 0


def _is_fpl(text: str) -> bool:
    blob = re.sub(r"\s+", " ", text or "")
    if _RE_CREW.search(blob) and not _RE_FPL.search(blob):
        return False
    if _RE_FPL.search(blob):
        return True
    return bool(_RE_UPDATE.search(blob)) and _ver_of(blob) > 0


def _want_attachment(subject: str, name: str) -> bool:
    if not _RE_XLSX.search(name or ""):
        return False
    blob = f"{subject} {name}"
    if _RE_CREW.search(blob) and not _RE_FPL.search(blob):
        return False
    return _is_fpl(blob)


def _load_state() -> None:
    try:
        if STATE_FILE.is_file():
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            with _lock:
                for k in ("count", "items", "lines", "ver", "seen"):
                    if k in data:
                        _state[k] = data[k]
    except Exception:
        pass


def _save_state() -> None:
    try:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with _lock:
            data = {k: _state[k] for k in ("count", "items", "lines", "ver", "seen")}
        STATE_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _list_messages(s, folder_id: str, mailbox: str) -> list[dict[str, Any]]:
    url = (
        f"{owa.rest_root(mailbox)}/mailfolders/{folder_id}/messages"
        "?$top=25&$orderby=receivedDateTime desc"
        "&$select=id,subject,receivedDateTime,hasAttachments"
    )
    r = s.get(url, timeout=60)
    owa._status_code(r, "đọc thư FLIGHT PLAN")
    return r.json().get("value") or []


def _download_attachments(s, msg_id: str, subject: str, mailbox: str, dest: Path) -> list[str]:
    r = s.get(
        f"{owa.rest_root(mailbox)}/messages/{msg_id}/attachments?$top=50",
        timeout=60,
    )
    owa._status_code(r, "đọc đính kèm")
    saved: list[str] = []
    for att in r.json().get("value") or []:
        name = str(att.get("name") or att.get("Name") or "")
        if not _want_attachment(subject, name):
            continue
        content = att.get("contentBytes") or att.get("ContentBytes")
        if not content:
            continue
        out = dest / name
        out.write_bytes(base64.b64decode(content))
        saved.append(name)
    return saved


def _refresh_ver(dest: Path) -> None:
    """Cập nhật ver.old/new từ các file FPL Excel hiện có (VER cao nhất)."""
    try:
        files = [f for f in dest.glob("*.xls*") if _is_fpl(f.name)]
        files.sort(key=lambda f: (_ver_of(f.name), f.stat().st_mtime), reverse=True)
        with _lock:
            _state["ver"] = {
                "new": files[0].name if files else "",
                "old": files[1].name if len(files) > 1 else "",
            }
    except Exception:
        pass


def _poll_once() -> None:
    token = owa.ensure_fresh_token(timeout_s=120.0, cancel=owa_cancel)
    s = owa._rest_session(token)
    mailbox = getattr(config, "OMC_SHARED_MAILBOX", "") or ""
    folder_id, _ = owa._find_folder_id(s, FOLDER_NAME, mailbox=mailbox)
    dest = _excel_dir()
    msgs = _list_messages(s, folder_id, mailbox)
    with _lock:
        seen = set(_state["seen"])
        _state["last_at"] = time.time()
    new_seen: list[str] = []
    for msg in msgs:
        mid = str(msg.get("id") or "")
        subject = str(msg.get("subject") or "")
        if not mid or mid in seen:
            continue
        new_seen.append(mid)
        if not _is_fpl(subject) or not msg.get("hasAttachments"):
            continue
        try:
            saved = _download_attachments(s, mid, subject, mailbox, dest)
        except Exception as exc:
            _log(f"⚠ Tải đính kèm thất bại ({subject[:60]}): {exc}", "bad")
            continue
        if saved:
            with _lock:
                _state["count"] = int(_state["count"]) + len(saved)
                _state["items"].insert(0, {
                    "id": int(time.time()),
                    "subject": subject,
                    "at": datetime.now(timezone.utc).isoformat(),
                })
                del _state["items"][:-50]
            for name in saved:
                _log(f"✓ FPL VER mới: {name}", "ok")
    if new_seen:
        with _lock:
            _state["seen"] = (list(_state["seen"]) + new_seen)[-500:]
        _refresh_ver(dest)
        _save_state()


class _Cancel:
    def is_set(self) -> bool:
        return _stop.is_set()


owa_cancel = _Cancel()


def _loop() -> None:
    _log("▶ Theo dõi OMC / FLIGHT PLAN mỗi 15 giây.")
    while not _stop.is_set():
        try:
            _poll_once()
            with _lock:
                _state["error"] = ""
        except Exception as exc:
            with _lock:
                _state["error"] = str(exc)
            _log(f"⚠ Dò FLIGHT PLAN lỗi: {exc}", "bad")
        _stop.wait(POLL_S)
    with _lock:
        _state["running"] = False


def ensure_running() -> bool:
    """Bật luồng dò nền (idempotent). Trả True nếu luồng đang chạy."""
    global _thread
    with _lock:
        if _thread and _thread.is_alive():
            return True
        _load_state()
        _stop.clear()
        _state["running"] = True
        _thread = threading.Thread(target=_loop, name="owa-fpl-watch", daemon=True)
        _thread.start()
        return True


def status(after: int = 0) -> dict[str, Any]:
    """Snapshot trạng thái cho web. ``after`` (ms epoch) lọc items/lines mới."""
    with _lock:
        running = bool(_state["running"] or (_thread and _thread.is_alive()))
        after_s = (after or 0) / 1000.0
        lines = [l for l in _state["lines"] if float(l.get("at") or 0) > after_s]
        return {
            "running": running,
            "last_at": _state["last_at"],
            "count": _state["count"],
            "items": list(_state["items"]),
            "lines": [{"text": l["text"], "cls": l.get("cls", "")} for l in lines],
            "ver": dict(_state["ver"]),
            "dest_excel": str(_excel_dir()),
            "error": _state["error"],
        }
