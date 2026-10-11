"""In General Declaration (GD) từ folder Outlook ``GENDEC``.

Ưu tiên hộp chung OMC (``9. GENDEC`` và thư mục con). Không có file thì
mới dò folder GENDEC của mail cá nhân.

Nhập số hiệu (vd 3948) → tìm Excel chứa số đó → đọc TÀU VNAxxx → đối chiếu
REG crewlist. Khớp mới in: sheet 3 (5 bản, dọc), 5 và 6 (1 bản, ngang),
7 (2 bản, ngang). Fit một trang A4. Máy ``RICOH MP 5055``.
"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

import config
from utils.logging_setup import get_logger
from utils.parsing import safe_filename

log = get_logger("gd_print")

FOLDER_NAME = "GENDEC"
PRINTER_HINT = "RICOH MP 5055"
LOOKBACK_H = 7 * 24
MAX_PAGES = 6

# Excel 1-based sheet index, copies, orientation.
PRINT_PLAN: tuple[tuple[int, int, str], ...] = (
    (3, 5, "portrait"),
    (5, 1, "landscape"),
    (6, 1, "landscape"),
    (7, 2, "landscape"),
)

_RE_XLSX = re.compile(r"\.(xlsx|xlsm|xls)$", re.I)
_RE_AC = re.compile(r"\bVN[\s\-]?A[\s\-]?\d{3}\b", re.I)
_RE_TAU = re.compile(r"T[AÀÁẠ]U", re.I)
_RE_DIGITS = re.compile(r"(\d{2,5})")


class GdError(RuntimeError):
    """Không tải / không đối chiếu / không in được GD."""


@dataclass(slots=True)
class GdCheck:
    flight: str
    file_name: str
    path: str
    gd_reg: str
    crew_regs: list[str]
    match: bool
    reason: str = ""


def flights_of(text: str) -> list[str]:
    """Mọi số hiệu trong ô nhập: ``3948 3900`` → ``['3948', '3900']``."""
    out: list[str] = []
    seen: set[str] = set()
    for n in _RE_DIGITS.findall(str(text or "")):
        if n in seen:
            continue
        seen.add(n)
        out.append(n)
    return out


def digits_of(text: str) -> str:
    """Lấy số hiệu chuyến: ``3948``, ``VJC3948`` → ``3948``."""
    found = flights_of(text)
    return found[-1] if found else ""


def contains_flight(text: str, flight: str) -> bool:
    """True nếu ``3948`` xuất hiện như một số, không dính 39480."""
    want = digits_of(flight)
    if not want:
        return False
    return re.search(rf"(?<!\d){re.escape(want)}(?!\d)", str(text or "")) is not None


def normalize_reg(text: str) -> str:
    """``VN-A651`` / ``VNA 651`` / ``vna651`` → ``VNA651`` để so."""
    return re.sub(r"[^A-Z0-9]", "", str(text or "").upper())


def same_reg(left: str, right: str) -> bool:
    a, b = normalize_reg(left), normalize_reg(right)
    return bool(a and b and a == b)


def pretty_reg(text: str) -> str:
    n = normalize_reg(text)
    m = re.fullmatch(r"(VN)A(\d{3})", n)
    if m:
        return f"{m.group(1)}-A{m.group(2)}"
    return str(text or "").strip() or n


def extract_gd_reg(path: Path | str) -> str:
    """Đọc TÀU VNAxxx trong file GD (ưu tiên ô cạnh chữ TÀU)."""
    from openpyxl import load_workbook

    p = Path(path)
    wb = load_workbook(p, data_only=True, read_only=True)
    near: list[str] = []
    all_regs: list[str] = []
    try:
        for ws in wb.worksheets:
            for row in ws.iter_rows(max_row=120, max_col=24, values_only=True):
                texts = [str(c).strip() for c in row if c not in (None, "")]
                if not texts:
                    continue
                joined = " ".join(texts)
                hits = [pretty_reg(m.group(0)) for m in _RE_AC.finditer(joined)]
                all_regs.extend(hits)
                if any(_RE_TAU.search(t) for t in texts):
                    near.extend(hits)
    finally:
        wb.close()
    if near:
        return near[0]
    uniq = list(dict.fromkeys(normalize_reg(x) for x in all_regs if x))
    if not uniq:
        return ""
    return pretty_reg(uniq[0])


def crew_regs_for_digits(digits: str, excel_path: Path | str,
                        sheet_name: str = "") -> list[str]:
    """REG trên crewlist có FLT chứa số hiệu. Giữ thứ tự, bỏ trùng."""
    import excelcmp

    want = digits_of(digits)
    if not want:
        return []
    sheets = excelcmp.read_table(excel_path)
    if not sheets:
        return []
    sheet = next((s for s in sheets if s.name == sheet_name), sheets[0])
    mapping = excelcmp.detect_mapping(sheet.header)
    if "callsign" not in mapping or "reg" not in mapping:
        raise GdError("Crewlist thiếu cột FLT/callsign hoặc REG.")
    out: list[str] = []
    seen: set[str] = set()
    for row in sheet.dicts():
        cs = str(row.get(mapping["callsign"]) or "")
        if not contains_flight(cs, want):
            continue
        raw = str(row.get(mapping["reg"]) or "").strip()
        key = normalize_reg(raw)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(pretty_reg(raw))
    return out


def regs_match(gd_reg: str, crew_regs: list[str]) -> bool:
    return any(same_reg(gd_reg, r) for r in crew_regs)


def dest_dir() -> Path:
    drive = Path("D:/GD")
    try:
        if Path("D:/").exists():
            drive.mkdir(parents=True, exist_ok=True)
            return drive
    except OSError:
        pass
    out = config.DATA_DIR / "gendec"
    out.mkdir(parents=True, exist_ok=True)
    return out


def _att_id(att: dict[str, Any]) -> str:
    return str(att.get("Id") or att.get("id") or "").strip()


def _att_name(att: dict[str, Any]) -> str:
    return str(att.get("Name") or att.get("name") or "")


def pick_xlsx(attachments: list[dict[str, Any]], flight: str) -> dict[str, Any] | None:
    """Chọn Excel có số hiệu trong tên; không thì Excel đầu."""
    xlsx = [a for a in attachments
            if _RE_XLSX.search(_att_name(a)) and _att_id(a)]
    if not xlsx:
        return None
    hit = [a for a in xlsx if contains_flight(_att_name(a), flight)]
    return (hit or xlsx)[0]


# Bit trạng thái spooler cần nói cho người dùng biết (win32print).
_ST_PAPER_OUT = 0x10
_ST_OFFLINE = 0x80
_ST_ERROR = 0x02


def printer_status_text(status: int) -> str:
    bits = int(status or 0)
    notes = []
    if bits & _ST_PAPER_OUT:
        notes.append("hết giấy")
    if bits & _ST_OFFLINE:
        notes.append("offline")
    if bits & _ST_ERROR:
        notes.append("lỗi")
    return ", ".join(notes)


def list_printers() -> list[dict[str, Any]]:
    """Máy in trên máy này: tên, cổng, trạng thái, có phải mặc định không."""
    try:
        import win32print
    except ImportError as exc:
        raise GdError("Máy này chưa có pywin32 — không liệt kê được máy in.") from exc
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    try:
        rows = win32print.EnumPrinters(flags, None, 2)
    except Exception as exc:
        raise GdError(f"Không đọc được danh sách máy in: {exc}") from exc
    try:
        default = str(win32print.GetDefaultPrinter() or "")
    except Exception:
        default = ""
    out: list[dict[str, Any]] = []
    for info in rows:
        name = str(info.get("pPrinterName") or "")
        if not name:
            continue
        status = int(info.get("Status") or 0)
        out.append({
            "name": name,
            "port": str(info.get("pPortName") or ""),
            "status": status,
            "note": printer_status_text(status),
            "default": name.casefold() == default.casefold(),
        })
    return out


def printer_note(name: str) -> str:
    """``hết giấy`` / ``offline`` … của một máy in. Rỗng = đang sẵn sàng."""
    try:
        rows = list_printers()
    except GdError:
        return ""
    for p in rows:
        if p["name"].casefold() == str(name or "").casefold():
            return str(p["note"] or "")
    return ""


def _family_of(hint: str) -> str:
    """Từ đầu của tên máy in — ``RICOH MP 5055`` → ``RICOH``."""
    parts = str(hint or "").split()
    return parts[0] if parts else ""


def resolve_printer(hint: str = "") -> str:
    """Tên máy in Windows để in GD.

    Mỗi máy đặt tên một kiểu: ``RICOH MP 5055 PCL 6``, ``RICOH MP 6055 PCL 6``…
    Nên thứ tự tra là: tên đã chọn trong giao diện → khớp chính xác → khớp đầu
    chuỗi → khớp chứa → **bất kỳ máy RICOH nào** (ưu tiên máy đang sẵn sàng).
    Nhờ vậy mang tool sang máy khác không phải sửa gì.
    """
    want = (str(hint or "").strip()
            or config.get_gd_printer().strip()
            or PRINTER_HINT)
    printers = list_printers()
    names = [p["name"] for p in printers]
    low = want.casefold()

    for n in names:
        if n.casefold() == low:
            return n
    for n in names:
        if n.casefold().startswith(low):
            return n
    for n in names:
        if low in n.casefold():
            return n

    family = _family_of(want).casefold() or "ricoh"
    same_family = [p for p in printers if family in p["name"].casefold()]
    if same_family:
        ready = [p for p in same_family if not p["note"]]
        chosen = (ready or same_family)[0]
        log.info("không thấy %r, dùng máy cùng hãng: %s", want, chosen["name"])
        return chosen["name"]

    raise GdError(
        f"Không thấy máy in {want!r} trên máy này. Máy hiện có: "
        + (", ".join(names[:8]) or "(không có)")
        + ". Chọn máy in trong ô Print GD rồi in lại."
    )


def _registry_port(name: str) -> str:
    """Cổng Excel dùng cho máy in, đọc từ HKCU ``…\\CurrentVersion\\Devices``.

    Giá trị dạng ``winspool,Ne02:`` — đúng chuỗi Excel chờ ở ``ActivePrinter``.
    """
    try:
        import winreg
    except ImportError:
        return ""
    key_path = r"Software\Microsoft\Windows NT\CurrentVersion\Devices"
    for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(root, key_path) as key:
                value, _ = winreg.QueryValueEx(key, str(name or ""))
        except OSError:
            continue
        text = str(value or "")
        if "," in text:
            return text.split(",", 1)[1].strip()
    return ""


def _spooler_port(name: str) -> str:
    """Cổng thật trong spooler Windows (``PORTPROMPT:``, ``USB001:``…)."""
    try:
        import win32print
    except ImportError:
        return ""
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    try:
        rows = win32print.EnumPrinters(flags, None, 2)
    except Exception:
        log.debug("không đọc được cổng máy in", exc_info=True)
        return ""
    for info in rows:
        got = str(info.get("pPrinterName") or "")
        if got.casefold() == str(name or "").casefold():
            return str(info.get("pPortName") or "")
    return ""


def printer_port(name: str) -> str:
    """Cổng để ghép ``Tên on Cổng`` cho Excel.

    Registry trước: đo trên máy thật, ``Microsoft Print to PDF`` có cổng spooler
    là ``PORTPROMPT:`` nhưng Excel lại gọi nó là ``… on Ne01:``. Lấy nhầm cổng
    spooler thì Excel từ chối và vẫn in ra máy mặc định.
    """
    return _registry_port(name) or _spooler_port(name)


def _printer_ok(excel: Any, windows_name: str) -> bool:
    got = str(getattr(excel, "ActivePrinter", "") or "")
    return bool(got) and str(windows_name or "").casefold() in got.casefold()


def _apply_printer(excel: Any, windows_name: str) -> str:
    """Ép Excel dùng đúng máy in, rồi **đọc lại** để chắc chắn đã đổi.

    Excel gọi máy in theo kiểu ``Tên on Cổng``. Bản trước lấy cổng của máy in
    đang active (mặc định là ``Microsoft Print to PDF on Ne01:``) rồi ghép với
    tên RICOH — sai cổng nên Excel từ chối, mà lỗi lại bị nuốt, thành ra bấm
    In GD thì hộp thoại lưu PDF hiện lên. Giờ thử cổng thật rồi kiểm lại; không
    đổi được thì báo lỗi chứ không in sang máy khác.
    """
    if _printer_ok(excel, windows_name):
        return str(excel.ActivePrinter)

    cands: list[str] = []
    port = printer_port(windows_name)
    if port:
        cands.append(f"{windows_name} on {port}")
    cands.append(windows_name)
    # Máy in mạng hay được Excel gọi qua cổng ảo Ne00:…Ne09:, không trùng
    # pPortName của Windows.
    cands += [f"{windows_name} on Ne{n:02d}:" for n in range(10)]

    tried: list[str] = []
    for cand in cands:
        if cand in tried:
            continue
        tried.append(cand)
        try:
            excel.ActivePrinter = cand
        except Exception:
            continue
        if _printer_ok(excel, windows_name):
            return str(excel.ActivePrinter)

    current = str(getattr(excel, "ActivePrinter", "") or "?")
    raise GdError(
        f"Excel không chuyển được sang {windows_name} (đang là {current}). "
        f"Đặt {windows_name} làm máy in mặc định trong Windows rồi bấm In GD "
        "lại — tool không in sang máy khác."
    )


def _swap_default_printer(name: str) -> str:
    """Đặt tạm máy in mặc định của Windows. Trả tên cũ để trả lại sau."""
    try:
        import win32print

        old = str(win32print.GetDefaultPrinter() or "")
        if old.casefold() == str(name or "").casefold():
            return ""
        win32print.SetDefaultPrinter(name)
        log.info("tạm đổi máy in mặc định %s → %s", old, name)
        return old
    except Exception:
        log.debug("không đổi được máy in mặc định", exc_info=True)
        return ""


def _restore_default_printer(name: str) -> None:
    if not name:
        return
    try:
        import win32print

        win32print.SetDefaultPrinter(name)
        log.info("trả lại máy in mặc định %s", name)
    except Exception:
        log.warning("KHÔNG trả lại được máy in mặc định %s", name, exc_info=True)


def _new_excel(win32com: Any) -> Any:
    excel = win32com.client.DispatchEx("Excel.Application")
    excel.Visible = False
    excel.DisplayAlerts = False
    return excel


def print_sheets(path: Path | str, *, printer: str = "",
                 plan: tuple[tuple[int, int, str], ...] = PRINT_PLAN,
                 on_progress: Callable[[str], None] | None = None) -> None:
    """In các sheet theo plan qua Excel COM (Fit one page, A4).

    Hàm này chạy trong luồng nền của job, mà COM đòi **mỗi luồng** phải
    ``CoInitialize`` trước khi Dispatch — không gọi thì Excel ném
    ``com_error -2147221008 'CoInitialize has not been called.'``.
    """
    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:
        raise GdError("Chưa có pywin32 — không điều khiển được Excel để in.") from exc

    xl_portrait, xl_landscape, xl_a4 = 1, 2, 9
    p = Path(path).resolve()
    if not p.is_file():
        raise GdError(f"Không thấy file để in: {p}")
    win_name = resolve_printer(printer)
    say = on_progress or (lambda m: None)
    pythoncom.CoInitialize()
    excel = None
    wb = None
    old_default = ""
    try:
        excel = _new_excel(win32com)
        try:
            active = _apply_printer(excel, win_name)
        except GdError:
            # Excel không nhận tên nào: đổi tạm máy in mặc định của Windows rồi
            # mở lại Excel — bản mới sẽ mở thẳng bằng RICOH. Trả lại mặc định cũ
            # ở finally để không đụng các phần mềm khác.
            old_default = _swap_default_printer(win_name)
            if not old_default:
                raise
            say(f"· đổi tạm máy in mặc định sang {win_name}")
            try:
                excel.Quit()
            except Exception:
                pass
            excel = _new_excel(win32com)
            active = _apply_printer(excel, win_name)
        say(f"· máy in: {active}")
        note = printer_note(win_name)
        if note:
            say(f"⚠ {win_name}: {note} — lệnh in vẫn xếp hàng, "
                "xử lý máy in xong là ra giấy.")
        wb = excel.Workbooks.Open(str(p), ReadOnly=True)
        n_sheets = int(wb.Worksheets.Count)
        need = max(i for i, _, _ in plan)
        if n_sheets < need:
            raise GdError(f"File chỉ có {n_sheets} sheet, cần tới sheet {need}.")
        for idx, copies, orient in plan:
            ws = wb.Worksheets(idx)
            setup = ws.PageSetup
            setup.Orientation = xl_landscape if orient == "landscape" else xl_portrait
            setup.Zoom = False
            setup.FitToPagesWide = 1
            setup.FitToPagesTall = 1
            setup.PaperSize = xl_a4
            say(f"· in sheet {idx} × {copies} "
                f"({'ngang' if orient == 'landscape' else 'dọc'})")
            # Một số driver RICOH/PCL 6 bỏ qua ``Copies=5`` từ Excel COM và chỉ
            # in đúng một bản. Gửi từng job Copies=1 thì spooler không thể nuốt
            # số lượng: sheet 3 tạo 5 job, sheet 7 tạo 2 job. Tổng cộng 9 bản.
            for copy_no in range(1, int(copies) + 1):
                ws.PrintOut(Copies=1, Collate=True)
                if copies > 1:
                    say(f"  · sheet {idx}: đã gửi bản {copy_no}/{copies}")
    finally:
        if wb is not None:
            try:
                wb.Close(SaveChanges=False)
            except Exception:
                pass
        if excel is not None:
            try:
                excel.Quit()
            except Exception:
                pass
        _restore_default_printer(old_default)
        try:
            pythoncom.CoUninitialize()
        except Exception:
            log.debug("CoUninitialize lỗi", exc_info=True)


def _gendec_folders(sess: Any, mailbox: str) -> list[tuple[str, str]]:
    """GENDEC và thư mục con (Others, AIR INDIA, …), tối đa 2 cấp."""
    import outlook_web_pib as owa

    fid, name = owa._find_folder_id(sess, FOLDER_NAME, mailbox=mailbox)
    out = [(fid, name)]
    pending = [(fid, 0)]
    while pending:
        parent, depth = pending.pop()
        if depth >= 2:
            continue
        response = sess.get(
            f"{owa.rest_root(mailbox)}/mailfolders/{parent}/childfolders?$top=100",
            timeout=60,
        )
        if response.status_code >= 400:
            owa._status_code(response, "liệt kê thư mục con GENDEC")
        try:
            kids = list(response.json().get("value") or [])
        except (ValueError, TypeError):
            kids = []
        for kid in kids:
            kid_id = str(kid.get("Id") or kid.get("id") or "")
            kid_name = str(kid.get("DisplayName") or kid.get("displayName") or "")
            if not kid_id:
                continue
            out.append((kid_id, kid_name))
            if int(kid.get("ChildFolderCount") or kid.get("childFolderCount") or 0):
                pending.append((kid_id, depth + 1))
    return out


def _scan_gendec_folder(
    sess: Any,
    fid: str,
    mailbox: str,
    want: str,
    dest: Path,
    say: Callable[[str], None],
) -> Path | None:
    """Tìm Excel của số hiệu trong một folder. Không có thì trả None."""
    import outlook_web_pib as owa

    root = owa.rest_root(mailbox)
    lo = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_H)
    flt = (
        f"ReceivedDateTime ge {lo.strftime('%Y-%m-%dT%H:%M:%SZ')} "
        f"and HasAttachments eq true"
    )
    url: str | None = (
        f"{root}/mailfolders/{fid}/messages"
        f"?$filter={quote(flt)}"
        f"&$select=Id,Subject,ReceivedDateTime"
        f"&$orderby=ReceivedDateTime desc&$top=50"
    )
    pages = 0
    later: list[tuple[str, str]] = []
    seen_n = 0
    while url and pages < MAX_PAGES:
        response = sess.get(url, timeout=60)
        if response.status_code >= 400:
            owa.drop_folder_cache(FOLDER_NAME)
            owa._status_code(response, "liệt kê thư GENDEC")
        try:
            data = response.json()
        except (ValueError, TypeError) as exc:
            raise GdError("Outlook trả dữ liệu thư GENDEC không hợp lệ.") from exc
        for msg in data.get("value") or []:
            subject = str(msg.get("Subject") or msg.get("subject") or "")
            mid = str(msg.get("Id") or msg.get("id") or "")
            if not mid:
                continue
            seen_n += 1
            # Tiêu đề có số hiệu → xử lý ngay; không thì để dành soi tên file.
            if not contains_flight(subject, want):
                later.append((mid, subject))
                continue
            say(f"· thư khớp: {subject[:80]}")
            got = _take_gd(sess, root, mid, subject, want, dest, say, strict=False)
            if got is not None:
                return got
        url = data.get("@odata.nextLink")
        pages += 1
        if not url and pages == 1 and seen_n == 0 and "HasAttachments" in flt:
            # Bộ lọc đính kèm không trả gì — xem lại chỉ theo ngày.
            flt = f"ReceivedDateTime ge {lo.strftime('%Y-%m-%dT%H:%M:%SZ')}"
            url = (f"{root}/mailfolders/{fid}/messages?$filter={quote(flt)}"
                   f"&$select=Id,Subject,ReceivedDateTime"
                   f"&$orderby=ReceivedDateTime desc&$top=50")
    say(f"  ({seen_n} thư trong 7 ngày)")
    # Lượt 2: tiêu đề không ghi số hiệu — soi tên file đính kèm.
    for mid, subject in later[:120]:
        got = _take_gd(sess, root, mid, subject, want, dest, say, strict=True)
        if got is not None:
            return got
    return None


def _list_attachments(sess: Any, root: str, mid: str, say: Callable[[str], None]) -> list:
    """Danh sách đính kèm; Outlook từ chối $select thì gọi lại không $select."""
    last = ""
    for q in ("?$select=Id,Name,Size,ContentType", "?$select=Id,Name", ""):
        try:
            r = sess.get(f"{root}/messages/{mid}/attachments{q}", timeout=45)
        except Exception as exc:  # mạng chập chờn
            last = str(exc)
            continue
        if r.status_code >= 400:
            last = f"HTTP {r.status_code}: {(r.text or '')[:120]}"
            continue
        try:
            return list(r.json().get("value") or [])
        except (ValueError, TypeError):
            last = "dữ liệu không hợp lệ"
    say(f"· không đọc được đính kèm ({last})")
    return []


def _take_gd(sess: Any, root: str, mid: str, subject: str, want: str,
             dest: Path, say: Callable[[str], None], *, strict: bool) -> Path | None:
    import outlook_web_pib as owa

    atts = _list_attachments(sess, root, mid, lambda m: say(m) if not strict else None)
    if strict and not any(contains_flight(_att_name(a), want) for a in atts):
        return None
    att = pick_xlsx(atts, want)
    if att is None:
        if not strict:
            names = ", ".join(_att_name(a) for a in atts) or "không có"
            say(f"· thư không có file Excel (đính kèm: {names[:120]})")
        return None
    name = safe_filename(_att_name(att))
    target = dest / name
    say(f"· thấy {name}")
    if target.is_file() and target.stat().st_size > 0:
        return target
    blob_r = sess.get(
        f"{root}/messages/{mid}/attachments/{_att_id(att)}/$value",
        timeout=120,
    )
    if blob_r.status_code >= 400:
        # Một số hộp không cho /$value — lấy ContentBytes.
        r2 = sess.get(f"{root}/messages/{mid}/attachments/{_att_id(att)}", timeout=120)
        owa._status_code(r2, "tải Excel GD")
        import base64
        blob = base64.b64decode(str(r2.json().get("ContentBytes") or ""))
    else:
        blob = blob_r.content or b""
    if not blob:
        raise GdError(f"{name}: tệp rỗng")
    target.write_bytes(blob)
    log.info("GD lưu %s", target)
    return target




def download_gd(
    flight: str,
    *,
    token: str,
    dest: Path | None = None,
    on_progress: Callable[[str], None] | None = None,
    session: Any | None = None,
) -> Path:
    """Tải Excel GENDEC có số hiệu. Trả đường dẫn file."""
    import outlook_web_pib as owa

    want = digits_of(flight)
    if not want:
        raise GdError("Số hiệu chuyến không hợp lệ.")
    say = on_progress or (lambda m: None)
    dest = dest or dest_dir()
    dest.mkdir(parents=True, exist_ok=True)
    sess = session if session is not None else owa._rest_session(token)
    sources = (
        (config.OMC_SHARED_MAILBOX, "hộp OMC"),
        ("", "mail cá nhân"),
    )
    for mailbox, label in sources:
        try:
            folders = _gendec_folders(sess, mailbox)
        except owa.OwaAuthError:
            raise
        except owa.OwaError as exc:
            say(f"· {label}: {exc}")
            continue
        for fid, name in folders:
            where = f"{mailbox} / {name}" if mailbox else name
            say(f"· thư mục Outlook: {where}")
            found = _scan_gendec_folder(
                sess, fid, mailbox, want, dest, say,
            )
            if found is not None:
                return found
        if mailbox and on_progress:
            say("· chưa có trên hộp OMC — tìm GENDEC mail cá nhân")
    raise GdError(
        f"Không thấy Excel GD có số hiệu {want} trong folder {FOLDER_NAME} "
        f"của hộp OMC lẫn mail cá nhân "
        f"(7 ngày gần đây). Kiểm tra thư GENDEC hoặc đăng nhập Outlook Web."
    )

def check_file(path: Path | str, flight: str, crew_regs: list[str]) -> GdCheck:
    gd_reg = extract_gd_reg(path)
    p = Path(path)
    if not gd_reg:
        return GdCheck(flight, p.name, str(p), "", crew_regs, False,
                       "Không đọc được TÀU VNAxxx trong file GD.")
    if not crew_regs:
        return GdCheck(flight, p.name, str(p), gd_reg, [], False,
                       "Không thấy REG chuyến này trên crewlist.")
    if not regs_match(gd_reg, crew_regs):
        crew = " / ".join(crew_regs)
        return GdCheck(
            flight, p.name, str(p), gd_reg, crew_regs, False,
            f"Tàu GD {pretty_reg(gd_reg)} khác crewlist {crew} — không in.",
        )
    return GdCheck(flight, p.name, str(p), gd_reg, crew_regs, True,
                   f"Tàu khớp: {pretty_reg(gd_reg)}")


def _fresh_owa_token(
    token: str = "",
    *,
    say: Callable[[str], None],
    cancel: threading.Event | None = None,
    force: bool = False,
) -> str:
    """Token còn dùng được; hết hạn thì mở Chrome lấy phiên mới (như PIB)."""
    import outlook_web_pib as owa

    if token and not force:
        return token
    got = owa.ensure_fresh_token(
        timeout_s=420.0, on_status=say, cancel=cancel, force=force,
    )
    if not got:
        raise GdError(
            "Chưa đăng nhập Outlook Web. Vào Công cụ hỗ trợ / Đăng nhập Outlook Web."
        )
    return got


def run(
    flight: str,
    *,
    crew_regs: list[str],
    token: str = "",
    dest: Path | None = None,
    on_progress: Callable[[str], None] | None = None,
    cancel: threading.Event | None = None,
    do_print: bool = True,
) -> GdCheck:
    """Tải → đối chiếu tàu → in nếu khớp."""
    import outlook_web_pib as owa

    say = on_progress or (lambda m: None)
    want = digits_of(flight)
    if not want:
        raise GdError("Nhập số hiệu chuyến, ví dụ 3948.")
    if cancel is not None and cancel.is_set():
        raise GdError("Đã huỷ.")
    try:
        token = _fresh_owa_token(token, say=say, cancel=cancel)
        say(f"▶ tìm GD {want} trong {FOLDER_NAME}")
        try:
            path = download_gd(want, token=token, dest=dest, on_progress=say)
        except owa.OwaAuthError:
            say("Phiên Outlook Web hết hiệu lực — đang lấy phiên mới…")
            owa.invalidate_session()
            token = _fresh_owa_token("", say=say, cancel=cancel, force=True)
            path = download_gd(want, token=token, dest=dest, on_progress=say)
    except owa.OwaCancelled:
        raise GdError("Đã huỷ.") from None
    except owa.OwaAuthError as exc:
        raise GdError(
            "Outlook Web từ chối phiên. "
            "Bấm Đăng nhập Outlook Web trên tab Công cụ hỗ trợ rồi in lại."
        ) from exc
    except owa.OwaError as exc:
        raise GdError(str(exc)) from exc
    if cancel is not None and cancel.is_set():
        raise GdError("Đã huỷ.")
    check = check_file(path, want, crew_regs)
    say(f"· file: {check.file_name}")
    say(f"· tàu GD: {check.gd_reg or '—'}")
    say("· tàu crewlist: " + (" / ".join(check.crew_regs) or "—"))
    if not check.match:
        raise GdError(check.reason)
    say(f"✓ {check.reason}")
    if do_print:
        print_sheets(path, on_progress=say)
        say("✓ đã gửi máy in")
    return check


def run_many(
    text: str,
    *,
    crew_for: Callable[[str], list[str]],
    token: str = "",
    dest: Path | None = None,
    on_progress: Callable[[str], None] | None = None,
    cancel: threading.Event | None = None,
    do_print: bool = True,
) -> list[GdCheck]:
    """In lần lượt từng số hiệu: ``3948 3900`` → 2 chuyến, mỗi chuyến đối chiếu tàu."""
    say = on_progress or (lambda m: None)
    wants = flights_of(text)
    if not wants:
        raise GdError("Nhập số hiệu chuyến, ví dụ 3948 hoặc 3948 3900.")
    checks: list[GdCheck] = []
    errors: list[str] = []
    for i, want in enumerate(wants, 1):
        if cancel is not None and cancel.is_set():
            raise GdError("Đã huỷ.")
        say(f"── {want} ({i}/{len(wants)})")
        try:
            regs = crew_for(want)
            checks.append(run(
                want, crew_regs=regs, token=token, dest=dest,
                on_progress=say, cancel=cancel, do_print=do_print,
            ))
        except GdError as exc:
            errors.append(f"{want}: {exc}")
            say(f"✗ {want}: {exc}")
    if not checks:
        raise GdError("Không in được chuyến nào. " + " | ".join(errors))
    if errors:
        say("⚠ một số chuyến bỏ: " + " | ".join(errors))
    return checks
