"""Cấu hình tập trung cho Flight Dispatch Tool.

Mọi URL, timeout, đường dẫn đều khai báo ở đây — không hardcode rải rác.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Final, Iterable

# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #

BASE_URL: Final[str] = os.getenv("FLITEBRIEF_BASE_URL", "https://vjc.flitebrief.aero")

# Trang login (form Symfony) và endpoint submit
LOGIN_PAGE: Final[str] = "/login"
LOGIN_CHECK: Final[str] = "/login_check"

# Sau khi login thành công server redirect về đây
LANDING_PATH: Final[str] = "/webapp/newdispatch"

# Danh sách chuyến bay (kèm attachments + audit)
GANTTS: Final[str] = "/webapi/gantts"

# Endpoint siêu nhẹ để kiểm session còn sống: 200 + ~0.7 KB khi còn, 401 khi hết.
# ĐỪNG dùng gantts để probe — kể cả days=0 server vẫn dựng đủ 7 MB payload.
PROBE: Final[str] = "/webapi/fleets"

# Crew của 1 sector: .format(sector_id=...)
SECTOR_CREWS: Final[str] = "/webapi/sectors/{sector_id}/crews"

# Danh sách attachment của 1 sector (thường KHÔNG cần — gantts đã trả sẵn)
SECTOR_ATTACHMENTS: Final[str] = "/webapi/sectors/{sector_id}/attachments"

# Tải nội dung 1 attachment. Reverse-engineered: trả application/pdf +
# Content-Disposition: inline; filename="...". Cần CẢ sector_id và attachment_id.
SECTOR_ATTACHMENT_FILE: Final[str] = "/webapi/sectors/{sector_id}/attachments/{attachment_id}"

# OFP dạng PDF (~8-13 KB). Đây là NGUỒN DUY NHẤT có PLD / DOW / MTOW / MLWT —
# JSON của gantts chỉ có TOW, LWT, ZFW; còn field loadsheet thì rỗng toàn bộ.
SECTOR_OFP: Final[str] = "/webapi/sectors/{sector_id}/ofp"
# Nút View OFP trên dispatch. Chuyến chưa REL: /ofp trả 404, /ofp/0 vẫn là
# FlightRelease.pdf. Sau REL hai đường cùng một file.
SECTOR_OFP_VIEW: Final[str] = "/webapi/sectors/{sector_id}/ofp/0"

# Chi tiết 1 sector (46 KB, nhiều field hơn gantts). Hiện chưa dùng: các field
# loadsheet (fuel_payload, fuel_dry_operating_weight...) rỗng ở mọi chuyến.
SECTOR_DETAIL: Final[str] = "/webapi/sectors/{sector_id}"


def url(path: str, **fmt: object) -> str:
    """Ghép path (có thể chứa placeholder) với BASE_URL."""
    if fmt:
        path = path.format(**fmt)
    return f"{BASE_URL}{path}"


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

USER_AGENT: Final[str] = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

CONNECT_TIMEOUT: Final[float] = 15.0
READ_TIMEOUT: Final[float] = 120.0          # gantts?days=1 nặng ~8 MB
TIMEOUT: Final[tuple[float, float]] = (CONNECT_TIMEOUT, READ_TIMEOUT)

RETRY_TOTAL: Final[int] = 4
RETRY_BACKOFF: Final[float] = 0.8
RETRY_STATUS: Final[tuple[int, ...]] = (429, 500, 502, 503, 504)

# Số thread download / gọi crews song song. Đo trên 120 sector: 8 thread mất
# 14.4s, 16 -> 7.4s, 24 -> 4.7s, 48 -> 3.8s (bắt đầu bão hoà). Chọn 24 vì hơn
# nữa chỉ nhanh thêm chút mà tăng tải cho FliteBrief.
MAX_WORKERS: Final[int] = int(os.getenv("FLITEBRIEF_WORKERS", "24"))

# --------------------------------------------------------------------------- #
# Đường dẫn
# --------------------------------------------------------------------------- #

# Khi chạy PyInstaller, module nằm trong ``_internal``; dữ liệu/cấu hình phải ở
# cạnh Sohee Dispatch.exe để người dùng copy cả thư mục sang máy khác.
if getattr(sys, "frozen", False):
    PROJECT_ROOT: Final[Path] = Path(sys.executable).resolve().parent
else:
    PROJECT_ROOT: Final[Path] = Path(__file__).resolve().parent
DATA_DIR: Final[Path] = PROJECT_ROOT / "data"
DOWNLOAD_DIR: Final[Path] = DATA_DIR / "attachments"
CACHE_DIR: Final[Path] = DATA_DIR / "cache"
LOG_DIR: Final[Path] = DATA_DIR / "logs"
COOKIE_FILE: Final[Path] = CACHE_DIR / "cookies.json"

# Cache trọng lượng parse từ OFP. Vẫn lưu đĩa nhưng mỗi lần lấy sẽ đối chiếu
# PDF mới từ FliteBrief (hash) — OFP upload lại sẽ được nhận.
OFP_CACHE_DIR: Final[Path] = CACHE_DIR / "ofp"

# Ngưỡng cảnh báo sát giới hạn: MTOW - TOW <= ngưỡng này -> MARGIN.
MARGIN_KG: Final[float] = float(os.getenv("FLITEBRIEF_MARGIN_KG", "1000"))

# File Excel người dùng nạp lên để đối chiếu — lưu lại để lần sau dùng tiếp.
EXCEL_DIR: Final[Path] = DATA_DIR / "excel"
EXCEL_STATE: Final[Path] = EXCEL_DIR / "_last.json"
EXCEL_MAX_BYTES: Final[int] = 40 * 1024 * 1024
DEFECT_DIR: Final[Path] = DATA_DIR / "defect"

# TTL cache cho gantts (giây). 0 = không cache.
GANTTS_CACHE_TTL: Final[int] = int(os.getenv("FLITEBRIEF_GANTTS_TTL", "300"))

# OpsCore Flight Tracking — OOOI cho cột STATUS. Không nhét mật khẩu vào source.
OPSCORE_BASE_URL: Final[str] = os.getenv(
    "OPSCORE_BASE_URL",
    "https://vjc.flighttracking.opscore.collins.com",
)
OPSCORE_TENANT: Final[str] = os.getenv("OPSCORE_TENANT", "vjc")
OPSCORE_CACHE_TTL: Final[int] = int(os.getenv("OPSCORE_TTL", "30"))

# ATFM VATM — CTOT VJC từ CTOTDistributor. Không login.
ATFM_BASE_URL: Final[str] = os.getenv("ATFM_BASE_URL", "https://atfm.vatm.vn")
ATFM_CACHE_TTL: Final[int] = int(os.getenv("ATFM_TTL", "60"))


def _browser_profile_root() -> Path:
    """Nơi chứa hồ sơ Chrome của Selenium — luôn ưu tiên đĩa cục bộ.

    Trước đây để dưới ``data/``. Khi tool chạy từ ổ mạng thì hồ sơ nằm luôn trên
    ổ mạng: Chrome ghi liên tục hàng nghìn file nhỏ (cookies, LevelDB, cache) nên
    mỗi thao tác thành một lượt đi về SMB — chậm, và hai máy cùng mở thư mục dùng
    chung sẽ tranh nhau một hồ sơ rồi sinh lỗi khoá.

    Đặt tên thư mục theo ``PROJECT_ROOT`` để nhiều bản cài trên cùng một máy không
    giẫm chân nhau. Không lấy được thư mục cục bộ thì quay lại ``data/`` như cũ.
    """
    override = os.getenv("DISPATCH_BROWSER_PROFILE_DIR")
    if override:
        return Path(override).expanduser()
    base = os.getenv("LOCALAPPDATA") or os.getenv("XDG_CACHE_HOME")
    if not base:
        home = Path.home()
        base = str(home / ".cache") if home != Path("/") else ""
    if not base:
        return DATA_DIR
    # hash() của Python bị ngẫu nhiên hoá mỗi tiến trình -> phải băm cố định,
    # nếu không mỗi lần mở tool lại là một hồ sơ mới và đăng nhập lại từ đầu.
    tag = hashlib.sha1(str(PROJECT_ROOT).casefold().encode()).hexdigest()[:8]
    return Path(base) / "DispatchBoard" / f"profiles-{tag}"


BROWSER_PROFILE_DIR: Final[Path] = _browser_profile_root()
# Vị trí cũ, chỉ để nhắc người dùng dọn cho nhẹ ổ mạng.
LEGACY_PROFILE_DIRS: Final[tuple[Path, ...]] = (
    DATA_DIR / "chrome",
    DATA_DIR / "chrome_owa_profile",
)

# Chrome tự tải về một đống thứ chẳng liên quan gì tới việc tool làm. Đo trên hồ
# sơ AviWeb thật (313 MB): cache web chỉ 9 MB, còn lại là model "optimization
# guide" 75 MB, extension nội bộ 76 MB, engine đọc chữ WasmTtsEngine 47 MB, model
# gợi ý tìm kiếm 16 MB. Chúng nằm im vĩnh viễn chứ Chrome không tự xoá, nên hồ sơ
# chỉ có phình. Chặn từ đầu rẻ hơn nhiều so với đi dọn định kỳ.
_LEAN_BROWSER_SWITCHES: Final[tuple[str, ...]] = (
    # Tắt các luồng mạng chạy ngầm, trong đó có component updater — thủ phạm của
    # extension nội bộ, TTS và model gợi ý.
    "--disable-background-networking",
    "--disable-component-update",     # nói rõ thêm, phòng bản Chrome đổi hành vi
    "--disable-breakpad",             # không ghi dump crash
    "--disable-domain-reliability",
    "--no-pings",
    "--disk-cache-size=52428800",     # trần 50 MB cho cache web thật sự
)

_LEAN_DISABLED_FEATURES: Final[tuple[str, ...]] = (
    "OptimizationHints",
    "OptimizationHintsFetching",
    "OptimizationGuideModelDownloading",
    "OptimizationTargetPrediction",
    "InterestFeedContentSuggestions",
)


def lean_browser_args(disable_features: Iterable[str] = ()) -> list[str]:
    """Cờ dòng lệnh giữ hồ sơ Chrome khỏi phình, kèm feature riêng của caller.

    Phải gộp tất cả vào **một** cờ ``--disable-features``: khai hai lần thì Chrome
    chỉ nhận lần cuối, tức là danh sách khai trước bị nuốt mất không báo gì.
    """
    feats = [*_LEAN_DISABLED_FEATURES, *(f for f in disable_features if f)]
    return [*_LEAN_BROWSER_SWITCHES,
            "--disable-features=" + ",".join(dict.fromkeys(feats))]

# --------------------------------------------------------------------------- #
# Đường dẫn người dùng (notice / briefing / reg / PIB+WX)
# --------------------------------------------------------------------------- #

PATHS_FILE: Final[Path] = PROJECT_ROOT / "paths.json"

# Notice / briefing: folder công ty trên hình Đường dẫn file. RegNotice và
# PIB+WX mặc định trên ổ D: — chỉ tạo folder khi bấm Tách PDF / Tải PIB-WX
# (xem ensure_d_folder). Ổ D: không có thì mới xuống data/.
NOTICE_DEFAULT: Final[Path] = Path(
    r"\\172.30.85.253\OMCFile\VJC Files - OMC\OMC PRIVATE\HY\EGTM-LIMIT-NOTICE"
)
BRIEFING_DEFAULT: Final[Path] = Path("D:/")
REG_DRIVE_DIR: Final[Path] = Path("D:/regnotice")
PIBWX_DRIVE_DIR: Final[Path] = Path("D:/Pib+wx")
FPL_DRIVE_DIR: Final[Path] = Path("D:/FPL")
OMNI_DRIVE_DIR: Final[Path] = Path("D:/Omni")
ATC_EZFW_DRIVE_DIR: Final[Path] = Path("D:/ATC-EZFW")
_DRIVE_FALLBACK: Final[dict[str, Path]] = {
    "reg": DATA_DIR / "regnotice",
    "pibwx": DATA_DIR / "pibwx",
    "fpl": DATA_DIR / "excel",
    "omni": DATA_DIR / "omni",
    "atcezfw": DATA_DIR / "atcezfw",
}

PATH_KEYS: Final[dict[str, tuple[str, Path]]] = {
    "notice": ("Folder notice (file cần add)", NOTICE_DEFAULT),
    "briefing": ("Folder briefing", BRIEFING_DEFAULT),
    "reg": ("Folder RegNotice (tách MEL)", REG_DRIVE_DIR),
    "pibwx": ("Folder PIB + WX (tải về)", PIBWX_DRIVE_DIR),
    "fpl": ("Folder Flight Plan (Outlook)", FPL_DRIVE_DIR),
    "omni": ("Folder Omni (EST)", OMNI_DRIVE_DIR),
    "atcezfw": ("Folder ATC + EZFW", ATC_EZFW_DRIVE_DIR),
}
_DRIVE_FOLDERS: Final[dict[str, Path]] = {
    "reg": REG_DRIVE_DIR,
    "pibwx": PIBWX_DRIVE_DIR,
    "fpl": FPL_DRIVE_DIR,
    "omni": OMNI_DRIVE_DIR,
    "atcezfw": ATC_EZFW_DRIVE_DIR,
}

_PATHS_CACHE: dict[str, str] | None = None


def read_paths_file() -> dict[str, str]:
    """Đọc paths.json — {} nếu chưa có / hỏng."""
    if not PATHS_FILE.exists():
        return {}
    try:
        raw = json.loads(PATHS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v).strip() for k, v in raw.items() if str(v).strip()}


MAIL_SIGNATURE_FILE: Final[Path] = PROJECT_ROOT / "mail_signature.html"
# Banner cuối chữ ký. Ảnh phải đi kèm thư dạng inline attachment (cid:) — dán
# thẳng <img src="data:..."> thì Outlook chặn, còn link máy nội bộ thì người
# nhận không thấy.
MAIL_SIGNATURE_IMAGES: Final[tuple[str, ...]] = (
    "mail_signature.png", "mail_signature.jpg", "mail_signature.jpeg",
    "mail_signature.gif",
)


def get_mail_signature_image() -> Path | None:
    """Ảnh banner cạnh tool để chèn cuối chữ ký. None = không có."""
    for name in MAIL_SIGNATURE_IMAGES:
        path = PROJECT_ROOT / name
        if path.is_file() and path.stat().st_size > 0:
            return path
    return None


def get_mail_signature() -> str:
    """Chữ ký HTML chèn cuối mail nháp ATC+EZFW. Rỗng = không chèn.

    Outlook chỉ tự gắn chữ ký khi soạn thư **trên giao diện**; thư tạo qua REST
    thì không có, nên chữ ký của hộp thư chung phải để sẵn trong
    ``mail_signature.html`` cạnh tool (copy từ Outlook rồi dán vào file).
    """
    if not MAIL_SIGNATURE_FILE.is_file():
        return ""
    try:
        return MAIL_SIGNATURE_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def get_gd_printer() -> str:
    """Máy in đã chọn cho Print GD trên MÁY NÀY. Rỗng = tự dò họ RICOH.

    Nằm trong ``paths.json`` vì đây cũng là thứ gắn với từng máy, không mang
    theo khi copy gói sang máy khác (mỗi nơi đặt tên máy in một kiểu:
    ``RICOH MP 5055 PCL 6``, ``RICOH MP 6055 PCL 6``…).
    """
    env = (os.getenv("DISPATCH_GD_PRINTER") or "").strip()
    if env:
        return env
    return (read_paths_file().get("gd_printer") or "").strip()


def save_gd_printer(name: str) -> str:
    """Ghi máy in Print GD vào paths.json, giữ nguyên các đường dẫn khác."""
    global _PATHS_CACHE
    picked = str(name or "").strip()
    data = read_paths_file()
    if picked:
        data["gd_printer"] = picked
    else:
        data.pop("gd_printer", None)
    PATHS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _PATHS_CACHE = dict(data)
    return picked


def safe_resolve(path: Path | str) -> Path:
    """``Path.resolve()`` trên Windows nổ WinError 3 ``'D:\\\\'`` nếu ổ D: không có.

    Chỉ cần đường dẫn tuyệt đối để đưa Chrome / ghi file — không bắt ổ phải tồn tại.
    """
    p = Path(path)
    try:
        return p.resolve()
    except OSError:
        if p.is_absolute():
            return p
        try:
            return (Path.cwd() / p)
        except OSError:
            return p


def get_path(kind: str) -> Path:
    """Đường dẫn đang dùng cho ``kind`` — file người dùng, không thì mặc định data/."""
    global _PATHS_CACHE
    if kind not in PATH_KEYS:
        raise KeyError(kind)
    if _PATHS_CACHE is None:
        _PATHS_CACHE = read_paths_file()
    custom = (_PATHS_CACHE or {}).get(kind, "").strip()
    if custom:
        return Path(custom).expanduser()
    return PATH_KEYS[kind][1]


def save_paths(updates: dict[str, str]) -> dict[str, str]:
    """Ghi một hoặc nhiều đường dẫn vào paths.json (merge, giữ key khác)."""
    global _PATHS_CACHE
    data = read_paths_file()
    for kind, val in updates.items():
        if kind not in PATH_KEYS:
            raise ValueError(f"loại đường dẫn không hợp lệ: {kind!r}")
        p = str(val or "").strip()
        if not p:
            data.pop(kind, None)
            continue
        path = Path(p).expanduser()
        _mkdir_quiet(path)
        if not path.is_dir():
            raise ValueError(f"không phải thư mục: {path}")
        data[kind] = str(path.resolve())
    PATHS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _PATHS_CACHE = dict(data)
    return data


def paths_status() -> dict[str, Any]:
    """Trạng thái các đường dẫn cho UI."""
    data = read_paths_file()
    out: dict[str, dict[str, object]] = {}
    for kind, (label, default) in PATH_KEYS.items():
        custom = data.get(kind, "").strip()
        path = Path(custom).expanduser() if custom else default
        exists = path.is_dir()
        out[kind] = {
            "label": label,
            "path": str(path.resolve()) if (exists or custom) else str(path),
            "default": str(default),
            "source": "file" if custom else "default",
            "exists": exists,
        }
    return {"paths": out, "file": str(PATHS_FILE)}


def pick_directory(title: str = "Chọn thư mục") -> str | None:
    """Mở hộp thoại chọn folder native (máy chạy server). None = huỷ."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    root.update_idletasks()
    try:
        chosen = filedialog.askdirectory(title=title, mustexist=True)
    finally:
        try:
            root.destroy()
        except tk.TclError:
            pass
    return chosen or None


def _is_unc(path: Path) -> bool:
    raw = str(path)
    return raw.startswith("\\\\") or raw.startswith("//")


def _mkdir_quiet(path: Path) -> None:
    """Tạo thư mục; bỏ qua ổ mạng (UNC treo 20–45s nếu mất share) và ổ D: chưa sẵn."""
    if _is_unc(path):
        return
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass


def ensure_d_folder(kind: str) -> Path:
    """Tạo folder trên ổ D: lúc tách PDF / tải PIB-WX / FPL / Omni.

    Đã chọn folder rồi thì giữ nguyên. Ổ D: không có thì dùng ``data/``.
    """
    dest = _DRIVE_FOLDERS.get(kind)
    if dest is None:
        raise KeyError(kind)
    custom = read_paths_file().get(kind, "").strip()
    if custom:
        current = Path(custom).expanduser()
        if current.is_dir():
            return current
    try:
        dest.mkdir(parents=True, exist_ok=True)
    except OSError:
        fallback = _DRIVE_FALLBACK[kind]
        _mkdir_quiet(fallback)
        return fallback
    if custom != str(dest):
        save_paths({kind: str(dest)})
    return dest


def ensure_dirs() -> None:
    for d in (DATA_DIR, DOWNLOAD_DIR, CACHE_DIR, LOG_DIR, EXCEL_DIR,
              OFP_CACHE_DIR, DEFECT_DIR):
        d.mkdir(parents=True, exist_ok=True)
    for key in PATH_KEYS:
        if key in _DRIVE_FOLDERS:
            continue
        _mkdir_quiet(get_path(key))


# --------------------------------------------------------------------------- #
# Credentials
# --------------------------------------------------------------------------- #

CREDENTIALS_FILE: Final[Path] = PROJECT_ROOT / "credentials.json"


def get_omni_credentials() -> tuple[str, str]:
    """User/pass của InFlight Omni (ifs-backoffice.vietjetair.com).

    Cùng cơ chế với FliteBrief: env trước, rồi ``credentials.json`` (đã nằm trong
    .gitignore). Khoá trong file là ``omni_username`` / ``omni_password``.
    """
    user = os.getenv("OMNI_USER")
    password = os.getenv("OMNI_PASS")
    if user and password:
        return user, password

    if CREDENTIALS_FILE.exists():
        raw = json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
        user = user or raw.get("omni_username")
        password = password or raw.get("omni_password")

    if not user or not password:
        raise RuntimeError(
            "Thiếu tài khoản Omni. Đặt OMNI_USER / OMNI_PASS hoặc thêm vào "
            f'{CREDENTIALS_FILE.name}: {{"omni_username": "...", '
            '"omni_password": "..."}'
        )
    return user, password


def get_opscore_credentials() -> tuple[str, str]:
    """User/pass OpsCore: env ``OPSCORE_USER``/``OPSCORE_PASS`` then credentials.json."""
    user = os.getenv("OPSCORE_USER") or ""
    password = os.getenv("OPSCORE_PASS") or ""
    if user and password:
        return user.strip(), password
    data = read_credentials_file()
    user = (data.get("opscore_username") or "").strip()
    password = data.get("opscore_password") or ""
    if not user or not password:
        raise RuntimeError(
            "Thiếu tài khoản OpsCore. Đặt OPSCORE_USER / OPSCORE_PASS hoặc "
            f"{CREDENTIALS_FILE.name}"
        )
    return user, password


def get_credentials() -> tuple[str, str]:
    """Lấy user/pass theo thứ tự: biến môi trường -> credentials.json.

    credentials.json nằm trong .gitignore để không commit mật khẩu.
    """
    user = os.getenv("FLITEBRIEF_USER")
    password = os.getenv("FLITEBRIEF_PASS")
    if user and password:
        return user, password

    if CREDENTIALS_FILE.exists():
        raw = json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
        user = user or raw.get("username")
        password = password or raw.get("password")

    if not user or not password:
        raise RuntimeError(
            "Thiếu credentials. Đặt FLITEBRIEF_USER / FLITEBRIEF_PASS "
            f"hoặc tạo file {CREDENTIALS_FILE.name} dạng "
            '{"username": "...", "password": "..."}'
        )
    return user, password


def get_owa_credentials() -> tuple[str, str]:
    """User/pass Outlook Web: env ``OWA_USER``/``OWA_PASS`` → ``credentials.json``.

    Trả ``("", "")`` nếu chưa cấu hình — caller tự quyết định bỏ qua auto-login.
    """
    user = os.getenv("OWA_USER") or os.getenv("OUTLOOK_USER") or ""
    password = os.getenv("OWA_PASS") or os.getenv("OUTLOOK_PASS") or ""
    if user and password:
        return user.strip(), password

    data = read_credentials_file()
    user = (data.get("owa_username") or "").strip()
    password = data.get("owa_password") or ""
    return user, password


OMC_SHARED_MAILBOX: Final[str] = "omc@vietjetair.com"


def get_outlook_mailbox() -> str:
    """Hộp thư lưu nháp ATC+EZFW. Rỗng = hộp riêng của người đăng nhập.

    Thứ tự: env ``OUTLOOK_MAILBOX`` → ``credentials.json``
    (``outlook_mailbox``) → hộp thư chung OMC. Để trống ô này trong Account log
    thì nháp về lại hộp riêng.
    """
    env = os.getenv("OUTLOOK_MAILBOX")
    if env is not None:
        return env.strip()
    data = read_credentials_file()
    if "outlook_mailbox" in data:
        return str(data.get("outlook_mailbox") or "").strip()
    return OMC_SHARED_MAILBOX


def save_outlook_mailbox(address: str) -> str:
    """Ghi hộp thư soạn nháp vào credentials.json. Rỗng = nháp về hộp riêng.

    Luôn ghi khoá (kể cả rỗng) để lần sau không rơi lại về hộp chung mặc định.
    """
    addr = str(address or "").strip()
    if addr and "@" not in addr:
        raise ValueError(
            "Hộp thư soạn nháp phải là địa chỉ email đầy đủ, "
            "ví dụ omc@vietjetair.com (tên hiển thị như «VJC OMC» không dùng được)."
        )
    data = read_credentials_file()
    data["outlook_mailbox"] = addr
    ensure_dirs()
    CREDENTIALS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return addr


def get_outlook_mail_credentials() -> tuple[str, str]:
    """User/pass chỉ để soạn nháp ATC/EZFW — không dùng cho PIB/GENDEC."""
    user = os.getenv("OUTLOOK_MAIL_USER") or ""
    password = os.getenv("OUTLOOK_MAIL_PASS") or ""
    if user and password:
        return user.strip(), password
    data = read_credentials_file()
    user = (data.get("outlook_username") or "").strip()
    password = data.get("outlook_password") or ""
    return user, password


# Mặc định khi chưa có env / credentials.json — giữ hành vi cũ của atcfpl.
DEFAULT_AVIWEB_USER: Final[str] = "omc@vietjetair.com"
DEFAULT_AVIWEB_PASS: Final[str] = "Omc@123456"


def get_jetplan_credentials() -> tuple[str, str]:
    """User/pass JetPlan.com — env ``JETPLAN_USER``/``JETPLAN_PASS`` rồi file."""
    user = os.getenv("JETPLAN_USER") or ""
    password = os.getenv("JETPLAN_PASS") or ""
    if user and password:
        return user.strip(), password
    data = read_credentials_file()
    user = (data.get("jetplan_username") or "").strip()
    password = data.get("jetplan_password") or ""
    if not user or not password:
        raise RuntimeError(
            "Thiếu tài khoản JetPlan. Đặt JETPLAN_USER / JETPLAN_PASS hoặc "
            f'{CREDENTIALS_FILE.name}: {{"jetplan_username": "...", '
            '"jetplan_password": "..."}'
        )
    return user, password


def get_aviweb_credentials() -> tuple[str, str]:
    """User/pass AviWeb (VNAIC): env → ``credentials.json`` → mặc định OMC.

    Env: ``AVIWEB_USER`` / ``AVIWEB_PASS``. File: ``aviweb_username`` /
    ``aviweb_password``. Luôn trả cặp hợp lệ để Submit/Check ATC không vỡ khi
    chưa mở Account log lần nào.
    """
    user = os.getenv("AVIWEB_USER")
    password = os.getenv("AVIWEB_PASS")
    if user and password:
        return user.strip(), password

    data = read_credentials_file()
    user = (user or data.get("aviweb_username") or "").strip()
    password = password or data.get("aviweb_password") or ""
    if not user:
        user = DEFAULT_AVIWEB_USER
    if not password:
        password = DEFAULT_AVIWEB_PASS
    return user, password


# --------------------------------------------------------------------------- #
# Sửa credentials từ giao diện
# --------------------------------------------------------------------------- #

# Khoá trong credentials.json cho từng hệ thống. Giao diện chỉ được sửa các
# kind này — tránh việc gửi lên một key lạ rồi ghi rác vào file.
CRED_KEYS: Final[dict[str, tuple[str, str, str]]] = {
    # kind: (khoá user, khoá pass, tên hiển thị)
    "flitebrief": ("username", "password", "FliteBrief"),
    "omni": ("omni_username", "omni_password", "InFlight Omni"),
    "owa": ("owa_username", "owa_password", "Outlook Web"),
    "outlook": ("outlook_username", "outlook_password", "Outlook (mail nháp)"),
    "aviweb": ("aviweb_username", "aviweb_password", "AviWeb"),
}


def read_credentials_file() -> dict[str, str]:
    """Nội dung credentials.json, hoặc {} nếu chưa có / file hỏng.

    Không raise: giao diện phải mở được cả khi chưa có file nào để người dùng
    nhập lần đầu.
    """
    if not CREDENTIALS_FILE.exists():
        return {}
    try:
        raw = json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {k: str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}


def save_credentials(kind: str, username: str, password: str) -> None:
    """Ghi user/pass của một hệ thống vào credentials.json.

    Đọc–sửa–ghi để **giữ nguyên** khoá của hệ thống kia: file dùng chung cho cả
    FliteBrief và Omni, ghi đè cả file là xoá mất tài khoản còn lại.

    ``password`` rỗng nghĩa là "giữ mật khẩu cũ" — giao diện không đọc mật khẩu
    đã lưu về, nên người dùng đổi riêng username thì không phải nhập lại pass.
    """
    if kind not in CRED_KEYS:
        raise ValueError(f"hệ thống không hợp lệ: {kind!r}")
    u_key, p_key, label = CRED_KEYS[kind]

    username = username.strip()
    if not username:
        raise ValueError(f"Chưa nhập tên đăng nhập {label}")

    data = read_credentials_file()
    if not password and not data.get(p_key):
        # Lần đầu lưu AviWeb từ UI (đang dùng mặc định) — ghi luôn pass mặc định
        # nếu ô mật khẩu để trống, khỏi bắt nhập lại mật khẩu cũ.
        if kind == "aviweb":
            password = DEFAULT_AVIWEB_PASS
        else:
            raise ValueError(f"Chưa nhập mật khẩu {label}")

    data[u_key] = username
    if password:
        data[p_key] = password

    ensure_dirs()
    CREDENTIALS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def credentials_status() -> dict[str, dict[str, object]]:
    """Trạng thái hai tài khoản để hiện lên giao diện — **không** trả mật khẩu.

    ``source`` cho biết giá trị đang thực sự có hiệu lực đến từ đâu: biến môi
    trường luôn thắng file, nên nếu env đang đặt thì sửa trong giao diện sẽ ghi
    được vào file mà vẫn không đổi tài khoản đang dùng — phải nói rõ chỗ này.
    """
    data = read_credentials_file()
    env = {"flitebrief": ("FLITEBRIEF_USER", "FLITEBRIEF_PASS"),
           "omni": ("OMNI_USER", "OMNI_PASS"),
           "owa": ("OWA_USER", "OWA_PASS"),
           "outlook": ("OUTLOOK_MAIL_USER", "OUTLOOK_MAIL_PASS"),
           "aviweb": ("AVIWEB_USER", "AVIWEB_PASS")}
    out: dict[str, dict[str, object]] = {}
    for kind, (u_key, p_key, label) in CRED_KEYS.items():
        e_user, e_pass = env[kind]
        env_user, env_pass = os.getenv(e_user), os.getenv(e_pass)
        from_env = bool(env_user and env_pass)
        out[kind] = {
            "label": label,
            "username": (env_user if from_env else data.get(u_key)) or "",
            "has_password": bool(env_pass if from_env else data.get(p_key)),
            "source": "env" if from_env else ("file" if data.get(u_key) else "none"),
            "env_names": [e_user, e_pass],
        }
    out["outlook"]["mailbox"] = get_outlook_mailbox()
    # AviWeb còn fallback mặc định OMC — hiện rõ để người dùng biết đang dùng gì.
    aw = out["aviweb"]
    if aw["source"] == "none":
        aw["username"] = DEFAULT_AVIWEB_USER
        aw["has_password"] = bool(DEFAULT_AVIWEB_PASS)
        aw["source"] = "default"
    return out


# --------------------------------------------------------------------------- #
# Cổng vào Dispatch Board (gate)
# --------------------------------------------------------------------------- #

GATE_COOKIE: Final[str] = "dispatch_gate"
# Chỉ dùng khi chưa đặt DISPATCH_GATE_PASS / gate_password — đổi ngay trong credentials.json
_GATE_FALLBACK: Final[str] = "221098"


def get_gate_password() -> str:
    """Mật khẩu mở cổng: env ``DISPATCH_GATE_PASS`` → ``credentials.json`` ``gate_password``.

    Chưa cấu hình thì tạm dùng fallback (để không khoá bạn lúc nâng cấp) — nên đổi ngay.
    """
    env = (os.getenv("DISPATCH_GATE_PASS") or os.getenv("GATE_PASS") or "").strip()
    if env:
        return env
    data = read_credentials_file()
    pw = str(data.get("gate_password") or "").strip()
    return pw or _GATE_FALLBACK


def gate_password_is_default() -> bool:
    """True nếu đang dùng fallback / chưa tự đặt mật khẩu riêng."""
    env = (os.getenv("DISPATCH_GATE_PASS") or os.getenv("GATE_PASS") or "").strip()
    if env:
        return False
    data = read_credentials_file()
    return not str(data.get("gate_password") or "").strip()


def gate_cookie_token() -> str:
    """Token cookie ổn định theo mật khẩu hiện tại (đổi pass → cookie cũ hết hiệu lực)."""
    import hashlib
    pw = get_gate_password()
    return hashlib.sha256(f"dispatch-gate-v1|{pw}".encode("utf-8")).hexdigest()
