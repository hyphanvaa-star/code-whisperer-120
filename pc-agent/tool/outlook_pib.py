"""Tải file PIB từ hộp thư Outlook desktop (COM/MAPI).

Vì sao dùng COM chứ không phải Graph API hay IMAP:
  - Graph API cần đăng ký app trên Azure AD, thường phải xin admin tenant duyệt.
  - IMAP basic auth đã bị Microsoft tắt, IMAP OAuth cũng cần đăng ký app.
  - Outlook desktop đã cấu hình sẵn hộp thư -> COM đọc được ngay, không cần
    khai báo mật khẩu ở đâu cả.

LƯU Ý: đọc từ **bản cache của Outlook desktop**, không phải trực tiếp từ server.
Nếu Outlook chưa đồng bộ thì thư mới nhất trên web có thể chưa thấy ở đây — mở
Outlook và để nó sync trước khi chạy.

CÁCH DÙNG
---------
    py outlook_pib.py --days 2
    py outlook_pib.py --callsign VJC91 --days 7
    py outlook_pib.py --days 1 --out D:\\PIB
    py outlook_pib.py --list-folders
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

import config
from utils.logging_setup import get_logger, setup
from utils.parsing import safe_filename

log = get_logger("outlook_pib")

DEFAULT_FOLDER = "PIB"
PIB_DIR = config.DATA_DIR / "pibwx"  # mặc định cũ; runtime dùng config.get_path("pibwx")

# PIB_NORMAL-VJC91-1025766-20260726155736.pdf
_RE_PIB_FILE = re.compile(r"^PIB[_-].*\.pdf$", re.I)
_RE_CS_IN_NAME = re.compile(r"PIB[_-][A-Z]+[_-]([A-Z]{2,3}\d+)", re.I)
_RE_CS_IN_SUBJ = re.compile(r"\b([A-Z]{2,3}\d{1,5})\s*$")


class OutlookError(RuntimeError):
    """Không kết nối được Outlook hoặc không tìm thấy thư mục."""


@dataclass(slots=True)
class PibFile:
    """1 file PIB đã lưu."""

    callsign: str
    path: Path
    received: datetime | None
    subject: str = ""
    skipped: bool = False       # đã có sẵn trên đĩa


@dataclass(slots=True)
class Result:
    saved: list[PibFile] = field(default_factory=list)
    scanned: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def new(self) -> list[PibFile]:
        return [f for f in self.saved if not f.skipped]

    @property
    def by_callsign(self) -> dict[str, list[PibFile]]:
        out: dict[str, list[PibFile]] = {}
        for f in self.saved:
            out.setdefault(f.callsign, []).append(f)
        return out


# --------------------------------------------------------------------------- #
# Kết nối Outlook
# --------------------------------------------------------------------------- #

def _namespace():
    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:  # pragma: no cover
        raise OutlookError(
            "Chưa cài pywin32. Chạy: py -m pip install pywin32"
        ) from exc

    # COM phải khởi tạo riêng cho TỪNG THREAD. Web chạy job ở thread nền nên nếu
    # thiếu dòng này sẽ lỗi "CoInitialize has not been called" — chạy từ CLI
    # (thread chính) thì không lộ ra.
    try:
        pythoncom.CoInitialize()
    except Exception:
        pass

    try:
        return win32com.client.Dispatch("Outlook.Application").GetNamespace("MAPI")
    except Exception as exc:
        raise OutlookError(f"không mở được Outlook: {exc}") from exc


def _walk(folder, depth: int = 0) -> Iterator[tuple[int, Any]]:
    yield depth, folder
    try:
        for i in range(1, folder.Folders.Count + 1):
            yield from _walk(folder.Folders.Item(i), depth + 1)
    except Exception:
        return


def list_folders() -> None:
    """In cây thư mục để biết tên chính xác."""
    ns = _namespace()
    for i in range(1, ns.Folders.Count + 1):
        for depth, f in _walk(ns.Folders.Item(i)):
            try:
                n = f.Items.Count
            except Exception:
                n = "?"
            print(f"{'  ' * depth}{f.Name}  ({n})")


_FOLDER_CACHE = config.CACHE_DIR / "outlook_folders.json"


def _cached_ids(name: str) -> tuple[str, str] | None:
    if not _FOLDER_CACHE.exists():
        return None
    try:
        d = json.loads(_FOLDER_CACHE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    hit = d.get(name.casefold())
    return (hit["entry"], hit["store"]) if hit else None


def _remember(name: str, folder) -> None:
    try:
        entry, store = folder.EntryID, folder.StoreID
    except Exception:
        return
    config.ensure_dirs()
    try:
        d = json.loads(_FOLDER_CACHE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        d = {}
    d[name.casefold()] = {"entry": entry, "store": store, "path": folder.FolderPath}
    _FOLDER_CACHE.write_text(json.dumps(d), encoding="utf-8")


def find_folder(name: str = DEFAULT_FOLDER):
    """Tìm thư mục theo tên (không phân biệt hoa thường).

    Ba bước, nhanh dần xuống chậm:
      1. EntryID đã cache -> ``GetFolderFromID`` là một lời gọi duy nhất.
      2. Truy cập thẳng theo tên ``root.Folders[name]``.
      3. Duyệt bề rộng toàn hộp thư (chậm nhất).

    Vì sao phải làm vậy: mỗi thuộc tính COM là một RPC tới Outlook. Liệt kê hết
    thư mục mất **56 s** khi Outlook đang bận đồng bộ, trong khi tra theo EntryID
    gần như tức thì.
    """
    ns = _namespace()

    ids = _cached_ids(name)
    if ids:
        try:
            f = ns.GetFolderFromID(ids[0], ids[1])
            if f is not None:
                log.debug("thư mục %r lấy từ cache EntryID", name)
                return f
        except Exception:
            log.debug("EntryID cache hỏng, tìm lại")

    # Truy cập thẳng theo tên trên từng store — 1 RPC thay vì liệt kê toàn bộ
    try:
        for i in range(1, ns.Folders.Count + 1):
            root = ns.Folders.Item(i)
            try:
                f = root.Folders[name]
                if f is not None:
                    _remember(name, f)
                    return f
            except Exception:
                continue
    except Exception:
        pass

    target = name.strip().casefold()
    level = [ns.Folders.Item(i) for i in range(1, ns.Folders.Count + 1)]
    while level:
        nxt = []
        for f in level:
            try:
                if f.Name.strip().casefold() == target:
                    _remember(name, f)
                    return f
            except Exception:
                continue
            try:
                nxt.extend(f.Folders.Item(j) for j in range(1, f.Folders.Count + 1))
            except Exception:
                pass
        level = nxt

    raise OutlookError(
        f"không thấy thư mục {name!r} trong Outlook. "
        "Chạy --list-folders để xem tên đúng."
    )


# --------------------------------------------------------------------------- #
# Tải
# --------------------------------------------------------------------------- #

def cs_keys(value: Any) -> set[str]:
    """Khoá so khớp callsign: cả dạng đầy đủ lẫn dạng chỉ chữ số.

    Người dùng hay gõ số trần (``828``) trong khi callsign là ``VJC828``.
    """
    s = re.sub(r"[^A-Za-z0-9]", "", str(value or "")).upper()
    if not s:
        return set()
    keys = {s}
    d = re.sub(r"\D", "", s)
    if d:
        keys.add(d)
    return keys


def _callsign_of(filename: str, subject: str) -> str:
    m = _RE_CS_IN_NAME.search(filename)
    if m:
        return m.group(1).upper()
    m = _RE_CS_IN_SUBJ.search(subject.strip())
    return m.group(1).upper() if m else ""


def download(
    *,
    folder_name: str = DEFAULT_FOLDER,
    days: float = 1.0,
    callsigns: set[str] | None = None,
    out_dir: Path | str | None = None,
    overwrite: bool = False,
    limit: int | None = None,
) -> Result:
    """Lưu attachment PIB trong ``days`` ngày gần nhất.

    Args:
        days: chỉ xét thư nhận trong khoảng này (tính từ hiện tại).
        callsigns: chỉ lấy các callsign này (vd ``{"VJC91"}``); None = tất cả.
        limit: dừng sau khi quét bấy nhiêu thư (để thử nhanh).
    """
    out = Path(out_dir) if out_dir is not None else config.get_path("pibwx")
    out.mkdir(parents=True, exist_ok=True)
    want: set[str] | None = None
    if callsigns:
        want = set()
        for c in callsigns:
            want |= cs_keys(c)

    folder = find_folder(folder_name)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    # Mốc tương ứng theo giờ máy, để so với ReceivedTime (xem ghi chú dưới)
    cut_local = cutoff.astimezone().replace(tzinfo=None)

    # Lọc bằng Restrict + DASL thay vì duyệt hết rồi break:
    #   - nhanh hơn hẳn (Outlook lọc phía store, không phải mỗi thư một lần RPC)
    #   - ĐÚNG hơn: vòng `for` trên Items KHÔNG đảm bảo theo thứ tự Sort(), nên
    #     cách cũ "sort giảm dần rồi break khi gặp thư cũ" có thể dừng sớm và
    #     bỏ sót thư hợp lệ.
    # DASL so `datereceived` theo **UTC**, dù `item.ReceivedTime` trả về giờ máy.
    # Đo trên hộp thư thật (4470 thư, cửa sổ 10h, máy UTC+7):
    #     mốc ghi theo giờ máy  ->  71 thư, KHÔNG có VJC868
    #     mốc ghi theo UTC      -> 142 thư, có VJC868
    # Ghi mốc theo giờ máy làm cửa sổ hụt đúng bằng độ lệch múi giờ: ±10h thành 3h.
    dasl = ("@SQL=\"urn:schemas:httpmail:datereceived\" >= '"
            + cutoff.strftime("%Y-%m-%d %H:%M") + "'")
    src = folder.Items
    try:
        items = src.Restrict(dasl)
    except Exception as exc:
        log.warning("Restrict lỗi (%s) — duyệt toàn bộ thư mục", exc)
        items = src
    try:
        items.Sort("[ReceivedTime]", True)
    except Exception:
        pass

    res = Result()
    log.info("quét %r — %s/%s thư nhận từ %s (= %s) trở lại đây",
             folder.Name, getattr(items, "Count", "?"), getattr(src, "Count", "?"),
             cut_local.strftime("%d/%m %H:%M LT"),
             cutoff.strftime("%d/%m %H:%M UTC"))

    for item in items:
        res.scanned += 1
        if limit and res.scanned > limit:
            break

        try:
            received = item.ReceivedTime
        except Exception:
            continue
        # ReceivedTime của pywin32: GIÁ TRỊ là giờ máy nhưng tzinfo lại bị gắn
        # 'GMT Standard Time' (+00:00). Đo trên hộp thư thật: mọi file lệch đúng
        # +7h so với dấu thời gian UTC trong tên file. Nên KHÔNG dùng tzinfo của
        # nó — bỏ nhãn đi rồi so bằng giờ máy, đúng ý "PIB tính theo giờ LT".
        when = received if isinstance(received, datetime) else None
        if when is not None:
            wall = when.replace(tzinfo=None)
            if wall < cut_local:
                continue       # Restrict đã lọc; đây chỉ là chốt chặn, KHÔNG break

        try:
            subject = item.Subject or ""
            n_att = item.Attachments.Count
        except Exception as exc:
            res.errors.append(f"đọc thư lỗi: {exc}")
            continue

        for k in range(1, n_att + 1):
            try:
                att = item.Attachments.Item(k)
                fname = att.FileName
            except Exception:
                continue
            if not _RE_PIB_FILE.match(fname):
                continue

            cs = _callsign_of(fname, subject)
            if want and not (cs_keys(cs) & want):
                continue

            target = out / safe_filename(fname)
            if target.exists() and not overwrite and target.stat().st_size > 0:
                res.saved.append(PibFile(cs, target, when, subject, skipped=True))
                continue

            try:
                att.SaveAsFile(str(target))
            except Exception as exc:
                res.errors.append(f"{fname}: {exc}")
                continue
            log.info("đã lưu %s (%s)", target.name, cs or "?")
            res.saved.append(PibFile(cs, target, when, subject))

    log.info("quét %d thư | lưu mới %d | bỏ qua %d | lỗi %d",
             res.scanned, len(res.new), len(res.saved) - len(res.new), len(res.errors))
    return res


def index_by_callsign(out_dir: Path | str | None = None) -> dict[str, list[Path]]:
    """Các file PIB đã tải, gom theo callsign — để đối chiếu với FliteBrief."""
    out: dict[str, list[Path]] = {}
    d = Path(out_dir) if out_dir is not None else config.get_path("pibwx")
    if not d.is_dir():
        return out
    for p in d.glob("PIB*.pdf"):
        cs = _callsign_of(p.name, "")
        if cs:
            out.setdefault(cs, []).append(p)
    return out


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="outlook_pib.py",
        description="Tải file PIB từ thư mục Outlook (đọc qua Outlook desktop).",
    )
    ap.add_argument("--folder", default=DEFAULT_FOLDER, help="tên thư mục (mặc định PIB)")
    ap.add_argument("--days", type=float, default=1.0, help="lấy thư trong N ngày qua")
    ap.add_argument("--callsign", action="append", help="chỉ lấy callsign này (lặp được)")
    ap.add_argument("--out", help=f"thư mục lưu (mặc định {PIB_DIR})")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--limit", type=int, help="chỉ quét N thư đầu (thử nhanh)")
    ap.add_argument("--list-folders", action="store_true", help="in cây thư mục rồi thoát")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    setup(logging.DEBUG if args.verbose else logging.INFO)
    config.ensure_dirs()

    try:
        if args.list_folders:
            list_folders()
            return 0

        res = download(
            folder_name=args.folder,
            days=args.days,
            callsigns=set(args.callsign) if args.callsign else None,
            out_dir=args.out or config.get_path("pibwx"),
            overwrite=args.overwrite,
            limit=args.limit,
        )
    except OutlookError as exc:
        log.error("%s", exc)
        return 1

    print(f"\nQuét {res.scanned} thư — lưu mới {len(res.new)}, "
          f"bỏ qua {len(res.saved) - len(res.new)} (đã có)")
    for cs, files in sorted(res.by_callsign.items()):
        new = [f for f in files if not f.skipped]
        print(f"  {cs or '(?)':<10}{len(files)} file" + (f"  ({len(new)} mới)" if new else ""))
    if res.errors:
        print(f"\n{len(res.errors)} lỗi:")
        for e in res.errors[:10]:
            print("  ", e)
    print(f"\nLưu tại: {Path(args.out or config.get_path('pibwx')).resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
