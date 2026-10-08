"""Tải PIB trực tiếp từ hộp thư trên server (Microsoft Graph) — không qua Outlook desktop.

Khác với :mod:`outlook_pib` (đọc bản cache offline của Outlook desktop, đo được
chậm tới 54 giờ), module này gọi thẳng Microsoft Graph nên **luôn thấy thư mới
nhất**, đúng như những gì bạn thấy trên outlook.office.com.

ĐĂNG NHẬP
---------
Dùng device-code: chạy lệnh, mở link hiện ra, nhập mã, đăng nhập bằng chính tài
khoản công ty. Token được lưu lại nên **chỉ phải làm 1 lần**, lần sau tự động.

Không cần tự đăng ký app trên Azure AD — dùng client ID first-party công khai của
Microsoft (đã kiểm chứng tenant VietJet cho phép). Nếu IT yêu cầu dùng app riêng,
truyền ``--client-id`` của app đó.

CÁCH DÙNG
---------
    py graph_pib.py --login                     # đăng nhập lần đầu
    py graph_pib.py --days 2
    py graph_pib.py --callsign VJC91 --days 7
    py graph_pib.py --list-folders
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import quote

import requests

import config
from utils.logging_setup import get_logger, setup
from utils.parsing import safe_filename

log = get_logger("graph_pib")

GRAPH = "https://graph.microsoft.com/v1.0"
AUTHORITY = "https://login.microsoftonline.com/common"

# "Microsoft Graph Command Line Tools" — client ID công khai của Microsoft,
# ĐƯỢC preauthorize để gọi Graph (chính là app mà Connect-MgGraph dùng).
#
# KHÔNG dùng client ID của Microsoft Office (d3590ed6-...): nó khởi tạo device
# flow được nhưng tới bước đăng nhập sẽ bị chặn với
#   AADSTS65002: Consent between first party application ... and first party
#   resource '00000003-0000-0000-c000-000000000000' must be configured via
#   preauthorization
# tức app đó không được phép xin token cho Graph.
DEFAULT_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"

# Dự phòng nếu tenant chặn client trên (thử theo thứ tự bằng --client-id).
ALT_CLIENT_IDS = {
    "graph-cli": "14d82eec-204b-4c2f-b7e8-296a70dab67e",
    "azure-cli": "04b07795-8ddb-461a-bbee-02f9e1bf7b46",
    "powershell": "1950a258-227b-4e31-a9cf-717495945fc2",
}

SCOPES = ["Mail.Read"]

TOKEN_CACHE = config.CACHE_DIR / "msal_token.json"
PIB_DIR = config.DATA_DIR / "pibwx"  # mặc định cũ; runtime dùng config.get_path("pibwx")
DEFAULT_FOLDER = "PIB"

_RE_PIB_FILE = re.compile(r"^PIB[_-].*\.pdf$", re.I)
_RE_CS_IN_NAME = re.compile(r"PIB[_-][A-Z]+[_-]([A-Z]{2,3}\d+)", re.I)
_RE_CS_IN_SUBJ = re.compile(r"\b([A-Z]{2,3}\d{1,5})\s*$")


class GraphError(RuntimeError):
    """Lỗi xác thực hoặc gọi Graph."""


@dataclass(slots=True)
class PibFile:
    callsign: str
    path: Path
    received: datetime | None
    subject: str = ""
    skipped: bool = False


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
# Xác thực
# --------------------------------------------------------------------------- #

def _cache():
    import msal

    c = msal.SerializableTokenCache()
    if TOKEN_CACHE.exists():
        try:
            c.deserialize(TOKEN_CACHE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            log.warning("token cache hỏng, sẽ đăng nhập lại")
    return c


def _save_cache(c) -> None:
    if not c.has_state_changed:
        return
    config.ensure_dirs()
    TOKEN_CACHE.write_text(c.serialize(), encoding="utf-8")
    log.debug("đã lưu token vào %s", TOKEN_CACHE.name)


def get_token(*, client_id: str = DEFAULT_CLIENT_ID, interactive: bool = True) -> str:
    """Lấy access token. Lần đầu phải đăng nhập bằng device-code."""
    try:
        import msal
    except ImportError as exc:
        raise GraphError("Chưa cài msal. Chạy: py -m pip install msal") from exc

    cache = _cache()
    app = msal.PublicClientApplication(client_id, authority=AUTHORITY, token_cache=cache)

    accounts = app.get_accounts()
    if accounts:
        res = app.acquire_token_silent(SCOPES, account=accounts[0])
        if res and "access_token" in res:
            _save_cache(cache)
            log.info("dùng lại token đã lưu (%s)", accounts[0].get("username", "?"))
            return res["access_token"]

    if not interactive:
        raise GraphError("Chưa đăng nhập. Chạy: py graph_pib.py --login")

    flow = app.initiate_device_flow(scopes=SCOPES)
    if "user_code" not in flow:
        raise GraphError(f"không khởi tạo được device flow: {flow}")

    print("\n" + "=" * 66)
    print("  ĐĂNG NHẬP MỘT LẦN")
    print(f"  1. Mở: {flow['verification_uri']}")
    print(f"  2. Nhập mã: {flow['user_code']}")
    print("  3. Đăng nhập bằng tài khoản công ty của bạn")
    print("=" * 66 + "\n")

    res = app.acquire_token_by_device_flow(flow)
    if "access_token" not in res:
        raise GraphError(
            f"đăng nhập thất bại: {res.get('error')} — {res.get('error_description', '')[:300]}"
        )
    _save_cache(cache)
    log.info("đăng nhập OK")
    return res["access_token"]


def account_info(*, client_id: str = DEFAULT_CLIENT_ID) -> dict[str, Any] | None:
    """Thông tin tài khoản đã đăng nhập, ``None`` nếu chưa. Không gọi mạng."""
    try:
        import msal
    except ImportError:
        return None
    if not TOKEN_CACHE.exists():
        return None
    app = msal.PublicClientApplication(client_id, authority=AUTHORITY,
                                       token_cache=_cache())
    accounts = app.get_accounts()
    if not accounts:
        return None
    return {"username": accounts[0].get("username", ""),
            "name": accounts[0].get("name", "")}


def logout() -> bool:
    """Xoá token đã lưu."""
    if TOKEN_CACHE.exists():
        TOKEN_CACHE.unlink()
        return True
    return False


def begin_device_login(*, client_id: str = DEFAULT_CLIENT_ID) -> tuple[Any, Any, dict]:
    """Khởi tạo device flow, trả ``(app, cache, flow)``.

    Tách khỏi :func:`get_token` để giao diện web hiện được mã và link trước,
    rồi mới chờ người dùng đăng nhập ở bước sau.
    """
    import msal

    cache = _cache()
    app = msal.PublicClientApplication(client_id, authority=AUTHORITY, token_cache=cache)
    flow = app.initiate_device_flow(scopes=SCOPES)
    if "user_code" not in flow:
        raise GraphError(f"không khởi tạo được device flow: {flow}")
    return app, cache, flow


def _hint(desc: str) -> str:
    """Gợi ý xử lý cho các mã lỗi AAD hay gặp."""
    if "AADSTS65002" in desc:
        return ("Client ID này không được phép gọi Graph. Thử client khác: "
                "py graph_pib.py --login --client-id "
                + ALT_CLIENT_IDS["azure-cli"])
    if "AADSTS65001" in desc or "consent" in desc.lower():
        return ("Cần cấp quyền Mail.Read. Nếu tenant bắt admin duyệt thì phải "
                "nhờ IT — khi đó vẫn dùng được đường Outlook desktop.")
    if "AADSTS50076" in desc or "AADSTS50079" in desc:
        return "Cần xác thực đa yếu tố (MFA) — làm theo hướng dẫn trên trang đăng nhập."
    if "AADSTS53003" in desc or "conditional access" in desc.lower():
        return ("Bị Conditional Access chặn. Dùng đường Outlook desktop, hoặc "
                "nhờ IT cấp app riêng rồi truyền --client-id.")
    return ""


def finish_device_login(app: Any, cache: Any, flow: dict) -> str:
    """Chờ người dùng hoàn tất đăng nhập rồi lưu token. Chặn cho tới khi xong."""
    res = app.acquire_token_by_device_flow(flow)
    if "access_token" not in res:
        desc = res.get("error_description", "") or ""
        msg = f"{res.get('error')} — {desc[:260]}"
        tip = _hint(desc)
        raise GraphError(f"{msg}\n  → {tip}" if tip else msg)
    _save_cache(cache)
    return res["access_token"]


def _session(token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}",
                      "Accept": "application/json"})
    return s


def _get(s: requests.Session, url: str, **params: Any) -> dict[str, Any]:
    r = s.get(url if url.startswith("http") else GRAPH + url,
              params=params or None, timeout=(15, 120))
    if r.status_code == 401:
        raise GraphError("token hết hạn hoặc bị từ chối — chạy lại với --login")
    if r.status_code == 403:
        raise GraphError(
            "bị từ chối quyền Mail.Read. Có thể tenant chặn client này — "
            "thử --client-id của app do IT cấp."
        )
    r.raise_for_status()
    return r.json()


def _pages(s: requests.Session, url: str, **params: Any) -> Iterator[dict[str, Any]]:
    """Duyệt hết các trang của Graph (@odata.nextLink)."""
    data = _get(s, url, **params)
    while True:
        yield from data.get("value", [])
        nxt = data.get("@odata.nextLink")
        if not nxt:
            return
        data = _get(s, nxt)


# --------------------------------------------------------------------------- #
# Thư mục / thư
# --------------------------------------------------------------------------- #

def walk_folders(s: requests.Session, folder_id: str = "", depth: int = 0
                 ) -> Iterator[tuple[int, dict[str, Any]]]:
    url = "/me/mailFolders" if not folder_id else f"/me/mailFolders/{folder_id}/childFolders"
    for f in _pages(s, url, **{"$top": 100}):
        yield depth, f
        if f.get("childFolderCount"):
            yield from walk_folders(s, f["id"], depth + 1)


def list_folders(token: str) -> None:
    s = _session(token)
    for depth, f in walk_folders(s):
        print(f"{'  ' * depth}{f['displayName']}  ({f.get('totalItemCount', '?')})")


def find_folder(s: requests.Session, name: str = DEFAULT_FOLDER) -> dict[str, Any]:
    target = name.strip().casefold()
    for _, f in walk_folders(s):
        if f["displayName"].strip().casefold() == target:
            return f
    raise GraphError(
        f"không thấy thư mục {name!r}. Chạy --list-folders để xem tên đúng."
    )


def cs_keys(value: Any) -> set[str]:
    """Khoá so khớp callsign: cả dạng đầy đủ lẫn dạng chỉ chữ số (``828`` ~ ``VJC828``)."""
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
    token: str,
    *,
    folder_name: str = DEFAULT_FOLDER,
    days: float = 1.0,
    since: datetime | None = None,
    until: datetime | None = None,
    callsigns: set[str] | None = None,
    out_dir: Path | str | None = None,
    overwrite: bool = False,
    limit: int | None = None,
    on_progress: Any = None,
) -> Result:
    """Tải attachment PIB.

    Khoảng thời gian: dùng ``since``/``until`` nếu có, ngược lại lấy ``days``
    ngày gần nhất. Cửa sổ hai đầu cần thiết khi lọc theo callsign — cùng một số
    hiệu bay lặp lại mỗi ngày nên phải giới hạn thời gian mới lấy đúng PIB.

    ``on_progress(text)`` được gọi mỗi lần lưu/bỏ qua một file, để đẩy tiến độ
    ra giao diện.
    """
    out = Path(out_dir) if out_dir is not None else config.get_path("pibwx")
    out.mkdir(parents=True, exist_ok=True)
    want: set[str] | None = None
    if callsigns:
        want = set()
        for c in callsigns:
            want |= cs_keys(c)

    s = _session(token)
    folder = find_folder(s, folder_name)

    lo = since or (datetime.now(timezone.utc) - timedelta(days=days))
    flt = f"receivedDateTime ge {lo.strftime('%Y-%m-%dT%H:%M:%SZ')} and hasAttachments eq true"
    if until is not None:
        flt += f" and receivedDateTime le {until.strftime('%Y-%m-%dT%H:%M:%SZ')}"

    log.info("thư mục %r (%s thư) — từ %s%s",
             folder["displayName"], folder.get("totalItemCount", "?"),
             lo.strftime("%d/%m %H:%M UTC"),
             f" đến {until:%d/%m %H:%M UTC}" if until else " trở lại đây")

    res = Result()
    msgs = _pages(
        s,
        f"/me/mailFolders/{folder['id']}/messages",
        **{
            "$filter": flt,
            "$select": "id,subject,receivedDateTime",
            "$orderby": "receivedDateTime desc",
            "$top": 50,
        },
    )

    for msg in msgs:
        res.scanned += 1
        if limit and res.scanned > limit:
            break
        subject = msg.get("subject") or ""
        when = None
        if msg.get("receivedDateTime"):
            when = datetime.fromisoformat(msg["receivedDateTime"].replace("Z", "+00:00"))

        try:
            atts = _get(s, f"/me/messages/{msg['id']}/attachments",
                        **{"$select": "id,name,size,contentType"})["value"]
        except (GraphError, requests.RequestException) as exc:
            res.errors.append(f"{subject[:40]}: {exc}")
            continue

        for a in atts:
            name = a.get("name") or ""
            if not _RE_PIB_FILE.match(name):
                continue
            cs = _callsign_of(name, subject)
            if want and not (cs_keys(cs) & want):
                continue

            target = out / safe_filename(name)
            if target.exists() and not overwrite and target.stat().st_size > 0:
                res.saved.append(PibFile(cs, target, when, subject, skipped=True))
                if on_progress:
                    on_progress(f"· đã có {target.name}", cs)
                continue

            try:
                r = s.get(f"{GRAPH}/me/messages/{msg['id']}/attachments/{a['id']}/$value",
                          timeout=(15, 180))
                r.raise_for_status()
                blob = r.content
            except requests.RequestException as exc:
                res.errors.append(f"{name}: {exc}")
                continue

            if not blob:
                res.errors.append(f"{name}: file rỗng")
                continue
            tmp = target.with_suffix(".part")
            tmp.write_bytes(blob)
            tmp.replace(target)
            log.info("đã lưu %s (%s, %.0f KB)", target.name, cs or "?", len(blob) / 1024)
            res.saved.append(PibFile(cs, target, when, subject))
            if on_progress:
                on_progress(f"✓ {target.name} ({len(blob)/1024:.0f} KB)", cs)

    log.info("quét %d thư | lưu mới %d | bỏ qua %d | lỗi %d",
             res.scanned, len(res.new), len(res.saved) - len(res.new), len(res.errors))
    return res


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="graph_pib.py",
        description="Tải PIB thẳng từ server qua Microsoft Graph (không qua Outlook desktop).",
    )
    ap.add_argument("--login", action="store_true", help="đăng nhập rồi thoát")
    ap.add_argument("--client-id", default=DEFAULT_CLIENT_ID,
                    help="client ID khác nếu bị chặn: "
                         + ", ".join(f"{k}={v}" for k, v in ALT_CLIENT_IDS.items()))
    ap.add_argument("--folder", default=DEFAULT_FOLDER)
    ap.add_argument("--days", type=float, default=1.0)
    ap.add_argument("--callsign", action="append")
    ap.add_argument("--out", help=f"thư mục lưu (mặc định {PIB_DIR})")
    ap.add_argument("--overwrite", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--list-folders", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    setup(logging.DEBUG if args.verbose else logging.INFO)
    config.ensure_dirs()

    try:
        token = get_token(client_id=args.client_id)
        if args.login:
            print("Đăng nhập xong. Lần sau chạy thẳng: py graph_pib.py --days 2")
            return 0
        if args.list_folders:
            list_folders(token)
            return 0

        res = download(
            token,
            folder_name=args.folder,
            days=args.days,
            callsigns=set(args.callsign) if args.callsign else None,
            out_dir=args.out or config.get_path("pibwx"),
            overwrite=args.overwrite,
            limit=args.limit,
        )
    except GraphError as exc:
        log.error("%s", exc)
        return 1
    except requests.RequestException as exc:
        log.error("lỗi mạng: %s", exc)
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
