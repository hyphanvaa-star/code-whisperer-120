"""Tải PDF AIRCRAFT TECHNICAL SUMMARY cùng ngày từ Outlook Web.

Mail VIC ENG MOC gửi hai lần/ngày (sáng ~05:50, chiều ~17:50). Nút trên bảng
tàu gọi :func:`pull_today`: tìm thư đúng ngày nhấn, lấy bản chiều nếu đã có,
không thì bản sáng, rồi đẩy PDF qua :func:`defect_pdf.process_upload`.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import outlook_web_pib as owa
from utils.logging_setup import get_logger

log = get_logger("defect_summary")

VN_TZ = timezone(timedelta(hours=7))
SUBJECT_NEEDLE = "AIRCRAFT TECHNICAL SUMMARY"
LOOKBACK_D = 3
_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
_RE_DAY = re.compile(
    r"\b(\d{1,2})\s*[-./]?\s*"
    r"(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)"
    r"(?:\s*[-./]?\s*(\d{2}|\d{4}))?"
    r"(?![A-Z0-9])",
    re.I,
)
_RE_PDF = re.compile(r"\.pdf$", re.I)
_RE_SUMMARY_PDF = re.compile(r"TECHNICAL\s*SUMMARY|\bSUMMARY\b", re.I)
_RE_LIMIT_PDF = re.compile(
    r"LIMITATION\s*LIST|OPS\s*LIMITATION|MP\s*&\s*OPS|FOR OMC|VJC\.?\s*REP",
    re.I,
)
_RE_STATUS_PDF = re.compile(r"STATUS\s*REPORT", re.I)


class DefectSummaryError(RuntimeError):
    """Không tìm / không tải được mail summary cùng ngày."""


def vn_now(now: datetime | None = None) -> datetime:
    stamp = now or datetime.now(timezone.utc)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(VN_TZ)


def vn_today(now: datetime | None = None) -> date:
    return vn_now(now).date()


def is_summary_subject(subject: str) -> bool:
    blob = " ".join(str(subject or "").split()).upper()
    return SUBJECT_NEEDLE in blob


def parse_report_day(subject: str, *, today: date | None = None) -> date | None:
    """Ngày in trên subject ``02 SEP 2026`` / ``02-SEP-26``."""
    today = today or vn_today()
    match = _RE_DAY.search(str(subject or ""))
    if not match:
        return None
    day_n = int(match.group(1))
    month = _MONTHS[match.group(2).upper()[:3]]
    year_raw = match.group(3)
    if year_raw:
        year = int(year_raw)
        if year < 100:
            year = 2000 + year if year < 80 else 1900 + year
    else:
        year = today.year
    try:
        return date(year, month, day_n)
    except ValueError:
        return None


def parse_when(msg: dict[str, Any]) -> datetime | None:
    raw = (
        msg.get("SentDateTime") or msg.get("sentDateTime")
        or msg.get("ReceivedDateTime") or msg.get("receivedDateTime")
    )
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None


def format_sent(when: datetime | None) -> str:
    """Giờ gửi theo VN, để đối chiếu trên bảng: ``05:53 02/09/2026``."""
    if when is None:
        return ""
    local = when.astimezone(VN_TZ) if when.tzinfo else when.replace(tzinfo=VN_TZ)
    return local.strftime("%H:%M %d/%m/%Y")


def mail_day(msg: dict[str, Any], *, today: date) -> date | None:
    subject = str(msg.get("Subject") or msg.get("subject") or "")
    day = parse_report_day(subject, today=today)
    if day is not None:
        return day
    when = parse_when(msg)
    if when is None:
        return None
    return when.astimezone(VN_TZ).date()


def nearest_other_mail(
    messages: list[dict[str, Any]], *, now: datetime | None = None,
) -> dict[str, Any] | None:
    today = vn_today(now)
    hits: list[tuple[float, dict[str, Any]]] = []
    for msg in messages:
        subject = str(msg.get("Subject") or msg.get("subject") or "")
        if not is_summary_subject(subject):
            continue
        day = mail_day(msg, today=today)
        if day == today:
            continue
        when = parse_when(msg)
        hits.append((when.timestamp() if when is not None else 0.0, msg))
    if not hits:
        return None
    return max(hits, key=lambda item: item[0])[1]


def missing_today_message(
    messages: list[dict[str, Any]], *, now: datetime | None = None,
) -> str:
    today = vn_today(now)
    want = today.strftime("%d/%m/%Y")
    other = nearest_other_mail(messages, now=now)
    if other is None:
        return (
            f"Không tìm thấy mail {SUBJECT_NEEDLE} của ngày {want}.\n"
            f"Không có mail summary nào trong {LOOKBACK_D} ngày gần đây."
        )
    subject = str(other.get("Subject") or other.get("subject") or "")
    when = parse_when(other)
    day = mail_day(other, today=today)
    day_s = day.strftime("%d/%m/%Y") if day else "không rõ"
    sent = format_sent(when) or "không rõ giờ gửi"
    return (
        f"Mail sai ngày.\n"
        f"Cần ngày {want} (ngày nhấn tải).\n"
        f"Mail gần nhất: {subject}\n"
        f"Ngày mail gửi: {sent} (ngày trên mail: {day_s})."
    )


def slot_of(when: datetime | None) -> str:
    if when is None:
        return ""
    local = when.astimezone(VN_TZ) if when.tzinfo else when.replace(tzinfo=VN_TZ)
    return "am" if local.hour < 12 else "pm"


def pick_today_mail(
    messages: list[dict[str, Any]],
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Lấy mail summary đúng ngày nhấn: chiều nếu đã có, không thì sáng."""
    today = vn_today(now)
    hits: list[tuple[float, dict[str, Any]]] = []
    for msg in messages:
        subject = str(msg.get("Subject") or msg.get("subject") or "")
        if not is_summary_subject(subject):
            continue
        when = parse_when(msg)
        subj_day = parse_report_day(subject, today=today)
        recv_day = when.astimezone(VN_TZ).date() if when is not None else None
        if subj_day is not None and subj_day != today:
            continue
        if subj_day is None and recv_day != today:
            continue
        ts = when.timestamp() if when is not None else 0.0
        hits.append((ts, msg))
    if not hits:
        return None
    return max(hits, key=lambda item: item[0])[1]


def _pdf_rank(name: str) -> int:
    """0 = bảng defect OMC, 1 = summary khác, 8 = PDF linh tinh, 9 = STATUS REPORT."""
    blob = str(name or "")
    if _RE_LIMIT_PDF.search(blob):
        return 0
    if _RE_STATUS_PDF.search(blob):
        return 9
    if _RE_SUMMARY_PDF.search(blob):
        return 1
    return 8


def ranked_pdf_attachments(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """PDF đính kèm: LIMITATION LIST trước, STATUS REPORT để cuối."""
    pdfs: list[dict[str, Any]] = []
    for att in attachments:
        name = str(att.get("Name") or att.get("name") or "")
        if _RE_PDF.search(name):
            pdfs.append(att)
    pdfs.sort(key=lambda att: (
        _pdf_rank(str(att.get("Name") or att.get("name") or "")),
        str(att.get("Name") or att.get("name") or "").lower(),
    ))
    return pdfs


def pick_pdf_attachment(attachments: list[dict[str, Any]]) -> dict[str, Any] | None:
    """PDF bảng defect; bỏ Excel ``SUMMARY MP & OPS LIMITATION``."""
    rows = ranked_pdf_attachments(attachments)
    return rows[0] if rows else None


def _search_window_utc(now: datetime | None = None) -> tuple[datetime, datetime]:
    today = vn_today(now)
    lo = datetime.combine(
        today - timedelta(days=LOOKBACK_D - 1), datetime.min.time(), tzinfo=VN_TZ,
    )
    hi = vn_now(now) + timedelta(hours=1)
    return lo.astimezone(timezone.utc), hi.astimezone(timezone.utc)


def _messages_filter(now: datetime | None = None, *, loose: bool = False) -> str:
    lo, hi = _search_window_utc(now)
    parts = [
        f"ReceivedDateTime ge {lo.strftime('%Y-%m-%dT%H:%M:%SZ')}",
        f"ReceivedDateTime lt {hi.strftime('%Y-%m-%dT%H:%M:%SZ')}",
        "HasAttachments eq true",
    ]
    if not loose:
        parts.append(f"contains(Subject,'{SUBJECT_NEEDLE}')")
    return " and ".join(parts)


def _list_messages(session: Any, url: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    pages = 0
    next_url: str | None = url
    while next_url and pages < 4:
        response = session.get(next_url, timeout=60)
        if int(getattr(response, "status_code", 0) or 0) >= 400:
            owa._status_code(response, "liệt kê thư defect summary")
        try:
            data = response.json()
        except (ValueError, TypeError) as exc:
            raise owa.OwaError(
                "Outlook REST trả dữ liệu thư summary không hợp lệ."
            ) from exc
        out.extend(data.get("value") or [])
        next_url = data.get("@odata.nextLink")
        pages += 1
    return out


def _search_urls(now: datetime | None = None, *, loose: bool = False) -> list[str]:
    flt = quote(_messages_filter(now, loose=loose))
    select = "Id,Subject,ReceivedDateTime,SentDateTime"
    tail = f"?$filter={flt}&$select={select}&$orderby=ReceivedDateTime desc&$top=25"
    root = owa.rest_root("")
    return [
        f"{root}/mailfolders/inbox/messages{tail}",
        f"{root}/messages{tail}",
    ]


def _collect_mails(session: Any, *, now: datetime | None = None) -> list[dict[str, Any]]:
    seen: dict[str, dict[str, Any]] = {}
    last_err: Exception | None = None
    for loose in (False, True):
        for url in _search_urls(now, loose=loose):
            try:
                for msg in _list_messages(session, url):
                    mid = str(msg.get("Id") or msg.get("id") or "").strip()
                    if mid:
                        seen[mid] = msg
            except owa.OwaAuthError:
                raise
            except owa.OwaError as exc:
                last_err = exc
                continue
        if seen:
            break
    if last_err is not None and not seen:
        raise last_err
    return list(seen.values())


def _list_attachments(session: Any, mid: str) -> list[dict[str, Any]]:
    response = session.get(
        f"{owa.rest_root('')}/messages/{mid}/attachments"
        f"?$select=Id,Name,Size,ContentType",
        timeout=45,
    )
    owa._status_code(response, "liệt kê tệp defect summary")
    try:
        return list(response.json().get("value") or [])
    except (ValueError, TypeError) as exc:
        raise owa.OwaError("Outlook REST trả danh sách tệp summary không hợp lệ.") from exc


def _pull_bytes(session: Any, mid: str, aid: str) -> bytes:
    response = session.get(
        f"{owa.rest_root('')}/messages/{mid}/attachments/{aid}/$value",
        timeout=180,
    )
    owa._status_code(response, "tải PDF defect summary")
    blob = response.content or b""
    if not blob:
        raise DefectSummaryError("Tải PDF summary về bị rỗng.")
    return blob


def fetch_today_pdf(
    *,
    now: datetime | None = None,
    token: str = "",
) -> tuple[bytes, str, dict[str, Any]]:
    """Trả ``(pdf_bytes, filename, meta)`` của mail summary cùng ngày."""
    access = token or owa.ensure_fresh_token()
    session = owa._rest_session(access)
    rows = _collect_mails(session, now=now)
    msg = pick_today_mail(rows, now=now)
    today = vn_today(now)
    if msg is None:
        raise DefectSummaryError(missing_today_message(rows, now=now))
    mid = str(msg.get("Id") or msg.get("id") or "").strip()
    subject = str(msg.get("Subject") or msg.get("subject") or "")
    when = parse_when(msg)
    report_day = mail_day(msg, today=today)
    if report_day is not None and report_day != today:
        raise DefectSummaryError(missing_today_message(rows, now=now))
    att = pick_pdf_attachment(_list_attachments(session, mid))
    if att is None:
        sent = format_sent(when) or "không rõ giờ gửi"
        raise DefectSummaryError(
            f"Thấy mail «{subject}» (gửi {sent}) nhưng không có file PDF đính kèm."
        )
    aid = str(att.get("Id") or att.get("id") or "")
    name = str(att.get("Name") or att.get("name") or "defect-summary.pdf")
    blob = _pull_bytes(session, mid, aid)
    slot = slot_of(when)
    sent_iso = when.isoformat() if when is not None else ""
    sent_text = format_sent(when)
    log.info("defect summary %s ← %s (%s) gửi %s", slot or "?", name, subject, sent_text)
    return blob, name, {
        "subject": subject,
        "mail_sent": sent_iso,
        "mail_sent_text": sent_text,
        "received_at": sent_iso,
        "slot": slot,
        "mail_id": mid,
    }


def pull_today(*, now: datetime | None = None, token: str = "") -> dict[str, Any]:
    """Tải PDF cùng ngày rồi parse/lưu như nút upload cũ."""
    import defect_pdf

    blob, name, meta = fetch_today_pdf(now=now, token=token)
    tried: list[tuple[str, bytes]] = [(name, blob)]
    mid = str(meta.get("mail_id") or "")
    if mid:
        access = token or owa.ensure_fresh_token()
        session = owa._rest_session(access)
        for att in ranked_pdf_attachments(_list_attachments(session, mid)):
            other = str(att.get("Name") or att.get("name") or "")
            if other == name:
                continue
            aid = str(att.get("Id") or att.get("id") or "")
            if not aid:
                continue
            tried.append((other, _pull_bytes(session, mid, aid)))
    last_err: Exception | None = None
    for pdf_name, pdf_blob in tried:
        try:
            result = defect_pdf.process_upload(
                pdf_blob, source_name=pdf_name, extra=meta,
            )
            return {**result, **meta}
        except defect_pdf.DefectPdfError as exc:
            last_err = exc
            log.warning("PDF %s không phải bảng defect: %s", pdf_name, exc)
    names = ", ".join(item[0] for item in tried) or name
    detail = str(last_err) if last_err else ""
    raise DefectSummaryError(
        f"Mail «{meta.get('subject') or ''}» (gửi {meta.get('mail_sent_text') or '?'})"
        f" có PDF: {names}.\n"
        "Không thấy bảng AC REG / DEFECT / ACTION REQUIREMENT.\n"
        "Cần file «SUMMARY MP & OPS LIMITATION LIST FOR OMC», "
        "không lấy STATUS REPORT.\n"
        + detail
    )
