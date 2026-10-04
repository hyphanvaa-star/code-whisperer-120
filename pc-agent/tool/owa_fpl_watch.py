"""Tự tải Excel FPL version từ hộp thư chung OMC, folder ``FLIGHT PLAN``.

Poll REST mỗi ``POLL_S`` giây. Ưu tiên ``omc@… / FLIGHT PLAN`` (chỉ FPL, không
crew list). Không vào được thì mới dùng ``CREW LIST/FPL`` trên hộp đang login.
Lượt đầu lấy Flight Plan VER cao nhất của ngày hôm nay gán **BẢN MỚI**, VER
sát dưới (N−1) gán **BẢN ĐANG DÙNG**. Không tải Crew list.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import config
import outlook_web_pib as owa
from utils.cache import atomic_replace
from utils.logging_setup import get_logger
from utils.parsing import safe_filename

log = get_logger("owa_fpl_watch")

FOLDER_NAME = "CREW LIST/FPL"
PREFERRED_FOLDER = "FLIGHT PLAN"
POLL_S = 15
LOOKBACK_H = 72
MAX_SEEN = 800
MAX_PAGES = 8
SEEN_CACHE = config.CACHE_DIR / "owa_fpl_seen.json"
VER_CACHE = config.CACHE_DIR / "owa_fpl_ver.json"

_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
_RE_XLSX = re.compile(r"\.(xlsx|xlsm)$", re.I)
_RE_FPL = re.compile(r"FLIGHT\s*PLAN|\bFPL\b", re.I)
_RE_CREW = re.compile(r"CREW\s*LIST|\bCRL\b", re.I)
_RE_UPDATE = re.compile(r"\bUPDATE\b", re.I)
_RE_VER = re.compile(r"\bVER\s*(\d{1,3})\b", re.I)
# ``21 AUG``, ``21-AUG-26``, ``21AUG26`` (OMC hay dính ngày+tháng+năm).
_RE_DAY = re.compile(
    r"\b(\d{1,2})\s*[-./]?\s*"
    r"(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)"
    r"(?:\s*[-./]?\s*(\d{2}|\d{4}))?"
    r"(?![A-Z0-9])",
    re.I,
)

_stop = threading.Event()
_lock = threading.Lock()
_poll_lock = threading.Lock()
_thread: threading.Thread | None = None
_seq = 0
_notes: deque[dict[str, Any]] = deque(maxlen=40)
_last_err = ""
_next_at = 0.0
_active_folder = PREFERRED_FOLDER


@dataclass(frozen=True, slots=True)
class FplHint:
    mid: str
    subject: str
    when: datetime | None
    day: date | None
    ver: int
    update: bool = False


def _norm_fpl_text(text: str) -> str:
    """Bỏ ``//UPDATE//``, gạch dài, gộp khoảng trắng — cùng một blob để parse."""
    blob = (text or "").replace("\u2013", "-").replace("\u2014", "-")
    blob = re.sub(r"/+", " ", blob)
    blob = re.sub(r"\s+", " ", blob)
    return blob.strip()


def _year_token(raw: str, fallback: int) -> int:
    year = int(raw)
    if year < 100:
        return 2000 + year if year < 80 else 1900 + year
    return year if year >= 100 else fallback


def want_attachment(subject: str, name: str) -> bool:
    """True nếu tệp là Excel FPL version — bỏ crew list, chữ ký ảnh và file lạ."""
    return classify_attachment(subject, name) == "fpl"


def is_fpl_mail(text: str) -> bool:
    """True với Flight Plan, FPL, hoặc mail/file ``UPDATE … VER 09`` của OMC."""
    blob = _norm_fpl_text(text)
    if not blob:
        return False
    if _RE_CREW.search(blob) and not _RE_FPL.search(blob):
        return False
    if _RE_FPL.search(blob):
        return True
    return bool(_RE_UPDATE.search(blob) and parse_fpl_ver(blob))


def classify_attachment(subject: str, name: str) -> str:
    """``fpl`` / ``crew`` / ``""``."""
    filename = name or ""
    if not _RE_XLSX.search(filename):
        return ""
    blob = _norm_fpl_text(f"{subject or ''} {filename}")
    is_fpl = bool(_RE_FPL.search(blob))
    is_crew = bool(_RE_CREW.search(blob))
    if is_fpl and is_crew:
        if _RE_FPL.search(filename) and not _RE_CREW.search(filename):
            return "fpl"
        if _RE_CREW.search(filename) and not _RE_FPL.search(filename):
            return "crew"
        return "fpl"
    if is_fpl:
        return "fpl"
    if is_crew:
        return "crew"
    if _RE_UPDATE.search(blob) and parse_fpl_ver(blob):
        return "fpl"
    return ""


def is_update_fpl(text: str) -> bool:
    """True với subject ``UPDATE FLIGHT PLAN … VER 06`` — bản sửa cùng số VER."""
    blob = _norm_fpl_text(text)
    return bool(_RE_UPDATE.search(blob) and is_fpl_mail(blob))


def parse_fpl_ver(text: str) -> int:
    match = _RE_VER.search(_norm_fpl_text(text))
    return int(match.group(1)) if match else 0


def parse_fpl_day(
    text: str,
    *,
    when: datetime | None = None,
    today: date | None = None,
) -> date | None:
    """Ngày ops in trên subject/tên file (``20 AUG`` / ``21AUG26``)."""
    today = today or datetime.now().date()
    match = _RE_DAY.search(_norm_fpl_text(text))
    if match:
        day_n = int(match.group(1))
        month = _MONTHS[match.group(2).upper()[:3]]
        year_raw = match.group(3)
        fallback_year = when.year if when is not None else today.year
        year = _year_token(year_raw, fallback_year) if year_raw else fallback_year
        try:
            parsed = date(year, month, day_n)
        except ValueError:
            return None
        if not year_raw and when is None:
            delta = (parsed - today).days
            if delta > 180:
                parsed = date(year - 1, month, day_n)
            elif delta < -180:
                parsed = date(year + 1, month, day_n)
        return parsed
    if when is not None:
        local = when.astimezone() if when.tzinfo else when
        return local.date()
    return None


def fpl_hint_from_message(
    msg: dict[str, Any],
    *,
    today: date | None = None,
) -> FplHint | None:
    subject = str(msg.get("Subject") or msg.get("subject") or "")
    if not is_fpl_mail(subject):
        return None
    mid = str(msg.get("Id") or msg.get("id") or "").strip()
    if not mid:
        return None
    when = _msg_when(msg)
    return FplHint(
        mid=mid,
        subject=subject,
        when=when,
        day=parse_fpl_day(subject, when=when, today=today),
        ver=parse_fpl_ver(subject),
        update=is_update_fpl(subject),
    )


def pick_ranked_fpl(hints: list[FplHint], *, want_day: date) -> list[FplHint]:
    """Chỉ FPL đúng ``want_day``, VER cao xuống thấp, mỗi VER một thư.

    Không fallback sang ngày khác: watcher ngày 26 tuyệt đối không được tải FPL
    ngày 25/27, kể cả mailbox chưa có FPL ngày 26.
    """
    pool = [hint for hint in hints if hint.day == want_day]
    if not pool:
        return []

    def key(hint: FplHint) -> tuple[int, int, float]:
        ts = hint.when.timestamp() if hint.when else 0.0
        return (hint.ver, 1 if hint.update else 0, ts)

    ranked: list[FplHint] = []
    seen_ver: set[int] = set()
    for hint in sorted(pool, key=key, reverse=True):
        if hint.ver in seen_ver:
            continue
        seen_ver.add(hint.ver)
        ranked.append(hint)
    return ranked


def pick_latest_fpl(hints: list[FplHint], *, want_day: date) -> FplHint | None:
    """VER cao nhất đúng ``want_day``; không có thì trả ``None``."""
    ranked = pick_ranked_fpl(hints, want_day=want_day)
    return ranked[0] if ranked else None


def pick_plain_same_ver(
    hints: list[FplHint], *, want_day: date, ver: int,
) -> FplHint | None:
    """FPL cùng số VER nhưng không phải UPDATE — để so UPDATE 6 với FPL 6."""
    if ver <= 0:
        return None
    pool = [
        hint for hint in hints
        if hint.day == want_day and hint.ver == ver and not hint.update
    ]
    if not pool:
        return None

    def key(hint: FplHint) -> float:
        return hint.when.timestamp() if hint.when else 0.0

    return max(pool, key=key)


def pick_adjacent_prev(ranked: list[FplHint], latest_ver: int) -> FplHint | None:
    """Ưu tiên đúng VER ``latest - 1``, không lấy VER bất kỳ còn sót trong list ngắn."""
    if latest_ver <= 1:
        return None
    want = latest_ver - 1
    for hint in ranked:
        if hint.ver == want:
            return hint
    for hint in ranked:
        if 0 < hint.ver < latest_ver:
            return hint
    return None


def _ver_subject_clause(ver: int) -> str:
    tokens: list[str] = []
    seen: set[str] = set()
    for token in (f"VER {ver:02d}", f"VER {ver}", f"VER{ver:02d}", f"VER{ver}"):
        if token in seen:
            continue
        seen.add(token)
        tokens.append(f"contains(Subject,'{token}')")
    return "(" + " or ".join(tokens) + ")"


def _fetch_ver_hint(
    session: Any,
    folder_id: str,
    want_day: date,
    want_ver: int,
    *,
    today: date,
    mailbox: str = "",
    skip_update: bool = False,
) -> FplHint | None:
    """Hỏi Outlook đúng VER sát dưới — không dựa vào trang mail đã bị crew list chiếm."""
    if want_ver <= 0:
        return None
    flt = f"{_messages_filter(fpl_subject=True)} and {_ver_subject_clause(want_ver)}"
    url: str | None = (
        f"{owa.rest_root(mailbox)}/mailfolders/{folder_id}/messages"
        f"?$filter={quote(flt)}"
        f"&$select=Id,Subject,ReceivedDateTime"
        f"&$orderby=ReceivedDateTime desc&$top=50"
    )
    try:
        response = session.get(url, timeout=60)
    except Exception:
        return None
    if int(getattr(response, "status_code", 0) or 0) >= 400:
        return None
    try:
        rows = list(response.json().get("value") or [])
    except (ValueError, TypeError):
        return None
    for msg in rows:
        hint = fpl_hint_from_message(msg, today=today)
        if hint is None or hint.day != want_day or hint.ver != want_ver:
            continue
        if skip_update and hint.update:
            continue
        return hint
    return None


def _resolve_prev_hint(
    session: Any,
    folder_id: str,
    ranked: list[FplHint],
    latest: FplHint,
    *,
    today: date,
    mailbox: str = "",
    hints: list[FplHint] | None = None,
) -> FplHint | None:
    day = latest.day or today
    if latest.update:
        plain = pick_plain_same_ver(hints or [], want_day=day, ver=latest.ver)
        if plain is None:
            plain = _fetch_ver_hint(
                session, folder_id, day, latest.ver, today=today,
                mailbox=mailbox, skip_update=True,
            )
        if plain is not None:
            return plain
    prev = pick_adjacent_prev(ranked, latest.ver)
    want = latest.ver - 1
    if want > 0 and (prev is None or prev.ver != want):
        found = _fetch_ver_hint(
            session, folder_id, day, want, today=today,
            mailbox=mailbox,
        )
        if found is not None:
            return found
    return prev


def _fpl_mailbox() -> str:
    return (config.get_outlook_mailbox() or config.OMC_SHARED_MAILBOX or "").strip()


def _folder_label(name: str, mailbox: str = "") -> str:
    box = (mailbox or "").strip()
    return f"{box} / {name}" if box else name


def _resolve_fpl_source(session: Any) -> tuple[str, str, str]:
    """Ưu tiên hộp OMC / FLIGHT PLAN. Trả ``(id, nhãn hiện, mailbox)``."""
    box = _fpl_mailbox()
    if box:
        try:
            fid, name = owa._find_folder_id(
                session, PREFERRED_FOLDER, mailbox=box,
            )
            return fid, _folder_label(name, box), box
        except (owa.OwaError, owa.OwaAuthError) as exc:
            log.info(
                "FPL: không mở được %s trên %s (%s) — dùng %s",
                PREFERRED_FOLDER, box, exc, FOLDER_NAME,
            )
    fid, name = owa._find_folder_id(session, FOLDER_NAME)
    return fid, name, ""


def is_running() -> bool:
    t = _thread
    return t is not None and t.is_alive() and not _stop.is_set()


def ensure_running() -> bool:
    """Token còn dùng được mà luồng đã chết (hết hạn rồi login lại) thì dựng lại.

    ``start()`` chỉ chạy lúc mở tool. Hết hạn thì ``_loop`` tự ``break`` — đăng
    nhập Outlook Web xong nếu không gọi lại, thẻ FPL đứng ``chưa chạy`` dù nút
    vẫn ghi OK.
    """
    if is_running():
        return True
    token = owa._load_cached_token()
    if not token or not owa._token_ok_for_mail(token):
        return False
    return start()


def status(*, after: int = 0) -> dict[str, Any]:
    ensure_running()
    with _lock:
        lines = [n for n in _notes if int(n.get("seq") or 0) > after]
        running = is_running()
        until = _seq
        nxt = _next_at
        folder = _active_folder
    remain = max(0, int(nxt - time.time())) if running else 0
    return {
        "running": running,
        "interval_s": POLL_S,
        "folder": folder,
        "until": until,
        "lines": lines,
        "ver": ver_public(),
        "next_at": nxt if running else 0,
        "next_in": remain,
        "dest": str(config.get_path("fpl")),
        "dest_excel": str(config.EXCEL_DIR),
    }


def ver_public(path: Path | None = None) -> dict[str, Any]:
    state = _load_ver(path or VER_CACHE)
    return {
        "day": state.get("day") or "",
        "old": state.get("old") or "",
        "new": state.get("new") or "",
        "old_ver": int(state.get("old_ver") or 0),
        "new_ver": int(state.get("new_ver") or 0),
    }


def note(text: str, cls: str = "sys") -> None:
    global _seq
    with _lock:
        _seq += 1
        _notes.append({"seq": _seq, "text": text, "cls": cls, "t": time.time()})
    log.info("%s", text)


def _empty_ver() -> dict[str, Any]:
    return {
        "day": "", "old": "", "old_ver": 0, "new": "", "new_ver": 0, "new_mid": "",
    }


def _load_ver(path: Path) -> dict[str, Any]:
    state = _empty_ver()
    if not path.is_file():
        return state
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return state
    if not isinstance(raw, dict):
        return state
    state["day"] = str(raw.get("day") or "")
    state["old"] = str(raw.get("old") or "")
    state["new"] = str(raw.get("new") or "")
    state["new_mid"] = str(raw.get("new_mid") or "")
    try:
        state["old_ver"] = int(raw.get("old_ver") or 0)
    except (TypeError, ValueError):
        state["old_ver"] = 0
    try:
        state["new_ver"] = int(raw.get("new_ver") or 0)
    except (TypeError, ValueError):
        state["new_ver"] = 0
    return state


def _save_json(path: Path, data: dict[str, Any]) -> None:
    tmp = path.with_name(f"{path.name}.part{os.getpid()}-{threading.get_ident()}")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        atomic_replace(tmp, path)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _load_seen(path: Path) -> tuple[list[str], bool]:
    """Trả ``(ids, primed)``. ``primed`` = đã qua lượt nền, mail mới sẽ được tải."""
    if not path.is_file():
        return [], False
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return [], False
    ids_raw = raw.get("ids") if isinstance(raw, dict) else raw
    if not isinstance(ids_raw, list):
        ids_raw = []
    ids: list[str] = []
    for item in ids_raw:
        sid = str(item or "").strip()
        if sid:
            ids.append(sid)
    if isinstance(raw, dict):
        primed = bool(raw.get("primed")) or bool(ids)
    else:
        primed = bool(ids)
    return ids, primed


def _save_seen(path: Path, ids: list[str], *, primed: bool = True) -> None:
    _save_json(path, {"ids": ids[-MAX_SEEN:], "primed": primed, "at": time.time()})


def _msg_id(msg: dict[str, Any]) -> str:
    return str(msg.get("Id") or msg.get("id") or "").strip()


def _att_id(att: dict[str, Any]) -> str:
    return str(att.get("Id") or att.get("id") or "").strip()


def _att_name(att: dict[str, Any]) -> str:
    return str(att.get("Name") or att.get("name") or "")


def _msg_when(msg: dict[str, Any]) -> datetime | None:
    raw = msg.get("ReceivedDateTime") or msg.get("receivedDateTime")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_iso_day(text: str) -> date | None:
    raw = (text or "").strip()
    if len(raw) < 10:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _messages_filter(*, fpl_subject: bool) -> str:
    lo = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_H)
    parts = [
        f"ReceivedDateTime ge {lo.strftime('%Y-%m-%dT%H:%M:%SZ')}",
        "HasAttachments eq true",
    ]
    if fpl_subject:
        # Folder «CREW LIST/FPL» đầy crew list — lọc subject kẻo VER sát dưới
        # rơi khỏi cửa sổ quét, rồi so nhầm VER 8 với VER 3.
        parts.append(
            "("
            "contains(Subject,'FLIGHT PLAN') or "
            "contains(Subject,'FPL') or "
            "contains(Subject,'UPDATE')"
            ")"
        )
    return " and ".join(parts)


def _list_messages(
    session: Any, folder_id: str, *, mailbox: str = "", cache_name: str = "",
) -> list[dict[str, Any]]:
    def fetch(fpl_subject: bool) -> tuple[list[dict[str, Any]], Any]:
        url: str | None = (
            f"{owa.rest_root(mailbox)}/mailfolders/{folder_id}/messages"
            f"?$filter={quote(_messages_filter(fpl_subject=fpl_subject))}"
            f"&$select=Id,Subject,ReceivedDateTime"
            f"&$orderby=ReceivedDateTime desc&$top=50"
        )
        out: list[dict[str, Any]] = []
        response: Any = None
        pages = 0
        while url and pages < MAX_PAGES:
            response = session.get(url, timeout=60)
            if int(getattr(response, "status_code", 0) or 0) >= 400:
                return out, response
            try:
                data = response.json()
            except (ValueError, TypeError) as exc:
                raise owa.OwaError(
                    "Outlook REST trả dữ liệu thư FPL không hợp lệ."
                ) from exc
            out.extend(data.get("value") or [])
            url = data.get("@odata.nextLink")
            pages += 1
        return out, response

    rows, response = fetch(True)
    if response is not None and int(getattr(response, "status_code", 0) or 0) >= 400:
        rows, response = fetch(False)
    if response is not None and int(getattr(response, "status_code", 0) or 0) >= 400:
        owa.drop_folder_cache(cache_name or FOLDER_NAME)
        owa._status_code(response, "liệt kê thư FPL")
    return rows


def _list_attachments(
    session: Any, mid: str, *, mailbox: str = "",
) -> list[dict[str, Any]] | None:
    """Danh sách tệp, hoặc ``None`` nếu REST lỗi — để lượt sau thử lại."""
    response = session.get(
        f"{owa.rest_root(mailbox)}/messages/{mid}/attachments"
        f"?$select=Id,Name,Size,ContentType",
        timeout=45,
    )
    if response.status_code in (401, 403):
        owa._status_code(response, "liệt kê tệp FPL")
    if response.status_code >= 400:
        return None
    try:
        return list(response.json().get("value") or [])
    except (ValueError, TypeError):
        return None


def _pull_bytes(session: Any, mid: str, aid: str, *, mailbox: str = "") -> bytes:
    response = session.get(
        f"{owa.rest_root(mailbox)}/messages/{mid}/attachments/{aid}/$value",
        timeout=120,
    )
    owa._status_code(response, "tải Excel FPL")
    return response.content or b""


def _write_xlsx(target: Path, blob: bytes) -> None:
    tmp = target.with_name(
        f"{target.name}.part{os.getpid()}-{threading.get_ident()}"
    )
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_bytes(blob)
        atomic_replace(tmp, target)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _mirror_fpl(name: str, blob: bytes) -> str:
    """Copy Excel FPL lên ``D:\\FPL`` (hoặc folder người dùng chọn)."""
    if not name or not blob:
        return ""
    try:
        folder = config.ensure_d_folder("fpl")
    except Exception as exc:
        log.debug("FPL không copy lên D: %s", exc)
        return ""
    dest = folder / safe_filename(name)
    try:
        if dest.is_file() and dest.stat().st_size == len(blob):
            return str(dest)
        _write_xlsx(dest, blob)
        log.info("FPL copy lên %s", dest)
        return str(dest)
    except OSError as exc:
        log.warning("FPL không ghi %s: %s", dest, exc)
        return ""


def _best_att(
    subject: str,
    attachments: list[dict[str, Any]],
    kind: str,
) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    best_ver = -1
    for att in attachments:
        name = _att_name(att)
        if classify_attachment(subject, name) != kind or not _att_id(att):
            continue
        ver = parse_fpl_ver(f"{subject} {name}")
        if best is None or ver >= best_ver:
            best = att
            best_ver = ver
    return best


def _save_kind(
    session: Any,
    mid: str,
    subject: str,
    dest: Path,
    kind: str,
    *,
    mirror: bool = False,
    mailbox: str = "",
    overwrite: bool = False,
) -> tuple[str, str]:
    """Tải một Excel ``kind``. Trả ``(filename, error)`` — filename rỗng nếu lỗi."""
    attachments = _list_attachments(session, mid, mailbox=mailbox)
    if attachments is None:
        return "", "không đọc được đính kèm"
    att = _best_att(subject, attachments, kind)
    if att is None:
        return "", ""
    name = safe_filename(_att_name(att))
    target = dest / name
    if target.is_file() and target.stat().st_size > 0 and not overwrite:
        if mirror:
            try:
                _mirror_fpl(name, target.read_bytes())
            except OSError:
                pass
        return name, ""
    blob = _pull_bytes(session, mid, _att_id(att), mailbox=mailbox)
    if not blob:
        return "", f"{name}: tệp rỗng"
    _write_xlsx(target, blob)
    if mirror:
        _mirror_fpl(name, blob)
    log.info("FPL watch lưu %s", name)
    return name, ""


def _apply_update_same_ver(
    state: dict[str, Any], name: str, fpl_ver: int,
) -> tuple[str, str]:
    """``UPDATE … VER 06`` thành bản mới; FPL VER 06 tụt xuống đang dùng."""
    if fpl_ver <= 0 or not name:
        return "", ""
    if fpl_ver == int(state.get("new_ver") or 0):
        prev = str(state.get("new") or "")
        if prev == name:
            return "", ""
        assign_old = ""
        if prev:
            state["old"] = prev
            state["old_ver"] = fpl_ver
            assign_old = prev
        state["new"] = name
        return assign_old, name
    if fpl_ver == int(state.get("old_ver") or 0):
        state["old"] = name
        return name, ""
    return "", ""


def _need_seed(state: dict[str, Any], hints: list[FplHint], today: date) -> bool:
    old = str(state.get("old") or "")
    new = str(state.get("new") or "")
    state_day = _parse_iso_day(str(state.get("day") or ""))
    if not old and not new:
        return True
    if state_day == today:
        return False
    return any(h.day == today for h in hints)


def _apply_incoming_fpl(
    state: dict[str, Any], name: str, fpl_ver: int,
) -> tuple[str, str]:
    """Gán FPL mới nhất → bản mới, FPL sát dưới → đang dùng. Trả (assign_old, assign_new)."""
    old_name = str(state.get("old") or "")
    new_name = str(state.get("new") or "")
    old_ver = int(state.get("old_ver") or 0)
    new_ver = int(state.get("new_ver") or 0)
    if name in {old_name, new_name}:
        return "", ""
    if fpl_ver > new_ver:
        assign_old = ""
        if new_name and new_name != name:
            state["old"] = new_name
            state["old_ver"] = new_ver
            assign_old = new_name
        state["new"] = name
        state["new_ver"] = fpl_ver
        return assign_old, name
    if (not new_ver or fpl_ver < new_ver) and fpl_ver > old_ver:
        state["old"] = name
        state["old_ver"] = fpl_ver
        return name, ""
    return "", ""


def poll_once(
    token: str,
    *,
    out_dir: Path | None = None,
    seen_path: Path | None = None,
    ver_path: Path | None = None,
    session: Any | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    """Quét folder một lần. Trả ``saved`` / ``assign_old`` / ``assign_new``."""
    global _active_folder
    dest = Path(out_dir) if out_dir is not None else config.EXCEL_DIR
    dest.mkdir(parents=True, exist_ok=True)
    mirror = out_dir is None
    seen_file = Path(seen_path) if seen_path is not None else SEEN_CACHE
    ver_file = Path(ver_path) if ver_path is not None else VER_CACHE
    sess = session if session is not None else owa._rest_session(token)
    day_now = today or datetime.now().date()

    with _poll_lock:
        seen_ids, primed = _load_seen(seen_file)
        first = not primed
        known = set(seen_ids)
        state = _load_ver(ver_file)

        fid, found_name, mailbox = _resolve_fpl_source(sess)
        cache_name = found_name.rsplit(" / ", 1)[-1]
        with _lock:
            _active_folder = found_name
        log.debug("FPL watch thư mục %r", found_name)
        messages = _list_messages(
            sess, fid, mailbox=mailbox, cache_name=cache_name,
        )

        saved: list[str] = []
        skipped: list[str] = []
        errors: list[str] = []
        marked = 0
        assign_old = ""
        assign_new = ""

        hints = [
            h for h in (fpl_hint_from_message(m, today=day_now) for m in messages) if h
        ]
        ranked = pick_ranked_fpl(hints, want_day=day_now)
        latest = ranked[0] if ranked else None
        prev = (
            _resolve_prev_hint(
                sess, fid, ranked, latest, today=day_now, mailbox=mailbox,
                hints=hints,
            )
            if latest is not None else None
        )
        seeding = _need_seed(state, hints, day_now)
        catchup = (
            latest is not None
            and not seeding
            and latest.ver > int(state.get("new_ver") or 0)
        )
        replace_update = (
            latest is not None
            and not seeding
            and not catchup
            and bool(getattr(latest, "update", False))
            and latest.ver == int(state.get("new_ver") or 0)
            and str(state.get("new_mid") or "") != latest.mid
        )

        if latest is not None and seeding:
            new_name, err = _save_kind(
                sess, latest.mid, latest.subject, dest, "fpl",
                mirror=mirror, mailbox=mailbox,
            )
            if err:
                errors.append(f"{latest.subject[:40]}: {err}")
            elif new_name:
                old_name = ""
                old_ver = 0
                if prev is not None:
                    old_name, err2 = _save_kind(
                        sess, prev.mid, prev.subject, dest, "fpl",
                        mirror=mirror, mailbox=mailbox,
                    )
                    if err2:
                        errors.append(f"{prev.subject[:40]}: {err2}")
                        old_name = ""
                    elif old_name:
                        old_ver = prev.ver
                ops_day = latest.day or day_now
                state = {
                    "day": ops_day.isoformat(),
                    "old": old_name,
                    "old_ver": old_ver,
                    "new": new_name,
                    "new_ver": latest.ver,
                    "new_mid": latest.mid,
                }
                assign_new = new_name
                assign_old = old_name
                for saved_name in (new_name, old_name):
                    if saved_name and (dest / saved_name).is_file():
                        if saved_name not in saved:
                            saved.append(saved_name)
                _save_json(ver_file, state)
        elif catchup:
            new_name, err = _save_kind(
                sess, latest.mid, latest.subject, dest, "fpl",
                mirror=mirror, mailbox=mailbox,
            )
            if err:
                errors.append(f"{latest.subject[:40]}: {err}")
            elif new_name:
                if new_name not in saved and (dest / new_name).is_file():
                    saved.append(new_name)
                got_old, got_new = _apply_incoming_fpl(
                    state, new_name, latest.ver,
                )
                if got_old:
                    assign_old = got_old
                if got_new:
                    assign_new = got_new
                    state["new_mid"] = latest.mid
                if got_old or got_new:
                    _save_json(ver_file, state)
        elif replace_update:
            new_name, err = _save_kind(
                sess, latest.mid, latest.subject, dest, "fpl",
                mirror=mirror, mailbox=mailbox, overwrite=True,
            )
            if err:
                errors.append(f"{latest.subject[:40]}: {err}")
            elif new_name:
                if new_name not in saved and (dest / new_name).is_file():
                    saved.append(new_name)
                got_old, got_new = _apply_update_same_ver(
                    state, new_name, latest.ver,
                )
                if got_old:
                    assign_old = got_old
                if got_new:
                    assign_new = got_new
                state["new_mid"] = latest.mid
                _save_json(ver_file, state)
        new_ver_now = int(state.get("new_ver") or 0)
        old_ver_now = int(state.get("old_ver") or 0)
        closer = None
        want_old = new_ver_now - 1
        if new_ver_now and want_old > old_ver_now:
            closer = next((h for h in ranked if h.ver == want_old), None)
            if closer is None:
                closer = _fetch_ver_hint(
                    sess, fid, day_now, want_old, today=day_now,
                    mailbox=mailbox,
                )
            if closer is None:
                closer = next(
                    (h for h in ranked if old_ver_now < h.ver < new_ver_now),
                    None,
                )
            if closer is not None:
                closer_name, err_c = _save_kind(
                    sess, closer.mid, closer.subject, dest, "fpl",
                    mirror=mirror, mailbox=mailbox,
                )
                if err_c:
                    errors.append(f"{closer.subject[:40]}: {err_c}")
                elif closer_name:
                    if closer_name not in saved and (dest / closer_name).is_file():
                        saved.append(closer_name)
                    got_old, got_new = _apply_incoming_fpl(
                        state, closer_name, closer.ver,
                    )
                    if got_old:
                        assign_old = got_old
                    if got_new:
                        assign_new = got_new
                    if got_old or got_new:
                        _save_json(ver_file, state)

        for msg in messages:
            mid = _msg_id(msg)
            if not mid:
                continue
            if mid in known:
                continue
            if first:
                seen_ids.append(mid)
                known.add(mid)
                marked += 1
                continue

            subject = str(msg.get("Subject") or msg.get("subject") or "")
            hint = fpl_hint_from_message(msg, today=day_now)
            # VER mới hơn → bản mới. VER nằm giữa old và new → nâng bản đang dùng.
            current_ver = int(state.get("new_ver") or 0)
            old_ver_now = int(state.get("old_ver") or 0)
            closer_slot = bool(
                hint is not None
                and current_ver
                and old_ver_now < hint.ver < current_ver
            )
            held_update = bool(
                hint is not None
                and hint.update
                and hint.ver > 0
                and hint.ver in {current_ver, old_ver_now}
            )
            if (
                hint is None
                or hint.day != day_now
                or (hint.ver <= current_ver and not closer_slot and not held_update)
            ):
                seen_ids.append(mid)
                known.add(mid)
                marked += 1
                continue

            attachments = _list_attachments(sess, mid, mailbox=mailbox)
            if attachments is None:
                errors.append(f"{subject[:40] or mid[:12]}: không đọc được đính kèm")
                continue

            wanted = [
                att for att in attachments
                if want_attachment(subject, _att_name(att)) and _att_id(att)
            ]
            if not wanted:
                seen_ids.append(mid)
                known.add(mid)
                marked += 1
                continue

            ok = True
            for att in wanted:
                name = safe_filename(_att_name(att))
                kind = classify_attachment(subject, _att_name(att))
                target = dest / name
                existed = target.is_file() and target.stat().st_size > 0
                if not existed or held_update:
                    try:
                        blob = _pull_bytes(sess, mid, _att_id(att), mailbox=mailbox)
                        if not blob:
                            ok = False
                            errors.append(f"{name}: tệp rỗng")
                            continue
                        _write_xlsx(target, blob)
                        if mirror:
                            _mirror_fpl(name, blob)
                        saved.append(name)
                        log.info("FPL watch lưu %s", name)
                    except owa.OwaAuthError:
                        raise
                    except Exception as exc:
                        ok = False
                        errors.append(f"{name}: {exc}")
                        log.warning("FPL watch không lưu %s: %s", name, exc)
                        continue
                else:
                    skipped.append(name)
                    if mirror:
                        try:
                            _mirror_fpl(name, target.read_bytes())
                        except OSError:
                            pass

                if kind != "fpl" or not name:
                    continue
                blob_text = f"{subject} {name}"
                fpl_day = parse_fpl_day(
                    blob_text, when=_msg_when(msg), today=day_now,
                )
                fpl_ver = parse_fpl_ver(blob_text)
                watch_day = _parse_iso_day(str(state.get("day") or ""))
                if not state.get("old") and not state.get("new"):
                    continue
                if fpl_day != watch_day:
                    continue
                if held_update:
                    got_old, got_new = _apply_update_same_ver(state, name, fpl_ver)
                else:
                    got_old, got_new = _apply_incoming_fpl(state, name, fpl_ver)
                if not got_old and not got_new:
                    continue
                if got_old:
                    assign_old = got_old
                if got_new:
                    assign_new = got_new
                _save_json(ver_file, state)

            if ok:
                seen_ids.append(mid)
                known.add(mid)
                marked += 1

        _save_seen(seen_file, seen_ids, primed=True)
        return {
            "baseline": first,
            "saved": saved,
            "skipped": skipped,
            "errors": errors,
            "marked": marked,
            "folder": found_name,
            "assign_old": assign_old,
            "assign_new": assign_new,
            "ver": ver_public(ver_file),
        }


def _loop() -> None:
    global _last_err, _next_at
    note(
        f"Đang theo dõi hộp OMC «{PREFERRED_FOLDER}» mỗi {POLL_S}s "
        f"(không crew list; fallback {FOLDER_NAME}). "
        "FPL VER mới nhất vào bản mới, VER sát dưới vào bản đang dùng. "
        f"File cũng lưu vào {config.get_path('fpl')}."
    )
    while not _stop.is_set():
        try:
            token = owa._load_cached_token()
            if not token or not owa._token_ok_for_mail(token):
                note(
                    "Outlook Web hết hạn — dừng tự tải FPL. "
                    "Bấm Đăng nhập Outlook Web để chạy lại.",
                    "bad",
                )
                break
            result = poll_once(token)
            _last_err = ""
            old_name = result.get("assign_old") or ""
            new_name = result.get("assign_new") or ""
            if old_name:
                ver = (result.get("ver") or {}).get("old_ver") or ""
                note(
                    f"✓ {old_name} → bản đang dùng"
                    + (f" (VER {ver})" if ver else ""),
                    "ok",
                )
            if new_name:
                old_ver = (result.get("ver") or {}).get("old_ver") or ""
                new_ver = (result.get("ver") or {}).get("new_ver") or ""
                note(
                    f"✓ {new_name} → bản mới"
                    + (
                        f" (UPDATE VER {new_ver} so với FPL VER {old_ver})"
                        if new_ver and old_ver and new_ver == old_ver
                        else (f" (VER {new_ver} so với VER {old_ver})" if new_ver else "")
                    ),
                    "ok",
                )
            assigned = {old_name, new_name}
            for name in result.get("saved") or []:
                if name not in assigned:
                    note(f"✓ {name}", "ok")
            if result.get("baseline") and not old_name and not new_name:
                folder = result.get("folder") or PREFERRED_FOLDER
                note(
                    f"Đã ghi nhận {result.get('marked') or 0} thư sẵn có "
                    f"trong {folder} — chỉ tải mail mới từ đây."
                )
            for err in result.get("errors") or []:
                note(f"⚠ {err}", "bad")
        except owa.OwaAuthError as exc:
            note(f"Outlook Web từ chối — dừng tự tải FPL ({exc})", "bad")
            break
        except Exception as exc:
            msg = str(exc)
            if msg != _last_err:
                note(f"⚠ Lỗi theo dõi FPL: {msg}", "bad")
                _last_err = msg
            log.warning("FPL watch: %s", exc)
        _next_at = time.time() + POLL_S
        if _stop.wait(POLL_S):
            break
    _next_at = 0.0


def start() -> bool:
    """Bật poller nếu chưa chạy. Không mở Chrome — chỉ dùng token cache."""
    global _thread
    with _lock:
        if _thread is not None and _thread.is_alive():
            return False
        _stop.clear()
        _thread = threading.Thread(target=_loop, name="owa-fpl-watch", daemon=True)
        _thread.start()
        return True


def start_if_token() -> bool:
    token = owa._load_cached_token()
    if not token or not owa._token_ok_for_mail(token):
        return False
    return start()


def stop() -> None:
    _stop.set()
