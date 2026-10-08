"""Đọc PDF AMOS thành dữ liệu TÀU / DEFECT / GIỚI HẠN KHAI THÁC.

Bảng trên giao diện dùng đủ ba trường và chỉ xem block ``[OPS]`` của cột
ACTION REQUIREMENT là giới hạn khai thác. File Excel tải về vẫn giữ định dạng
cũ gồm hai cột, một dòng cho mỗi tàu. Không ghi ra ổ D cố định.
"""

from __future__ import annotations

import io
import json
import logging
import multiprocessing
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict

import config

log = logging.getLogger(__name__)

DEFECT_DIR: Path = config.DATA_DIR / "defect"
EXCEL_NAME = "tau_gioi_han.xlsx"
META_NAME = "_meta.json"
EXCEL_PATH = DEFECT_DIR / EXCEL_NAME
META_PATH = DEFECT_DIR / META_NAME


class DefectPdfError(RuntimeError):
    """Không đọc / không parse được PDF defect."""


class AircraftLimitRow(TypedDict):
    reg: str
    defect: str
    limit: str


def ensure_dir() -> None:
    DEFECT_DIR.mkdir(parents=True, exist_ok=True)


def status() -> dict[str, Any]:
    """Thông tin file Excel đang lưu (nếu có)."""
    ensure_dir()
    meta: dict[str, Any] = {}
    if META_PATH.is_file():
        try:
            meta = json.loads(META_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            meta = {}
    exists = EXCEL_PATH.is_file() and EXCEL_PATH.stat().st_size > 0
    out = {
        "exists": exists,
        "file": EXCEL_NAME if exists else "",
        "path": str(EXCEL_PATH) if exists else "",
        "size": EXCEL_PATH.stat().st_size if exists else 0,
        "source": meta.get("source") or "",
        "rows": int(meta.get("rows") or 0),
        "aircraft_count": int(meta.get("aircraft_count") or 0),
        "raw_rows": int(meta.get("raw_rows") or 0),
        "saved_at": meta.get("saved_at") or "",
        "mail_sent": meta.get("mail_sent") or "",
        "mail_sent_text": meta.get("mail_sent_text") or "",
        "subject": meta.get("subject") or "",
        "slot": meta.get("slot") or "",
    }
    return out


def _norm_ac(raw: str) -> str:
    s = " ".join(str(raw or "").split()).upper()
    match = re.fullmatch(r"(?:VN[\s-]?)?A?[\s-]?(\d{3})", s)
    return f"VN-A{match.group(1)}" if match else ""


_AC_RE = re.compile(r"\b(?:VN[\s-]?)?A\s*(\d{3})\b", re.I)
_BLOCK_TAG_RE = re.compile(r"\[\s*([A-Z][A-Z0-9 /_-]*)\s*\]\s*:?", re.I)


def _text(raw: Any, *, multiline: bool = False) -> str:
    value = str(raw or "").replace("\r\n", "\n").replace("\r", "\n")
    if not multiline:
        return " ".join(value.split())
    return "\n".join(" ".join(line.split()) for line in value.split("\n")).strip()


def _header_key(raw: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", _text(raw).upper())


def _header_columns(row: list[Any]) -> dict[str, int] | None:
    aliases = {
        "ACREG": "reg",
        "AIRCRAFTREG": "reg",
        "AIRCRAFTREGISTRATION": "reg",
        "DEFECT": "defect",
        "DEFECTDESCRIPTION": "defect",
        "ACTIONREQUIREMENT": "action",
        "ACTIONREQUIREMENTS": "action",
    }
    found: dict[str, int] = {}
    for index, cell in enumerate(row):
        name = aliases.get(_header_key(cell))
        if name and name not in found:
            found[name] = index
    return found if {"reg", "defect", "action"}.issubset(found) else None


def _ops_items(raw: str) -> list[str]:
    """Chuẩn hoá một block OPS, giữ mỗi bullet thành một dòng dễ đọc."""
    text = _text(raw, multiline=True)
    if not text:
        return []
    # Một số backend làm mất xuống dòng nhưng vẫn giữ chuỗi `` - YÊU CẦU``.
    text = re.sub(r"\s+(?=-\s+[A-Z0-9])", "\n", text)
    items: list[str] = []
    current: list[str] = []
    bullet_re = re.compile(r"^(?:[-•·●▪◦–—]|\d+[.)])\s*(.*)$")

    def flush() -> None:
        value = " ".join(part for part in current if part).strip()
        if value:
            items.append(value)
        current.clear()

    for raw_line in text.splitlines():
        line = " ".join(raw_line.split()).strip()
        if not line:
            continue
        bullet = bullet_re.match(line)
        if bullet:
            flush()
            current.append(bullet.group(1).strip())
        else:
            current.append(line)
    flush()
    return items


def extract_ops_limit(action_requirement: str) -> str:
    """Chỉ lấy nội dung các block ``[OPS]`` trong ACTION REQUIREMENT."""
    text = _text(action_requirement, multiline=True)
    matches = list(_BLOCK_TAG_RE.finditer(text))
    requirements: list[str] = []
    seen: set[str] = set()
    for index, match in enumerate(matches):
        tag = re.sub(r"[^A-Z0-9]", "", match.group(1).upper())
        if tag != "OPS":
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        for item in _ops_items(text[match.end():end]):
            key = " ".join(item.upper().split())
            if key and key not in seen:
                seen.add(key)
                requirements.append(item)
    return "\n".join(requirements)


def _make_row(reg: str, defect: str, action: str) -> AircraftLimitRow | None:
    normalized_reg = _norm_ac(reg)
    if not normalized_reg:
        return None
    return {
        "reg": normalized_reg,
        "defect": _text(defect),
        "limit": extract_ops_limit(action),
    }


def _extract_pdfplumber(blob: bytes) -> list[AircraftLimitRow]:
    """Backend chính: tìm cột theo header thay vì phụ thuộc vị trí cố định."""
    import pdfplumber

    rows: list[AircraftLimitRow] = []
    with pdfplumber.open(io.BytesIO(blob)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                columns: dict[str, int] | None = None
                current: dict[str, str] | None = None

                def flush() -> None:
                    nonlocal current
                    if current:
                        item = _make_row(
                            current["reg"], current["defect"], current["action"]
                        )
                        if item:
                            rows.append(item)
                    current = None

                for table_row in table:
                    if not table_row:
                        continue
                    detected = _header_columns(table_row)
                    if detected:
                        flush()
                        columns = detected
                        continue
                    if not columns:
                        continue

                    def cell(name: str) -> str:
                        index = columns[name]
                        return _text(
                            table_row[index] if index < len(table_row) else "",
                            multiline=name == "action",
                        )

                    reg = cell("reg")
                    defect = cell("defect")
                    action = cell("action")
                    if _norm_ac(reg):
                        flush()
                        current = {"reg": reg, "defect": defect, "action": action}
                    elif current and (defect or action):
                        if defect:
                            current["defect"] = f"{current['defect']} {defect}".strip()
                        if action:
                            current["action"] = f"{current['action']}\n{action}".strip()
                flush()
    return rows


def _extract_pypdf(blob: bytes) -> list[AircraftLimitRow]:
    """Fallback layout-text: chia DEFECT/ACTION REQUIREMENT theo vị trí header."""
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader  # type: ignore[no-redef]
        except ImportError as exc:
            raise DefectPdfError(
                "Máy chưa có thư viện đọc PDF. Chạy: py -m pip install pypdf"
            ) from exc

    reader = PdfReader(io.BytesIO(blob))
    rows: list[AircraftLimitRow] = []
    for page in reader.pages:
        try:
            text = page.extract_text(extraction_mode="layout") or ""
        except TypeError:  # PyPDF2 / pypdf cũ
            text = page.extract_text() or ""
        lines = text.splitlines()
        positions: dict[str, int] | None = None
        issue_pos: int | None = None
        remark_pos: int | None = None
        for line in lines:
            upper = line.upper()
            reg_pos = upper.find("AC REG")
            defect_pos = upper.find("DEFECT")
            action_pos = upper.find("ACTION REQUIREMENT")
            if reg_pos >= 0 and defect_pos > reg_pos and action_pos > defect_pos:
                positions = {"reg": reg_pos, "defect": defect_pos, "action": action_pos}
                issue_pos = upper.find("ISSUE DATE", reg_pos)
                remark_pos = upper.find("REMARK", action_pos)
                break
        if not positions:
            continue

        current: dict[str, str] | None = None

        def flush() -> None:
            nonlocal current
            if current:
                item = _make_row(current["reg"], current["defect"], current["action"])
                if item:
                    rows.append(item)
            current = None

        for raw in lines:
            if _header_key(raw).find("ACTIONREQUIREMENT") >= 0:
                continue
            line = raw.rstrip()
            reg_end = issue_pos if issue_pos is not None else positions["defect"]
            reg_cell = line[positions["reg"]:reg_end]
            match = _AC_RE.search(reg_cell)
            defect = _text(line[positions["defect"]:positions["action"]])
            action_end = remark_pos if remark_pos is not None else len(line)
            action = _text(line[positions["action"]:action_end], multiline=True)
            if match:
                flush()
                current = {
                    "reg": f"A{match.group(1)}",
                    "defect": defect,
                    "action": action,
                }
            elif current and (defect or action):
                if defect:
                    current["defect"] = f"{current['defect']} {defect}".strip()
                if action:
                    current["action"] = f"{current['action']}\n{action}".strip()
        flush()
    return rows


def _extract_rows_worker(blob: bytes, result_queue: Any) -> None:
    """Đọc bằng backend phù hợp trong process có thể huỷ cưỡng bức."""
    backend = "pdfplumber"
    try:
        try:
            import pdfplumber  # noqa: F401
        except ImportError:
            backend = "pypdf"
        rows = _extract_pdfplumber(blob) if backend == "pdfplumber" else _extract_pypdf(blob)
        if not rows and backend == "pdfplumber":
            backend = "pypdf-fallback"
            rows = _extract_pypdf(blob)
        result_queue.put(("ok", rows, backend))
    except Exception as exc:
        result_queue.put(("error", f"{type(exc).__name__}: {exc}", backend))


def _extract_rows_timed(
    blob: bytes, timeout: float = 120.0
) -> tuple[list[AircraftLimitRow], str]:
    """Giới hạn cứng cho toàn bộ parse, gồm cả mọi backend fallback."""
    ctx = multiprocessing.get_context("spawn")
    result_queue = ctx.Queue(maxsize=1)
    proc = ctx.Process(target=_extract_rows_worker, args=(blob, result_queue), daemon=True)
    proc.start()
    try:
        kind, value, backend = result_queue.get(timeout=timeout)
    except Exception as exc:
        if proc.is_alive():
            proc.terminate()
        proc.join(5)
        raise TimeoutError(
            f"Đọc PDF quá {timeout:.0f} giây nên đã bị huỷ. "
            "PDF có thể quá nặng, bị lỗi hoặc là bản scan ảnh."
        ) from exc
    finally:
        result_queue.close()
    proc.join(30)
    if proc.is_alive():
        proc.terminate()
        proc.join(5)
    if kind == "error":
        raise DefectPdfError(f"Lỗi đọc PDF bằng {backend}: {value}")
    return value, backend


def extract_rows(blob: bytes) -> list[AircraftLimitRow]:
    """Đọc bảng defect với giới hạn cứng tối đa 120 giây."""
    try:
        rows, backend = _extract_rows_timed(blob, timeout=120.0)
    except TimeoutError as exc:
        raise DefectPdfError(str(exc)) from exc

    rows = [row for row in rows if re.fullmatch(r"VN-A\d{3}", row["reg"])]
    log.info("đọc defect PDF bằng %s: %d dòng", backend, len(rows))
    return rows


def group_rows(rows: list[AircraftLimitRow]) -> list[AircraftLimitRow]:
    """Khử các record AMOS lặp nhưng giữ riêng từng defect của cùng một tàu."""
    grouped: list[AircraftLimitRow] = []
    seen: set[tuple[str, str, str]] = set()
    for row in rows:
        item: AircraftLimitRow = {
            "reg": _norm_ac(row.get("reg") or ""),
            "defect": _text(row.get("defect") or ""),
            "limit": _text(row.get("limit") or "", multiline=True),
        }
        key = (
            item["reg"],
            " ".join(item["defect"].upper().split()),
            " ".join(item["limit"].upper().split()),
        )
        if not item["reg"] or key in seen:
            continue
        seen.add(key)
        grouped.append(item)
    return grouped


def _legacy_excel_rows(grouped: list[AircraftLimitRow]) -> list[tuple[str, str]]:
    """Giữ output Excel cũ: một tàu / một dòng, chỉ hai cột tàu và defect."""
    by_aircraft: dict[str, list[str]] = {}
    seen: dict[str, set[str]] = {}
    for row in grouped:
        reg = row["reg"]
        defect = row["defect"]
        by_aircraft.setdefault(reg, [])
        seen.setdefault(reg, set())
        key = " ".join(defect.upper().split())
        if defect and key not in seen[reg]:
            seen[reg].add(key)
            by_aircraft[reg].append(defect)
    return [(reg, " - ".join(defects)) for reg, defects in by_aircraft.items()]


def _write_excel(grouped: list[AircraftLimitRow]) -> bytes:
    """Xuất Excel theo logic hai cột cũ; dữ liệu ba cột chỉ dùng trên UI."""
    try:
        from openpyxl import Workbook
    except ImportError as exc:
        raise DefectPdfError(
            "Chưa cài openpyxl. Chạy: py -m pip install openpyxl"
        ) from exc

    wb = Workbook()
    ws = wb.active
    ws.title = "defect"
    ws.append(["TÀU GIỚI HẠN", "DEFECT ẢNH HƯỞNG"])
    for reg, defects in _legacy_excel_rows(grouped):
        ws.append([reg, defects])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def process_upload(
    blob: bytes, *, source_name: str = "", extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Parse PDF → ghi Excel → trả snapshot aircraft để đồng bộ limits.json."""
    if not blob:
        raise DefectPdfError("File PDF rỗng.")
    rows = extract_rows(blob)
    if not rows:
        src = Path(source_name or "PDF").name
        raise DefectPdfError(
            f"Không tìm thấy bảng defect trong «{src}» "
            "(cần cột AC REG / DEFECT / ACTION REQUIREMENT — "
            "đúng file là SUMMARY MP & OPS LIMITATION LIST, không phải STATUS REPORT)."
        )
    grouped = group_rows(rows)
    xls = _write_excel(grouped)

    ensure_dir()
    tmp = EXCEL_PATH.with_suffix(".tmp")
    tmp.write_bytes(xls)
    tmp.replace(EXCEL_PATH)

    aircraft_count = len({row["reg"] for row in grouped})
    meta = {
        "source": Path(source_name or "upload.pdf").name,
        "rows": len(grouped),
        "aircraft_count": aircraft_count,
        "raw_rows": len(rows),
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "file": EXCEL_NAME,
    }
    for key, value in (extra or {}).items():
        if value not in (None, ""):
            meta[key] = value
    META_PATH.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log.info(
        "defect PDF → Excel: %d dòng / %d tàu (từ %d dòng) ← %s",
        len(grouped), aircraft_count, len(rows), meta["source"],
    )
    return {**status(), **meta, "aircraft": grouped, "ok": True}


def read_excel_bytes() -> tuple[bytes, str]:
    """Đọc Excel đã lưu. Trả (bytes, download_filename)."""
    st = status()
    if not st["exists"]:
        raise FileNotFoundError("Chưa có file Excel defect — hãy upload PDF trước.")
    src = Path(st["source"] or "defect").stem
    dl_name = f"{src}_output.xlsx" if src else EXCEL_NAME
    return EXCEL_PATH.read_bytes(), dl_name
