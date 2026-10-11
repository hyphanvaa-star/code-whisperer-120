"""Mở Chrome bằng Selenium Manager — không ghim chromedriver theo số bản.

Selenium 4.6+ tự lấy driver khớp Chrome đang cài (``webdriver.Chrome()``,
không ``executable_path``). Tool từng ưu tiên file cache trong hồ sơ → Chrome
cập nhật là Outlook/ATC vỡ (driver 140, Chrome 143).

Thứ tự: Selenium Manager trước; nếu mạng/antivirus chặn thì mới dùng file local
đúng số bản (env / drivers / cache). Lần Manager thành công vẫn copy vào hồ sơ
để máy công ty lần sau còn bản khớp khi offline.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import config
from utils.logging_setup import get_logger

log = get_logger("chrome_drv")

DRIVER_NAME = "chromedriver.exe" if os.name == "nt" else "chromedriver"
_CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

_MSG = (
    "Không mở được Chrome (thiếu chromedriver). Việc này không liên quan "
    "Outlook còn đăng nhập hay không — Check ATC / AviWeb cần một Chrome "
    "riêng. Máy công ty thường chặn tool tự tải driver. Copy chromedriver.exe "
    "(cùng bản với Chrome) vào thư mục drivers cạnh tool, hoặc đặt biến "
    "DISPATCH_CHROMEDRIVER trỏ tới file đó."
)

_STALE = (
    "Chrome vừa cập nhật, chromedriver cũ không khớp (session not created). "
    "Tool tự tải bản mới nếu mạng cho phép. Máy công ty hay chặn: mở "
    "chrome://version, tải chromedriver cùng số bản rồi copy vào thư mục "
    "drivers cạnh tool, hoặc đặt DISPATCH_CHROMEDRIVER."
)


class ChromeDriverError(RuntimeError):
    """Không tìm / không chạy được chromedriver."""


def tool_driver_path() -> Path:
    return config.BROWSER_PROFILE_DIR / "drivers" / DRIVER_NAME


def _looks_like_driver(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 500_000
    except OSError:
        return False


def _iter_candidates() -> list[Path]:
    found: list[Path] = []
    seen: set[str] = set()

    def add(path: Path | None) -> None:
        if path is None:
            return
        try:
            key = str(path.resolve()).casefold()
        except OSError:
            key = str(path).casefold()
        if key in seen:
            return
        seen.add(key)
        found.append(path)

    for env in (os.getenv("DISPATCH_CHROMEDRIVER"), os.getenv("CHROMEDRIVER")):
        if env:
            add(Path(env).expanduser())

    root = config.PROJECT_ROOT
    add(root / "drivers" / DRIVER_NAME)
    add(root / DRIVER_NAME)
    if getattr(sys, "frozen", False):
        add(root / "_internal" / "drivers" / DRIVER_NAME)
        add(root / "_internal" / DRIVER_NAME)
    add(tool_driver_path())

    home_cache = Path.home() / ".cache" / "selenium" / "chromedriver"
    if home_cache.is_dir():
        try:
            cached = sorted(
                home_cache.rglob(DRIVER_NAME),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
        except OSError:
            cached = []
        for path in cached:
            add(path)

    which = shutil.which("chromedriver")
    if which:
        add(Path(which))
    return found


def _major_of(text: str) -> int | None:
    m = re.search(r"\b(\d{2,3})\.\d+\.\d+", text or "")
    if m:
        return int(m.group(1))
    return None


def chrome_major() -> int | None:
    """Số bản chính của Chrome đang cài — None nếu không đọc được."""
    roots = []
    for key in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        base = os.environ.get(key) or ""
        if base:
            roots.append(Path(base) / "Google" / "Chrome" / "Application")
    majors: list[int] = []
    for root in roots:
        if not root.is_dir():
            continue
        try:
            kids = list(root.iterdir())
        except OSError:
            continue
        for kid in kids:
            if kid.is_dir():
                n = _major_of(kid.name)
                if n:
                    majors.append(n)
            elif kid.name.casefold() == "chrome.exe":
                n = _win_file_major(kid)
                if n:
                    majors.append(n)
    return max(majors) if majors else None


def _win_file_major(exe: Path) -> int | None:
    if os.name != "nt":
        return None
    try:
        import ctypes
        from ctypes import wintypes
    except ImportError:
        return None
    get_size = ctypes.windll.version.GetFileVersionInfoSizeW
    get_info = ctypes.windll.version.GetFileVersionInfoW
    ver_query = ctypes.windll.version.VerQueryValueW
    size = get_size(str(exe), None)
    if not size:
        return None
    buf = ctypes.create_string_buffer(size)
    if not get_info(str(exe), 0, size, buf):
        return None
    ptr = ctypes.c_void_p()
    length = wintypes.UINT()
    if not ver_query(buf, r"\\", ctypes.byref(ptr), ctypes.byref(length)):
        return None

    class VS_FIXEDFILEINFO(ctypes.Structure):
        _fields_ = [
            ("dwSignature", wintypes.DWORD),
            ("dwStrucVersion", wintypes.DWORD),
            ("dwFileVersionMS", wintypes.DWORD),
            ("dwFileVersionLS", wintypes.DWORD),
        ]

    info = ctypes.cast(ptr, ctypes.POINTER(VS_FIXEDFILEINFO)).contents
    return int(info.dwFileVersionMS >> 16)


def driver_major(path: Path) -> int | None:
    """Số bản chính ``chromedriver --version``. None nếu không chạy được."""
    kw: dict = {
        "args": [str(path), "--version"],
        "capture_output": True,
        "text": True,
        "timeout": 8,
    }
    if _CREATE_NO_WINDOW:
        kw["creationflags"] = _CREATE_NO_WINDOW
    try:
        r = subprocess.run(**kw)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return _major_of((r.stdout or "") + (r.stderr or ""))


def find_chromedriver() -> Path | None:
    """Đường dẫn chromedriver đã có sẵn trên máy, hoặc None.

    Bỏ file lệch số bản Chrome (Chrome 143 + driver 140 → Outlook/ATC hỏng).
    """
    want = chrome_major()
    for path in _iter_candidates():
        if not _looks_like_driver(path):
            continue
        if want is not None:
            got = driver_major(path)
            if got is not None and got != want:
                log.warning("bỏ chromedriver %s (bản %s, Chrome %s)", path, got, want)
                continue
        return path
    return None


def remember(path: str | Path) -> None:
    """Giữ bản khớp Chrome trong hồ sơ tool — phòng khi Manager bị chặn."""
    src = Path(path)
    if not _looks_like_driver(src):
        return
    want = chrome_major()
    got = driver_major(src)
    if want is not None and got is not None and got != want:
        log.warning("không giữ chromedriver lệch bản %s (Chrome %s)", got, want)
        return
    dest = tool_driver_path()
    try:
        if src.resolve() == dest.resolve():
            return
    except OSError:
        return
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        log.info("đã giữ chromedriver tại %s", dest)
    except OSError as exc:
        log.debug("không copy được chromedriver: %s", exc)


def remember_from_driver(driver: object) -> None:
    svc = getattr(driver, "service", None)
    path = getattr(svc, "path", None) or getattr(svc, "_path", None)
    if isinstance(path, (str, Path)):
        remember(path)


def is_missing_driver(exc: BaseException) -> bool:
    name = type(exc).__name__
    if name == "NoSuchDriverException":
        return True
    text = str(exc).casefold()
    return "unable to obtain driver" in text or "chromedriver" in text and "not found" in text


def is_stale_driver(exc: BaseException) -> bool:
    """Chrome đã lên bản mới, chromedriver cache còn bản cũ."""
    text = str(exc).casefold()
    return (
        "only supports chrome version" in text
        or "this version of chromedriver" in text
        or ("session not created" in text and "chrome version" in text)
    )


def explain_driver_error(exc: BaseException) -> str:
    head = str(exc).split("Stacktrace:", 1)[0].strip()
    if is_stale_driver(exc):
        return _STALE + "\n\n" + head
    if is_missing_driver(exc):
        return _MSG
    return head


def is_start_crash(exc: BaseException) -> bool:
    """Chrome vừa mở đã chết (DevToolsActivePort file doesn't exist ...)."""
    text = str(exc).casefold()
    return "devtoolsactiveport" in text or "chrome failed to start" in text


def _profile_dir_of(options) -> Path | None:
    try:
        for arg in getattr(options, "arguments", []) or []:
            if isinstance(arg, str) and arg.startswith("--user-data-dir="):
                return Path(arg.split("=", 1)[1])
    except Exception:
        pass
    return None


def _cleanup_chrome_profile(profile: Path | None) -> None:
    """Dọn Chrome treo + file khóa hồ sơ trước khi mở lại (máy công ty hay kẹt)."""
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/F", "/IM", "chrome.exe", "/T"],
                capture_output=True, timeout=15, creationflags=_CREATE_NO_WINDOW,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass
    if profile is None:
        return
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie", "DevToolsActivePort"):
        try:
            (profile / name).unlink(missing_ok=True)
        except OSError:
            pass


def attach_chrome(webdriver, options):
    """Mở Chrome: Selenium Manager tự khớp bản; local chỉ khi Manager thất bại."""
    try:
        log.info("mở Chrome bằng Selenium Manager (không ghim chromedriver)")
        driver = webdriver.Chrome(options=options)
    except Exception as exc:
        if is_start_crash(exc):
            log.warning("Chrome crash khi khởi động — dọn hồ sơ rồi thử lại: %s", exc)
            _cleanup_chrome_profile(_profile_dir_of(options))
            try:
                driver = webdriver.Chrome(options=options)
                remember_from_driver(driver)
                return driver
            except Exception as exc2:
                raise ChromeDriverError(explain_driver_error(exc2)) from exc2
        if not (is_missing_driver(exc) or is_stale_driver(exc)):
            raise
        path = find_chromedriver()
        if path is None:
            raise ChromeDriverError(explain_driver_error(exc)) from exc
        log.warning(
            "Selenium Manager lỗi, thử chromedriver local khớp bản: %s (%s)",
            path, exc,
        )
        try:
            from selenium.webdriver.chrome.service import Service
            driver = webdriver.Chrome(
                options=options,
                service=Service(executable_path=str(path)),
            )
        except Exception as exc2:
            raise ChromeDriverError(explain_driver_error(exc2)) from exc2

    remember_from_driver(driver)
    return driver
