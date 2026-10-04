"""Gửi FPL lên AviWeb (VNAIC) bằng Selenium — nhưng KHÔNG chiếm chuột/bàn phím.

Vẫn dùng Selenium như ``aviweb_atc.py`` (site Vaadin, không có API tiện dụng),
chỉ sửa những chỗ giành quyền điều khiển máy:

======================  ===================================================
Bản cũ                  Bản này
======================  ===================================================
``maximize_window()``   ``--window-size=1920,1080`` + headless — không có
                        cửa sổ nào nhảy lên trước
``pyperclip.copy()`` +  ``ActionChains.send_keys()`` — gửi ký tự qua giao
``pynput`` Ctrl+V       thức WebDriver **vào trong trang**, không qua bàn
                        phím hệ điều hành
``pyautogui``           bỏ hẳn (thực ra bản cũ import 3 lần mà không dùng)
======================  ===================================================

Nhờ vậy chạy nền được: bạn cứ gõ Word, Excel, Chrome bình thường trong lúc nó
làm việc. Không có cửa sổ Chrome nào hiện ra, không có phím nào bị gửi ra ngoài.

Đặt ``headless=False`` nếu cần xem nó làm gì (khi đó cửa sổ vẫn không chiếm
focus vì đã bỏ maximize và không dùng pyautogui/pynput).
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import shutil
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import config
from chrome_drv import attach_chrome
from utils.logging_setup import get_logger, setup

log = get_logger("atcfpl")

ATC_DIR = config.DATA_DIR / "atc"

AVIWEB_URL = "https://aviweb.vnaic.vn/AviWeb/login#!aaa-login"
AVIWEB_FPL_URL = "https://aviweb.vnaic.vn/AviWeb/#lfplf"
# Tài khoản: env AVIWEB_* → credentials.json → mặc định OMC (xem config).
# Giữ alias để import cũ không vỡ; luôn đọc lại lúc đăng nhập.

ORIGIN_ADDR = "VVTSVJCX"        # ô địa chỉ thứ nhất
EXTRA_ADDR = "KHOUXAAF"         # ô địa chỉ thứ hai (bản cũ dán bằng Ctrl+V)

# Chỉ cho phép 1 phiên chạy cùng lúc — mở nhiều Chrome song song vào cùng tài
# khoản dễ làm site đá session.
_RUN_LOCK = threading.Lock()

# Hồ sơ Chrome riêng cho Submit FPL: giữ cache widgetset Vaadin (incognito thì
# mỗi lần phải tải lại từ CDN — AviWeb chậm là văng "Failed to load the
# widgetset"). Cookie vẫn xoá trước mỗi lượt, xem ``_drop_stale_session``.
_PROFILE_SUBMIT = "aviweb-submit-stable"

_RE_FPL_NAME = re.compile(r"\(FPL-([A-Z0-9]+)-")
# Mọi điện văn ATC đều mở đầu "(FPL-", "(CHG-", "(CNL-"… — dùng để loại text rác.
_RE_BLOCK = re.compile(r"^\(\s*[A-Z]{3}-")
# Dòng sân bay trong FPL: "-WSSS0315" (đi) và "-VVDN0225 VVCR VVPB" (đến + dự bị)
_RE_AERO = re.compile(r"^-([A-Z]{4})(\d{4})(?=\s|$)", re.M)

XP = {
    "user": '//*[@id="application"]/div/div[2]/div/div/div/div[1]/div[2]/div/div/form/div[1]/div/div/input',
    "pass": '/html/body/div[1]/div/div/div[2]/div/div/div/div[1]/div[2]/div/div/form/div[2]/div/div/input',
    "login": '//*[@id="application"]/div/div[2]/div/div/div/div[1]/div[2]/div/div/form/div[5]/div/div[1]/div',
    "fpl_filing": '//span[normalize-space()="FPL Filing"]/parent::a',
    "fpl_menu": '//*[@id="main_navigation"]/div/ul/li[3]/ul/li/a',
    "load_btn": '/html/body/div[1]/div/div/div[2]/div/div/div[2]/div/div/div/div/div/div/div/div/div[2]/div/div/div[2]/div/div/div',
    "textarea": '//*[@id="application-overlays"]/div[3]/div/div/div[3]/div/div/div/div/div[2]/div/div/div/textarea',
    "submit": '//*[@id="application-overlays"]/div[3]/div/div/div[3]/div/div/div/div/div[3]/div/div[2]/div/span/span',
    "target": '/html/body/div[1]/div/div/div[2]/div/div/div[2]/div/div/div/div/div/div/div/div/div[4]/div/div/div/div/div/div[3]/div',
    "error": '/html/body/div[2]/div[2]/div',
    "confirm": '//*[@id="fpl_delete"]/div[3]/div/div[2]/div',
    "address": '//*[@class="v-textfield v-widget tokenComponentInputComponent '
               'v-textfield-tokenComponentInputComponent toolkit-uppercase '
               'v-textfield-toolkit-uppercase"]',
}


class AtcError(RuntimeError):
    """Không mở được trình duyệt hoặc không đăng nhập được."""


@dataclass(slots=True)
class FplItem:
    """Kết quả của một block FPL."""
    index: int
    name: str
    route: str = ""
    ok: bool = False
    attempted: bool = False
    reason: str = ""

    @property
    def label(self) -> str:
        return f"{self.name} {self.route}".strip()


@dataclass(slots=True)
class FplResult:
    total: int = 0
    ok: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    items: list[FplItem] = field(default_factory=list)


# --------------------------------------------------------------------------- #

def read_fpl_blocks(path: Path | str) -> list[str]:
    """Tách file ATC thành các block, phân cách bằng dòng trống.

    Chỉ trả về block đúng dạng điện văn ATC — mở đầu bằng ``(XXX-`` với XXX là
    loại điện văn (FPL, CHG, CNL, DLA…). Text thường bị bỏ, vì đây là hệ thống
    ATC thật: thà không gửi còn hơn gửi rác.
    """
    text = Path(path).read_text(encoding="utf-8-sig")
    blocks, cur = [], []
    for line in text.splitlines():
        if not line.strip():
            if cur:
                blocks.append("\n".join(cur).strip())
                cur = []
        else:
            cur.append(line.rstrip())
    if cur:
        blocks.append("\n".join(cur).strip())

    good = [b for b in blocks if _RE_BLOCK.match(b)]
    if len(good) < len([b for b in blocks if b]):
        log.debug("bỏ %d block không đúng dạng điện văn ATC",
                  len([b for b in blocks if b]) - len(good))
    return good


def fpl_name(block: str) -> str:
    m = _RE_FPL_NAME.search(block)
    return m.group(1) if m else "?"


def fpl_route(block: str) -> str:
    """Chặng + giờ khởi hành đọc từ block, ví dụ ``WSSS→VVDN 0315``.

    Cùng một số hiệu có thể có 2 chặng trong một file, nên cần chặng để phân biệt
    chuyến nào thành công chuyến nào lỗi.
    """
    pts = _RE_AERO.findall(block)
    if not pts:
        return ""
    dep, std = pts[0]
    arr = pts[-1][0] if len(pts) > 1 else "?"
    return f"{dep}→{arr} {std}"


def list_atc_files() -> list[dict[str, Any]]:
    """Các file ATC có sẵn: trong data/atc/ và file atc.txt mặc định."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for p in list(ATC_DIR.glob("*.txt")) + [
        Path(r"C:\PHAN THANH HY\PYTHON\atc.txt"),
        Path(r"C:\PHAN THANH HY\PYTHON\ATC.txt"),
    ]:
        if not p.is_file() or str(p).lower() in seen:
            continue
        seen.add(str(p).lower())
        try:
            n = len(read_fpl_blocks(p))
        except Exception:
            n = -1
        out.append({"path": str(p), "name": p.name, "blocks": n,
                    "size": p.stat().st_size, "modified": p.stat().st_mtime})
    return sorted(out, key=lambda x: -x["modified"])


# --------------------------------------------------------------------------- #

def _make_driver(
    headless: bool = True,
    *,
    profile_name: str | None = None,
):
    """Chrome cấu hình để KHÔNG chiếm focus.

    Selenium Manager tự khớp chromedriver với Chrome (không ghim số bản).
    Xem ``chrome_drv``.
    """
    try:
        from selenium import webdriver
    except ImportError as exc:
        raise AtcError("Chưa cài selenium. Chạy: py -m pip install selenium") from exc

    opt = webdriver.ChromeOptions()
    if headless:
        opt.add_argument("--headless=new")
    opt.add_argument("--window-size=1920,1080")
    opt.add_argument("--disable-gpu")
    opt.add_argument("--no-first-run")
    opt.add_argument("--no-default-browser-check")
    opt.add_argument("--disable-notifications")
    opt.add_argument("--disable-save-password-bubble")
    # Hồ sơ ATC hay bị đánh dấu crash (tắt tool/Task Manager). Chrome hiện
    # "Restore pages?" đè lên ô FPL — Selenium gõ nhầm, hộp Add FPL để trống.
    opt.add_argument("--hide-crash-restore-bubble")
    opt.add_argument("--disable-session-crashed-bubble")
    if profile_name:
        # Hồ sơ để ở đĩa cục bộ, không theo data/: chạy tool từ ổ mạng mà đặt hồ
        # sơ Chrome trên đó thì mỗi thao tác là một lượt SMB.
        profile_dir = (config.BROWSER_PROFILE_DIR / "chrome" / profile_name).resolve()
        profile_dir.mkdir(parents=True, exist_ok=True)
        opt.add_argument(f"--user-data-dir={profile_dir}")
        opt.add_argument("--profile-directory=Default")
    else:
        # Giữ nguyên hành vi cũ cho Submit FPL; Check ATC truyền profile riêng.
        opt.add_argument("--incognito")
    opt.add_experimental_option("prefs", {
        "credentials_enable_service": False,
        "profile.password_manager_enabled": False,
        "profile.password_manager_leak_detection": False,
    })
    for arg in config.lean_browser_args((
            "PasswordManagerOnboarding", "AutofillServerCommunication",
            "PasswordLeakDetection", "TranslateUI")):
        opt.add_argument(arg)
    opt.add_experimental_option("excludeSwitches",
                                ["enable-automation", "enable-password-manager"])
    opt.add_experimental_option("useAutomationExtension", False)
    # Vaadin đôi khi bật confirm "Failed to load the widgetset … try again?"
    # ở bất kỳ thời điểm nào. ChromeDriver tự chọn OK thay vì phá toàn bộ job bằng
    # UnexpectedAlertPresentException. AviWeb sẽ tự thử tải widgetset lại.
    opt.set_capability("unhandledPromptBehavior", "accept")

    return attach_chrome(webdriver, opt)


def _drop_stale_session(profile_name: str = _PROFILE_SUBMIT) -> None:
    """Xoá cookie AviWeb trước khi mở Chrome, giữ lại cache widgetset.

    AviWeb giữ phiên sống thêm 5-10 phút sau khi Chrome đã đóng. Mở lại trang
    login mà còn ``JSESSIONID`` cũ thì nó trả về trang không có ô nhập.
    Chỉ xoá cookie/storage — cache widgetset Vaadin giữ lại để lần sau đỡ chậm.
    """
    prof = config.BROWSER_PROFILE_DIR / "chrome" / profile_name / "Default"
    for rel in ("Network/Cookies", "Network/Cookies-journal"):
        try:
            (prof / rel).unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:
            log.debug("không xoá được %s: %s", rel, exc)
    for rel in ("Local Storage", "Session Storage"):
        shutil.rmtree(prof / rel, ignore_errors=True)
    _clear_chrome_crash(profile_name)


def _clear_chrome_crash(profile_name: str) -> None:
    """Gỡ cờ 'Chrome didn't shut down correctly' trên hồ sơ ATC.

    Tắt tool / End task để Preferences.exit_type = Crashed. Lần mở sau Chrome
    hỏi Restore pages — infobar lấy focus, ô Add FPL trống, Submit gửi rỗng.
    """
    prefs = (config.BROWSER_PROFILE_DIR / "chrome" / profile_name
             / "Default" / "Preferences")
    try:
        data = json.loads(prefs.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    prof = data.setdefault("profile", {})
    if str(prof.get("exit_type") or "").lower() not in ("crashed", "session_ended"):
        return
    prof["exit_type"] = "Normal"
    try:
        prefs.write_text(json.dumps(data), encoding="utf-8")
    except OSError as exc:
        log.debug("không gỡ crash Chrome %s: %s", prefs, exc)


def _accept_widgetset_alert(driver) -> bool:
    """Bấm OK trên confirm Vaadin 'Failed to load the widgetset' nếu đang mở.

    ChromeDriver vẫn ném ``UnexpectedAlertPresentException`` dù đã đặt
    ``unhandledPromptBehavior=accept``. Hộp thoại phải được xử lý rồi chờ
    AviWeb tự tải widgetset lại — CDN có thể mất vài phút.
    """
    try:
        alert = driver.switch_to.alert
        text = (alert.text or "").lower()
    except Exception:
        return False
    if "widgetset" not in text and "failed to load" not in text:
        return False
    try:
        alert.accept()
    except Exception:
        pass
    return True


def _wait_login_form(driver, *, say: Callable[[str], None],
                     cancel: threading.Event | None = None,
                     tries: int = 6, each: float = 30.0):
    """Chờ ô đăng nhập; nếu AviWeb hỏi widgetset thì Try again và chờ tiếp."""
    from selenium.common.exceptions import TimeoutException, UnexpectedAlertPresentException
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait

    last = None
    for n in range(1, tries + 1):
        if cancel is not None and cancel.is_set():
            raise AtcError("đã dừng khi đang chờ AviWeb tải trang đăng nhập")
        try:
            return WebDriverWait(driver, each).until(
                EC.presence_of_element_located((By.XPATH, XP["user"])))
        except UnexpectedAlertPresentException as exc:
            last = exc
            if _accept_widgetset_alert(driver):
                say(f"· AviWeb lỗi widgetset (lần {n}/{tries}) — "
                    "chọn Try again và chờ tải lại…")
            else:
                say(f"· AviWeb bật hộp thoại khi tải trang (lần {n}/{tries}) "
                    "— đóng rồi chờ tiếp…")
                try:
                    driver.switch_to.alert.accept()
                except Exception:
                    pass
            time.sleep(12)
        except TimeoutException as exc:
            last = exc
            say(f"· AviWeb chưa hiện form đăng nhập (lần {n}/{tries}) — "
                "tải lại trang, widgetset có thể đang biên dịch…")
            try:
                if _accept_widgetset_alert(driver):
                    time.sleep(12)
                    continue
                driver.get(AVIWEB_URL)
            except UnexpectedAlertPresentException:
                _accept_widgetset_alert(driver)
                time.sleep(12)
    raise AtcError(
        "AviWeb không tải được trang đăng nhập (thường do widgetset/CDN chậm). "
        "Đợi mạng ổn rồi chạy lại, hoặc mở https://aviweb.vnaic.vn trên Chrome "
        "thường xem trang đã vào được chưa."
    ) from last


def _wait_main_nav(driver, *, say: Callable[[str], None],
                   cancel: threading.Event | None = None,
                   timeout: float = 180.0):
    """Chờ menu chính sau login — không cắt sớm khi AviWeb chậm."""
    from selenium.common.exceptions import UnexpectedAlertPresentException
    from selenium.webdriver.common.by import By

    started = time.monotonic()
    last_notice = 0.0
    while True:
        if cancel is not None and cancel.is_set():
            raise AtcError("đã dừng khi đang chờ AviWeb đăng nhập")
        try:
            if _accept_widgetset_alert(driver):
                say("· AviWeb lỗi widgetset sau login — chọn Try again và chờ…")
                time.sleep(12)
                continue
            nav = driver.find_elements(By.ID, "main_navigation")
            if any(el.is_displayed() for el in nav):
                return nav[0]
        except UnexpectedAlertPresentException:
            if _accept_widgetset_alert(driver):
                say("· AviWeb lỗi widgetset sau login — chọn Try again và chờ…")
            time.sleep(12)
            continue
        except Exception:
            pass
        now = time.monotonic()
        if now - started >= timeout:
            return None
        if now - last_notice >= 15:
            say("· AviWeb chưa vào màn hình chính — tiếp tục chờ…")
            last_notice = now
        time.sleep(0.5)


def _page_url(driver) -> str:
    try:
        return driver.current_url or ""
    except Exception:
        return ""


def _vaadin_view(url: str) -> str:
    """Tên view Vaadin sau ``#`` / ``#!`` (``lfplf``, ``fplf``, …)."""
    u = (url or "").lower()
    if "#" not in u:
        return ""
    h = u.split("#", 1)[1]
    if h.startswith("!"):
        h = h[1:]
    return h.split("&", 1)[0].split("?", 1)[0].split("/", 1)[0]


def _page_looks_like_fpl(url: str) -> bool:
    """Trang FPL Filing HTTPS: list ``lfplf`` hoặc dialog Add FPL ``fplf``.

    AviWeb đổi hash thành ``#!fplf`` khi mở Text Mode — vẫn là đúng trang.
    """
    u = (url or "").lower()
    if "aaa-login" in u:
        return False
    if u.startswith("http://"):
        return False
    return _vaadin_view(u) in ("lfplf", "fplf")


def _href_is_page_link(href: str) -> bool:
    """Link nhảy trang AviWeb (logo, Dashboard, http://…) — không phải nút Submit.

    Hash nội bộ ``#lfplf`` là menu FPL Filing, được bấm cố ý. Mọi ``http(s)://``
    không chứa ``lfplf`` thì là bẫy: native click trượt vào đó là đứng phiên.
    """
    h = (href or "").strip()
    if not h or h.startswith("javascript:"):
        return False
    low = h.lower()
    if low.startswith("http://"):
        return True
    if _page_looks_like_fpl(low) or low.startswith("#"):
        return False
    return low.startswith("https://") or low.startswith("/")


def _href_of(el) -> str:
    try:
        href = el.get_attribute("href") or ""
        if href:
            return href
    except Exception:
        pass
    try:
        from selenium.webdriver.common.by import By
        return el.find_element(By.XPATH, "./ancestor::a[1]").get_attribute("href") or ""
    except Exception:
        return ""


def _js_mouse_click(driver, el) -> None:
    """Click trong trang — không dùng toạ độ chuột (trượt là dính logo/HTTP)."""
    driver.execute_script(
        """
        const e = arguments[0];
        e.scrollIntoView({block:'center', inline:'nearest'});
        const r = e.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        try { e.focus(); } catch (err) {}
        const opts = {bubbles:true, cancelable:true, view:window, buttons:1};
        for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) {
          e.dispatchEvent(new MouseEvent(t, opts));
        }
        if (typeof e.click === 'function') e.click();
        """,
        el,
    )


def _click(driver, el) -> None:
    """Click bằng JS — không đi qua chuột máy (tránh user click chen)."""
    href = _href_of(el)
    try:
        _js_mouse_click(driver, el)
        return
    except Exception:
        if _href_is_page_link(href):
            log.debug("bỏ native click trên link %s", href)
            raise
        try:
            el.click()
        except Exception:
            log.debug("click thất bại", exc_info=True)
            raise


def _climb_button(el):
    """Lên tới ``v-button`` / ``<button>`` — đừng bấm span nhỏ bên trong."""
    from selenium.webdriver.common.by import By

    cur = el
    for _ in range(6):
        try:
            cls = cur.get_attribute("class") or ""
            tag = (cur.tag_name or "").lower()
        except Exception:
            return el
        if "v-button" in cls or tag in ("button", "input"):
            return cur
        try:
            cur = cur.find_element(By.XPATH, "..")
        except Exception:
            break
    return el


def _visible_window_control(driver, label: str):
    """Nút Close/Submit đang hiện trên dialog — không dùng xpath overlay cứng."""
    from selenium.common.exceptions import NoSuchElementException
    from selenium.webdriver.common.by import By

    lit = "'" + str(label).replace("'", r"', \"'\", '") + "'"
    xps = (
        f"//div[contains(@class,'v-window')]//*[normalize-space()={lit}]",
        f"//*[@id='application-overlays']//*[normalize-space()={lit}]",
    )
    found = []
    for xp in xps:
        try:
            found.extend(driver.find_elements(By.XPATH, xp))
        except Exception:
            continue
    for el in reversed(found):
        try:
            if not el.is_displayed():
                continue
        except Exception:
            continue
        btn = _climb_button(el)
        if _href_is_page_link(_href_of(btn)):
            continue
        return btn
    raise NoSuchElementException(f"không thấy nút {label} trên dialog AviWeb")


def _click_window_button(driver, label: str) -> None:
    """Bấm Submit/Close theo chữ trên dialog đang mở — không bấm link trang."""
    _js_mouse_click(driver, _visible_window_control(driver, label))


def _keep_main_tab(driver) -> int:
    """Đóng tab mới mở vì bấm nhầm ``<a href>``. Trả số tab đã đóng."""
    try:
        handles = list(driver.window_handles)
    except Exception:
        return 0
    if len(handles) <= 1:
        return 0
    main = handles[0]
    closed = 0
    for h in handles[1:]:
        try:
            driver.switch_to.window(h)
            driver.close()
            closed += 1
        except Exception:
            pass
    try:
        driver.switch_to.window(main)
    except Exception:
        try:
            driver.switch_to.window(driver.window_handles[0])
        except Exception:
            pass
    return closed


def _stop_nav(driver) -> None:
    try:
        driver.execute_script("window.stop();")
    except Exception:
        pass


def _open_fpl_menu(driver, *, say: Callable[[str], None] | None = None,
                   timeout: float = 8.0) -> bool:
    """Bấm FPL Filing trên menu trái. True nếu thấy menu."""
    from selenium.common.exceptions import TimeoutException
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait

    del say
    menu_xps = (
        XP["fpl_filing"],
        '//a[contains(normalize-space(.),"FPL Filing")]',
        '//span[normalize-space()="FPL Filing"]',
        '//*[@id="main_navigation"]//*[contains(normalize-space(.),"FPL Filing")]',
    )
    filing = None
    for xp in menu_xps:
        try:
            filing = WebDriverWait(driver, timeout).until(
                EC.presence_of_element_located((By.XPATH, xp)))
            if filing.is_displayed():
                break
            filing = None
        except TimeoutException:
            continue
    if filing is None:
        return False
    _click(driver, filing)
    try:
        _click(driver, WebDriverWait(driver, 8).until(
            EC.presence_of_element_located((By.XPATH, XP["fpl_menu"]))))
    except Exception:
        pass
    return True


def _reenter_fpl_filing(driver, *, say: Callable[[str], None],
                        cancel: threading.Event | None = None) -> bool:
    """Kéo về FPL Filing sau khi bấm trượt sang link AviWeb.

    False = không về được — caller phải dừng các chuyến sau, không gửi tiếp
    trên trang sai (HTTP/Dashboard/login) kẻo lỗi dây chuyền.
    """
    if cancel is not None and cancel.is_set():
        return False
    n = _keep_main_tab(driver)
    _stop_nav(driver)
    if n:
        say(f"· đã đóng {n} tab AviWeb mở nhầm")
    try:
        _close_fpl_dialogs(driver)
    except Exception:
        pass
    if _page_looks_like_fpl(_page_url(driver)):
        try:
            _wait_fpl_ready(driver, 10)
            return True
        except Exception:
            pass
    say("· lệch trang AviWeb — quay lại FPL Filing")
    try:
        driver.set_page_load_timeout(35)
    except Exception:
        pass
    try:
        if _open_fpl_menu(driver, say=say, timeout=6):
            _wait_fpl_ready(driver, 18)
            return True
    except Exception:
        pass
    try:
        driver.get(AVIWEB_FPL_URL)
        if _page_looks_like_fpl(_page_url(driver)):
            _wait_fpl_ready(driver, 20)
            return True
    except Exception:
        pass
    return False


def _visible_fpl_textarea(driver):
    """Ô trong cửa sổ Add FPL đang hiện — không lấy textarea trên trang list."""
    from selenium.common.exceptions import NoSuchElementException
    from selenium.webdriver.common.by import By

    wins = driver.find_elements(
        By.XPATH,
        "//div[contains(@class,'v-window')]"
        "[.//*[contains(normalize-space(),'Add FPL')]]",
    )
    for win in wins:
        try:
            if not win.is_displayed():
                continue
        except Exception:
            continue
        try:
            boxes = win.find_elements(By.XPATH, ".//textarea")
        except Exception:
            continue
        for el in boxes:
            try:
                if el.is_displayed() and el.is_enabled():
                    return el
            except Exception:
                continue
    raise NoSuchElementException("không thấy ô Add FPL đang hiện")


def _type(el, text: str) -> None:
    """Gõ vào element — không dùng ActionChains (không đụng bàn phím OS)."""
    from selenium.webdriver.common.keys import Keys

    try:
        el.clear()
    except Exception:
        pass
    el.send_keys(Keys.CONTROL, "a")
    el.send_keys(Keys.BACKSPACE)
    el.send_keys(text)


def _type_fpl_text(driver, el, text: str) -> None:
    """Nhét FPL vào textarea đang hiện; không phụ thuộc cửa sổ Chrome có focus.

    send_keys trên Chrome mất focus (máy nhà đang gõ chỗ khác) thường không vào
    ô. Ghi ``value`` qua prototype + sự kiện input/change để Vaadin nhận.
    """
    try:
        _js_mouse_click(driver, el)
    except Exception:
        try:
            el.click()
        except Exception:
            pass
    filled = driver.execute_script(
        """
        const e = arguments[0], v = arguments[1];
        try { e.focus(); } catch (err) {}
        const desc = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value');
        if (desc && desc.set) desc.set.call(e, v);
        else e.value = v;
        e.dispatchEvent(new Event('input', {bubbles:true}));
        e.dispatchEvent(new Event('change', {bubbles:true}));
        return e.value || '';
        """,
        el, text,
    )
    if str(filled or "") != text:
        from selenium.webdriver.common.keys import Keys
        try:
            el.send_keys(Keys.CONTROL + "a")
            el.send_keys(Keys.BACKSPACE)
            el.send_keys(text)
        except Exception:
            pass
    driver.execute_script(
        """
        const e = arguments[0];
        e.dispatchEvent(new Event('blur', {bubbles:true}));
        """,
        el,
    )


def _close_fpl_dialogs(driver) -> None:
    """Đóng đúng một cửa sổ Add FPL đang hiện — không bấm hết mọi chữ Close."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys

    closed = False
    try:
        for win in driver.find_elements(
            By.XPATH,
            "//div[contains(@class,'v-window')]"
            "[.//*[contains(normalize-space(),'Add FPL')]]",
        ):
            try:
                if not win.is_displayed():
                    continue
            except Exception:
                continue
            for el in win.find_elements(
                By.XPATH,
                ".//*[self::span or self::div][normalize-space()='Close']"
                " | .//*[contains(@class,'v-window-closebox')]",
            ):
                try:
                    if not el.is_displayed():
                        continue
                    _js_mouse_click(driver, el)
                    closed = True
                    time.sleep(0.4)
                    break
                except Exception:
                    continue
            if closed:
                break
    except Exception:
        pass
    if not closed:
        try:
            driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
        except Exception:
            pass


def _wait_fpl_ready(driver, timeout: float = 40.0):
    """Chờ màn FPL trở lại trạng thái có thể mở block kế tiếp."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait

    return WebDriverWait(driver, timeout).until(
        EC.element_to_be_clickable((By.XPATH, XP["load_btn"])))


_WHY = {
    "TimeoutException": "trang không phản hồi kịp (chờ quá lâu không thấy phần tử)",
    "ElementClickInterceptedException": "có gì đó che mất nút, không click được",
    "ElementNotInteractableException": "phần tử chưa bấm được (bị ẩn hoặc khoá)",
    "StaleElementReferenceException": "trang vừa render lại giữa lúc thao tác",
    "NoSuchElementException": "không tìm thấy phần tử trên trang",
    "UnexpectedAlertPresentException":
        "AviWeb bật hộp thoại (thường lỗi widgetset khi trang chậm)",
    "WebDriverException": "Chrome/chromedriver gặp sự cố",
    "InvalidSessionIdException": "Chrome đã bị đóng giữa chừng",
    "NoSuchDriverException": "thiếu chromedriver (máy công ty hay chặn tải)",
    "ChromeDriverError": "thiếu chromedriver (máy công ty hay chặn tải)",
}


def _why(exc: Exception) -> str:
    """Đổi tên exception của Selenium thành câu người đọc hiểu được."""
    kind = type(exc).__name__
    txt = _WHY.get(kind)
    if txt:
        return txt
    msg = " ".join(str(exc).split())[:160]
    return f"{kind}: {msg}" if msg else kind


def _report(res: "FplResult", say: Callable[..., None]) -> None:
    """In rõ chuyến nào thành công, chuyến nào lỗi và lỗi vì sao."""
    good = [x for x in res.items if x.ok]
    bad = [x for x in res.items if x.attempted and not x.ok]
    todo = [x for x in res.items if not x.attempted]

    say("─" * 52)
    say(f"■ KẾT QUẢ: {len(good)}/{len(res.items)} gửi được · "
        f"{len(bad)} lỗi" + (f" · {len(todo)} chưa gửi" if todo else ""))

    if good:
        say(f"✓ THÀNH CÔNG ({len(good)}):")
        for x in good:
            say(f"     {x.index:>3}. {x.label}")
    if bad:
        say(f"✗ LỖI ({len(bad)}) — phải gửi lại:")
        for x in bad:
            say(f"     {x.index:>3}. {x.label}")
            say(f"          ↳ {x.reason or 'không rõ nguyên nhân'}")
    if todo:
        say(f"○ CHƯA GỬI ({len(todo)}) — dừng giữa chừng:")
        for x in todo:
            say(f"     {x.index:>3}. {x.label}")
    if good and not bad and not todo:
        say("  → không có chuyến nào lỗi.")
    say("─" * 52)


def submit_fpl(
    path: Path | str,
    *,
    headless: bool = True,
    on_progress: Callable[[str, str], None] | None = None,
    cancel: threading.Event | None = None,
    limit: int | None = None,
    only_labels: list[str] | None = None,
) -> FplResult:
    """Gửi toàn bộ FPL trong file lên AviWeb.

    ``on_progress(text, flight)`` được gọi sau mỗi block.
    ``cancel`` để dừng giữa chừng.
    """
    from selenium.common.exceptions import TimeoutException, UnexpectedAlertPresentException
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait

    blocks = read_fpl_blocks(path)
    res = FplResult(total=len(blocks))
    if not blocks:
        raise AtcError(f"{Path(path).name}: không tìm thấy block FPL nào")

    def say(msg: str, flight: str = "") -> None:
        log.info("%s", msg)
        if on_progress:
            on_progress(msg, flight)

    if not _RUN_LOCK.acquire(blocking=False):
        raise AtcError("đang có một phiên gửi FPL khác chạy — chờ nó xong đã")

    if not headless:
        say("· Hiện Chrome để quan sát — tránh click/gõ vào cửa sổ đó.")

    driver = None
    try:
        say(f"▶ mở Chrome {'ẩn (headless)' if headless else 'hiện'} — "
            f"click JS, không chiếm chuột máy")
        # Hồ sơ cố định + xoá cookie cũ: giữ cache widgetset, tránh trang login cụt.
        _drop_stale_session(_PROFILE_SUBMIT)
        driver = _make_driver(headless, profile_name=_PROFILE_SUBMIT)
        try:
            driver.set_page_load_timeout(180)
        except Exception:
            pass
        # JobCancel của web.py gọi callback này ngay khi người dùng bấm Dừng,
        # phá mọi WebDriverWait/request đang treo thay vì chờ hết timeout.
        if cancel is not None and hasattr(cancel, "add_abort"):
            cancel.add_abort(driver.quit)
        wait = WebDriverWait(driver, 40)

        aviweb_user, aviweb_pass = config.get_aviweb_credentials()
        say(f"· mở AviWeb — trang chậm sẽ tự thử lại widgetset")
        try:
            driver.get(AVIWEB_URL)
        except UnexpectedAlertPresentException:
            _accept_widgetset_alert(driver)
            time.sleep(8)
        user_el = _wait_login_form(driver, say=say, cancel=cancel)
        _type(user_el, aviweb_user)
        pass_el = driver.find_element(By.XPATH, XP["pass"])
        _type(pass_el, aviweb_pass)

        # Login form Vaadin cần thao tác WebDriver thật để phát đủ
        # key/change/blur/click events. JS click đôi khi gửi giá trị cũ/rỗng,
        # dù trên màn hình vẫn nhìn thấy đúng user/password.
        pass_el.send_keys(Keys.TAB)
        time.sleep(0.3)
        login_el = driver.find_element(By.XPATH, XP["login"])
        try:
            login_el.click()
        except UnexpectedAlertPresentException:
            _accept_widgetset_alert(driver)
            time.sleep(8)
            login_el = driver.find_element(By.XPATH, XP["login"])
            login_el.click()
        except Exception:
            pass_el.send_keys(Keys.ENTER)
        say(f"· đăng nhập AviWeb ({aviweb_user})")

        # Chờ login thật sự hoàn tất. Không refresh trang login: refresh sẽ xoá
        # thông báo authentication và gửi form lại trong trạng thái không rõ.
        _wait_main_nav(driver, say=say, cancel=cancel, timeout=180)
        if not _open_fpl_menu(driver, say=say, timeout=8):
            hint = ""
            try:
                body = " ".join(
                    (driver.find_element(By.TAG_NAME, "body").text or "").split())
                hint = body[:300]
            except Exception:
                pass
            raise AtcError(
                "đăng nhập AviWeb không thành công / không thấy menu FPL Filing. "
                f"User: {aviweb_user}. "
                + (f"Trang hiện: {hint}" if hint else
                   "Kiểm tra mật khẩu, tài khoản bị khoá hoặc AviWeb đang chậm."))
        say(f"· vào trang FPL · {len(blocks)} block cần gửi")
        try:
            driver.set_page_load_timeout(40)
        except Exception:
            pass

        todo = blocks[:limit] if limit else blocks
        if only_labels:
            wanted = {str(x).strip().upper() for x in only_labels if str(x).strip()}
            todo = [b for b in todo
                    if f"{fpl_name(b)} {fpl_route(b)}".strip().upper() in wanted]
            if not todo:
                raise AtcError("không tìm thấy block FPL lỗi trong file gốc")
        # Lập danh sách trước, để nếu dừng giữa chừng vẫn biết chuyến nào chưa gửi
        res.items = [FplItem(index=i, name=fpl_name(b), route=fpl_route(b))
                     for i, b in enumerate(todo, 1)]

        for it, block in zip(res.items, todo):
            if cancel is not None and cancel.is_set():
                say("— đã huỷ —")
                break
            i, name = it.index, it.name
            it.attempted = True
            say(f"→ [{i}/{len(todo)}] {it.label}", name)
            try:
                ntab = _keep_main_tab(driver)
                if ntab:
                    say(f"· đóng {ntab} tab AviWeb mở nhầm trước khi gửi {it.label}")
                if not _page_looks_like_fpl(_page_url(driver)):
                    if not _reenter_fpl_filing(driver, say=say, cancel=cancel):
                        it.reason = "lệch trang AviWeb — không về được FPL Filing"
                        res.failed.append(name)
                        res.errors.append(f"{it.label}: {it.reason}")
                        say(f"✗ {it.label} — {it.reason}", name)
                        say("· dừng các chuyến sau (tránh lỗi dây chuyền trên trang sai)")
                        break
                # Popup/error của block trước phải đóng hẳn trước khi mở block mới.
                _close_fpl_dialogs(driver)
                load = _wait_fpl_ready(driver, 40)
                time.sleep(0.4)
                _click(driver, load)

                ta = wait.until(lambda d: _visible_fpl_textarea(d))
                _type_fpl_text(driver, ta, block)
                got = ta.get_attribute("value") or ""
                need = max(10, len(block) - 5)
                if len(got) < need:
                    ta = _visible_fpl_textarea(driver)
                    _type_fpl_text(driver, ta, block)
                    got = ta.get_attribute("value") or ""
                if len(got) < need:
                    raise AtcError("không dán được FPL vào ô Add FPL")
                time.sleep(0.7)
                try:
                    _click_window_button(driver, "Submit")
                except Exception:
                    _click(driver, driver.find_element(By.XPATH, XP["submit"]))
                ntab = _keep_main_tab(driver)
                url = _page_url(driver)
                if ntab or (url and not _page_looks_like_fpl(url)):
                    _stop_nav(driver)
                    raise AtcError(
                        "bấm trượt sang link AviWeb"
                        + (f" (đã đóng {ntab} tab)" if ntab else "")
                    )

                time.sleep(1)
                target = wait.until(EC.presence_of_element_located(
                    (By.XPATH, XP["target"])))
                time.sleep(2)
                _click(driver, driver.find_element(By.XPATH, XP["target"]))

                # Có thông báo lỗi -> đọc NỘI DUNG lỗi rồi bỏ block này
                try:
                    err = WebDriverWait(driver, 2).until(
                        EC.presence_of_element_located((By.XPATH, XP["error"])))
                    why = " ".join((err.text or "").split())[:300]
                    _click(driver, err)
                    it.reason = why or "AviWeb báo lỗi (không đọc được nội dung)"
                    res.failed.append(name)
                    res.errors.append(f"{it.label}: {it.reason}")
                    say(f"✗ {it.label} — {it.reason}", name)
                    _close_fpl_dialogs(driver)
                    try:
                        _wait_fpl_ready(driver, 12)
                    except TimeoutException:
                        pass
                    continue
                except TimeoutException:
                    pass

                try:
                    _click(driver, WebDriverWait(driver, 3).until(
                        EC.presence_of_element_located((By.XPATH, XP["confirm"]))))
                except TimeoutException:
                    pass

                time.sleep(1)
                addr = wait.until(EC.presence_of_element_located(
                    (By.XPATH, XP["address"])))
                _type(addr, ORIGIN_ADDR)
                addr.send_keys(Keys.TAB)
                time.sleep(1)

                # Gõ thêm địa chỉ vào ô đang focus — send_keys, không ActionChains
                try:
                    active = driver.switch_to.active_element
                    active.send_keys(EXTRA_ADDR)
                except Exception:
                    addr.send_keys(EXTRA_ADDR)
                time.sleep(1)

                try:
                    _click_window_button(driver, "Submit")
                except Exception:
                    _click(driver, driver.find_element(By.XPATH, XP["submit"]))
                _close_fpl_dialogs(driver)
                _wait_fpl_ready(driver, 20)

                it.ok = True
                res.ok.append(name)
                say(f"✓ {it.label} — đã gửi  ({i}/{len(todo)})", name)

            except Exception as exc:
                if cancel is not None and cancel.is_set():
                    say("— đã huỷ hoàn toàn —")
                    break
                it.reason = _why(exc)
                res.failed.append(name)
                res.errors.append(f"{it.label}: {it.reason}")
                say(f"✗ {it.label} — {it.reason}", name)
                # Phục hồi FPL Filing; lệch HTTP/Dashboard thì kéo về, không được
                # thì dừng hẳn — không để chuyến sau lỗi dây chuyền.
                try:
                    if not _reenter_fpl_filing(driver, say=say, cancel=cancel):
                        say("· không về được FPL Filing — dừng các chuyến sau")
                        break
                except Exception:
                    say("· không về được FPL Filing — dừng các chuyến sau")
                    break

        _report(res, say)
        return res

    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass
        _RUN_LOCK.release()


# --------------------------------------------------------------------------- #

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="atcfpl.py",
        description="Gửi FPL lên AviWeb bằng Selenium, không chiếm chuột/bàn phím.",
    )
    ap.add_argument("file", nargs="?", help="file ATC .txt")
    ap.add_argument("--list", action="store_true", help="liệt kê file ATC có sẵn")
    ap.add_argument("--show", action="store_true", help="chỉ in các block, không gửi")
    ap.add_argument("--limit", type=int, help="chỉ gửi N block đầu (để thử)")
    ap.add_argument("--no-headless", action="store_true",
                    help="hiện cửa sổ Chrome để xem (vẫn không chiếm focus)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    setup(logging.DEBUG if args.verbose else logging.INFO)
    config.ensure_dirs()
    ATC_DIR.mkdir(parents=True, exist_ok=True)

    if args.list:
        for f in list_atc_files():
            print(f"  {f['blocks']:>4} block  {f['size']/1024:>7.1f} KB  {f['path']}")
        return 0

    if not args.file:
        ap.error("cần đường dẫn file, hoặc dùng --list")

    if args.show:
        for i, b in enumerate(read_fpl_blocks(args.file), 1):
            print(f"\n--- block {i}: {fpl_name(b)}  {fpl_route(b)} ---")
            print(b)
        return 0

    try:
        res = submit_fpl(args.file, headless=not args.no_headless, limit=args.limit)
    except AtcError as exc:
        log.error("%s", exc)
        return 1

    # submit_fpl() đã in bảng kết quả qua log; ở đây in lại gọn để chuyển tiếp
    print()
    for x in res.items:
        mark = "✅" if x.ok else ("❌" if x.attempted else "⏸")
        print(f"{mark} {x.index:>3}. {x.label:<28}"
              f"{'' if x.ok else '  ' + (x.reason or 'chưa gửi')}")
    return 0 if not res.failed else 2


if __name__ == "__main__":
    sys.exit(main())
