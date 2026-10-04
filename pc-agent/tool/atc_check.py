"""Check trạng thái FPL trên AviWeb — Selenium headless, không chiếm chuột.

Mở AviWeb → FPL Manager → Process, tìm từng số hiệu, đọc status + nội dung
FPL (REG, DOF, flight time) rồi trả kết quả về qua callback ``on_progress``.

Toàn bộ click/gõ dùng JS + ``element.send_keys`` — **không** dùng ActionChains
(chuột ảo), nên click chuột thật trên máy không làm hỏng phiên check.
"""

from __future__ import annotations

import re
import shutil
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import config
from utils.logging_setup import get_logger

log = get_logger("atc_check")

# Cùng tài khoản với gửi FPL (credentials.json / env / mặc định OMC).
from atcfpl import AVIWEB_URL  # noqa: E402

_RUN_LOCK = threading.Lock()

XP = {
    "user": '//*[@id="application"]/div/div[2]/div/div/div/div[1]/div[2]/div/div/form/div[1]/div/div/input',
    "pass": '/html/body/div[1]/div/div/div[2]/div/div/div/div[1]/div[2]/div/div/form/div[2]/div/div/input',
    "login": '//*[@id="application"]/div/div[2]/div/div/div/div[1]/div[2]/div/div/form/div[5]/div/div[1]/div',
    "fpl_manager": '//*[@id="main_navigation"]/div/ul/li[2]/a',
    "process": '//*[@id="main_navigation"]/div/ul/li[2]/ul/li[1]/a',
    "search": '/html/body/div[1]/div/div/div[2]/div/div/div[2]/div/div/div/div/div/div/div/div/div/div/div/div[2]/div/div/div/div[2]/div/div[1]/div/div/div/div[1]/input',
    "modal_pre": "//div[@class='modal-body']//pre",
    "close_modal": "//*[@id='application-overlays']/div[3]/div/div/div[3]/div/div/div/div/div/div[3]/div/div[2]/div",
}


@dataclass(slots=True)
class AtcCheckResult:
    callsign: str
    status: str = ""
    flight_time: str = ""
    reg: str = ""
    dof: str = ""
    error: str = ""
    ok: bool = False


@dataclass(slots=True)
class AtcCheckSummary:
    total: int = 0
    ok: int = 0
    failed: int = 0
    results: list[AtcCheckResult] = field(default_factory=list)


def missing_detail_reason(result: AtcCheckResult, modal_text: str = "") -> str:
    """Vì sao chuyến này CHƯA check được. Rỗng = đã đọc đủ để kết luận.

    Thước đo là có đọc được chi tiết FPL hay không, chứ không phải có thấy chuyến
    trong danh sách hay có mở được cửa sổ View. Chỉ biết ``status`` thì cả REG CHECK
    (cần REG) lẫn STD CHECK (cần EOBT) đều không kết luận được gì, nên tính nó là
    "check được" là tự nói dối.

    Gặp thật ngày 14/08: VJC424 trả về ``status=Closed``, REG/EOBT/DOF trống trơn,
    mà dòng tổng kết vẫn ghi "1/1 check được · 0 lỗi".
    """
    if result.reg or result.dof or result.flight_time:
        return ""
    if modal_text:
        return "mở được FPL nhưng trong đó không có REG/DOF/EOBT"
    return "bấm View nhưng không đọc được nội dung FPL"


_RE_FPL_CS = re.compile(r"\((?:FPL|CHG|CNL|DLA)-([A-Z0-9]+)-", re.I)


def fpl_callsign(text: str) -> str:
    """Số hiệu trong điện văn FPL, ví dụ ``(FPL-VJC150-IS`` → ``VJC150``."""
    m = _RE_FPL_CS.search(text or "")
    return m.group(1).upper() if m else ""


def fpl_is_for(text: str, callsign: str) -> bool:
    """True khi nội dung View đúng là FPL của chuyến đang check — không phải chuyến trước."""
    want = (callsign or "").strip().upper()
    if not want or not (text or "").strip():
        return False
    got = fpl_callsign(text)
    if got:
        return got == want
    return re.search(rf"(?<![A-Z0-9]){re.escape(want)}(?![A-Z0-9])",
                     (text or "")[:600].upper()) is not None


def _visible_fpl_nodes(driver) -> list:
    """Chỉ ``<pre>`` đang hiện — overlay cũ ẩn trong DOM không được tính."""
    from selenium.webdriver.common.by import By

    seen: list = []
    xps = (
        XP["modal_pre"],
        "//div[contains(@class,'modal-body')]//pre",
        "//div[contains(@class,'v-window') and not(contains(@style,'display: none'))]//pre",
    )
    for xp in xps:
        try:
            for el in driver.find_elements(By.XPATH, xp):
                try:
                    if el.is_displayed() and (el.text or "").strip():
                        if el not in seen:
                            seen.append(el)
                except Exception:
                    continue
        except Exception:
            continue
    return seen


def _close_view(driver, timeout: float = 3.0) -> None:
    """Đóng cửa View còn sót. Không đóng thì chuyến sau đọc nhầm FPL chuyến trước."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys

    for xp in (
        XP["close_modal"],
        "//div[contains(@class,'v-window-closebox')]",
        "//*[contains(@class,'v-window')]//*[normalize-space()='Close' or normalize-space()='Đóng']",
    ):
        try:
            for el in driver.find_elements(By.XPATH, xp):
                try:
                    if el.is_displayed():
                        _js_click(driver, el)
                except Exception:
                    continue
        except Exception:
            continue
    try:
        driver.execute_script(
            "document.querySelectorAll('.v-window-closebox,.v-window .v-button')"
            ".forEach(e=>{if(e.offsetParent) e.click();})")
    except Exception:
        pass
    try:
        driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
    except Exception:
        pass
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if not _visible_fpl_nodes(driver):
            return
        time.sleep(0.15)


def _read_fpl_for(driver, callsign: str, timeout: float = 8.0) -> tuple[str, str]:
    """Đọc FPL đang hiện. Trả ``(text, error)``.

    ``error`` khác rỗng khi cửa sổ View đang mở FPL của chuyến khác
    (đúng ca VJC150 ăn REG/EOBT của VJC1831).
    """
    want = (callsign or "").strip().upper()
    deadline = time.monotonic() + timeout
    last = ""
    while time.monotonic() < deadline:
        for el in _visible_fpl_nodes(driver):
            text = (el.text or "").strip()
            if not text:
                continue
            last = text
            if fpl_is_for(text, want):
                return text, ""
        time.sleep(0.2)
    if last:
        got = fpl_callsign(last) or "?"
        return "", f"FPL đang mở là {got}, không phải {want}"
    return "", ""


_PROFILE_NAME = "aviweb-check-stable"


def _drop_stale_session(profile_name: str = _PROFILE_NAME) -> None:
    """Xoá cookie AviWeb trước khi mở Chrome, giữ lại cache widgetset.

    AviWeb giữ phiên sống thêm 5-10 phút sau khi Chrome đã đóng. Mở lại trang
    login mà còn ``JSESSIONID`` cũ thì nó trả về trang KHÔNG có ô nhập nào —
    body chỉ còn "AviWeb | Login | Privacy Policy…" thay vì "AviWeb |
    Email/Username | Password | Login…" — nên tool chờ hết giờ rồi báo
    TimeoutException. Đo được: chạy lượt thứ hai ngay sau một lượt thành công là
    chết, tới khi phiên cũ hết hạn mới chạy lại được.

    Xoá cookie lúc Chrome đang chạy không cứu được: trang cụt đã nằm trong cache
    nên tải lại vẫn ra nó và server không cấp cookie mới. Phải xoá lúc chưa mở
    trình duyệt. Chỉ xoá cookie/storage, giữ nguyên cache widgetset Vaadin để
    lần tải sau vẫn nhanh.
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


def _make_driver(headless: bool = True):
    from atcfpl import _make_driver as _orig
    # Profile cố định riêng cho Check ATC: giữ cache widgetset cho nhanh, không
    # ảnh hưởng Chrome cá nhân. Cookie thì phải bỏ — xem _drop_stale_session.
    _drop_stale_session()
    return _orig(headless, profile_name=_PROFILE_NAME)


def _js_click(driver, el) -> None:
    """Click không đi qua chuột máy (tránh bị user click chen)."""
    driver.execute_script(
        "arguments[0].scrollIntoView({block:'center', inline:'nearest'});"
        "arguments[0].click();",
        el,
    )


def _js_contextmenu(driver, el) -> None:
    """Mở menu chuột phải bằng sự kiện JS — không dùng ActionChains."""
    driver.execute_script(
        """
        const e = arguments[0];
        e.scrollIntoView({block:'center', inline:'nearest'});
        const r = e.getBoundingClientRect();
        const x = r.left + Math.min(20, r.width / 2);
        const y = r.top + Math.min(12, r.height / 2);
        for (const type of ['mousedown', 'mouseup', 'contextmenu']) {
          e.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window,
            button: 2, buttons: 2, clientX: x, clientY: y
          }));
        }
        """,
        el,
    )


def check_flights(
    callsigns: list[str],
    *,
    headless: bool = True,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
    cancel: threading.Event | None = None,
) -> AtcCheckSummary:
    """Check trạng thái FPL cho danh sách callsign trên AviWeb."""
    from selenium.common.exceptions import TimeoutException, UnexpectedAlertPresentException
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import WebDriverWait

    summary = AtcCheckSummary(total=len(callsigns))

    def say(msg: str, cls: str = "", **extra: Any) -> None:
        log.info("%s", msg)
        if on_progress:
            d: dict[str, Any] = {"type": "line", "text": msg}
            if cls:
                d["cls"] = cls
            d.update(extra)
            on_progress(d)

    if not callsigns:
        say("Không có chuyến nào để check.", "hint")
        return summary

    if not _RUN_LOCK.acquire(blocking=False):
        say("Đang có phiên AviWeb khác chạy — chờ xong rồi thử lại.", "fail")
        return summary

    # headless=False chỉ để xem — click vẫn bằng JS, nhưng đừng click vào cửa sổ Chrome
    if not headless:
        say("· Hiện Chrome để quan sát — tránh click/gõ vào cửa sổ đó.", "sys")

    driver = None
    try:
        say(
            f"Khởi tạo Chrome {'ẩn' if headless else 'hiện'} "
            f"(click JS, không chiếm chuột máy)…",
            "sys",
        )
        driver = _make_driver(headless)
        # Đóng Chrome ngay khi bấm Dừng, không chờ WebDriverWait timeout.
        if cancel is not None and hasattr(cancel, "add_abort"):
            cancel.add_abort(driver.quit)
        wait = WebDriverWait(driver, 30)

        def search_ready(timeout: float | None = None):
            """Chờ ô Search đến khi Process tải xong hoặc người dùng bấm Dừng."""
            started = time.monotonic()
            last_notice = 0.0
            lost_since: float | None = None
            recoveries = 0
            while True:
                if cancel and cancel.is_set():
                    raise RuntimeError("Đã dừng khi đang chờ trang Process.")
                now = time.monotonic()
                try:
                    body = (driver.find_element(By.TAG_NAME, "body").text or "").lower()
                    lost = ("server connection lost" in body
                            or "trying to reconnect" in body)
                except Exception:
                    lost = False

                if lost:
                    lost_since = lost_since or now
                    if now - lost_since >= 30:
                        recoveries += 1
                        say(
                            f"· AviWeb mất kết nối 30s — phục hồi trang "
                            f"lần {recoveries}…",
                            "sys",
                        )
                        driver.refresh()
                        time.sleep(8)
                        # Hash thường vẫn là manager=processed; click lại Process
                        # nếu menu đã dựng nhưng nội dung vẫn ở Dashboard.
                        try:
                            proc = WebDriverWait(driver, 10).until(
                                EC.presence_of_element_located((By.XPATH, XP["process"])))
                            _js_click(driver, proc)
                        except Exception:
                            pass
                        lost_since = None
                        last_notice = time.monotonic()
                        continue
                else:
                    lost_since = None
                    try:
                        el = driver.find_element(By.XPATH, XP["search"])
                        if el.is_displayed() and el.is_enabled():
                            return el
                    except Exception:
                        pass
                if timeout is not None and now - started >= timeout:
                    raise TimeoutException("ô Search chưa sẵn sàng")
                if now - last_notice >= 15:
                    say(
                        "· Trang Process chưa có ô Search"
                        + (" · AviWeb đang mất kết nối" if lost else "")
                        + " — tiếp tục chờ…",
                        "sys",
                    )
                    last_notice = now
                time.sleep(0.5)

        def type_callsign(box, text: str) -> None:
            _js_click(driver, box)
            time.sleep(0.15)
            try:
                box.clear()
            except Exception:
                pass
            box.send_keys(Keys.CONTROL, "a")
            box.send_keys(Keys.BACKSPACE)
            time.sleep(0.1)
            box.send_keys(text)

        def fill_input(el, text: str) -> None:
            _js_click(driver, el)
            time.sleep(0.1)
            try:
                el.clear()
            except Exception:
                pass
            el.send_keys(Keys.CONTROL, "a")
            el.send_keys(Keys.BACKSPACE)
            el.send_keys(text)
            # Vaadin đôi khi cần sự kiện input/change
            try:
                driver.execute_script(
                    """
                    const e = arguments[0], v = arguments[1];
                    e.value = v;
                    e.dispatchEvent(new Event('input', {bubbles:true}));
                    e.dispatchEvent(new Event('change', {bubbles:true}));
                    """,
                    el,
                    text,
                )
            except Exception:
                pass

        # --- Login (cùng user với Gửi FPL) ---
        aviweb_user, aviweb_pass = config.get_aviweb_credentials()
        say(f"Mở AviWeb ({aviweb_user})…", "sys")
        driver.get(AVIWEB_URL)

        # Profile riêng có thể vẫn còn session. Nếu đã thấy menu thì không đăng
        # nhập lại, tránh AviWeb đá session và không tải widgetset lại vô ích.
        session_ready = False
        try:
            WebDriverWait(driver, 12).until(
                EC.presence_of_element_located((By.ID, "main_navigation")))
            session_ready = True
            say("· dùng lại phiên AviWeb đã đăng nhập", "sys")
        except TimeoutException:
            pass

        # AviWeb/Vaadin đôi khi không tải được widgetset và mở confirm hỏi
        # "Would you like to try again?". Chấp nhận để trang tự tải lại.
        from atcfpl import _accept_widgetset_alert
        for widget_try in range(6):
            if session_ready:
                break
            try:
                user = WebDriverWait(driver, 30).until(
                    EC.presence_of_element_located((By.XPATH, XP["user"])))
                break
            except TimeoutException:
                # Trang login "cụt" — xem _drop_stale_session. Đã xoá cookie
                # trước khi mở nên hiếm khi tới đây; báo rõ để khỏi phải đoán
                # nghĩa của một TimeoutException trống trơn.
                if widget_try < 5:
                    say("· AviWeb chưa hiện form — tải lại, widgetset có thể "
                        "đang biên dịch…", "sys")
                    try:
                        driver.get(AVIWEB_URL)
                    except UnexpectedAlertPresentException:
                        _accept_widgetset_alert(driver)
                        time.sleep(12)
                    continue
                raise RuntimeError(
                    "AviWeb trả trang đăng nhập không có ô nhập. Thường do phiên "
                    "của lượt chạy trước chưa hết hạn, hoặc widgetset/CDN chậm "
                    "— chờ vài phút rồi thử lại."
                ) from None
            except UnexpectedAlertPresentException:
                if widget_try >= 5:
                    raise RuntimeError(
                        "AviWeb không tải được widgetset sau nhiều lần thử lại. "
                        "Đây là lỗi tài nguyên/CDN của AviWeb; hãy đợi rồi chạy lại."
                    )
                say("· AviWeb lỗi widgetset — chọn Try again và chờ tải lại…", "sys")
                if not _accept_widgetset_alert(driver):
                    try:
                        driver.switch_to.alert.accept()
                    except Exception:
                        pass
                time.sleep(12)
        else:
            raise RuntimeError("AviWeb không hiện form đăng nhập.")
        if not session_ready:
            fill_input(user, aviweb_user)
            fill_input(driver.find_element(By.XPATH, XP["pass"]), aviweb_pass)
            time.sleep(0.3)
            _js_click(driver, driver.find_element(By.XPATH, XP["login"]))

        # Không timeout cứng khi AviWeb đăng nhập/load chậm. Cứ chờ đến khi menu
        # xuất hiện; người dùng vẫn có thể bấm Dừng để driver.quit() ngay.
        last_login_notice = 0.0
        while True:
            if cancel and cancel.is_set():
                say("⏹ Đã dừng khi đang chờ AviWeb đăng nhập.", "sys")
                return summary
            try:
                if _accept_widgetset_alert(driver):
                    say("· AviWeb lỗi widgetset sau login — chọn Try again và chờ…",
                        "sys")
                    time.sleep(12)
                    continue
                nav = driver.find_elements(By.ID, "main_navigation")
                if any(el.is_displayed() for el in nav):
                    say("Đăng nhập OK.", "sys")
                    break
            except UnexpectedAlertPresentException:
                if _accept_widgetset_alert(driver):
                    say("· AviWeb lỗi widgetset sau login — chọn Try again và chờ…",
                        "sys")
                time.sleep(12)
                continue
            except Exception:
                pass
            now = time.monotonic()
            if now - last_login_notice >= 15:
                say("· AviWeb chưa vào màn hình chính — tiếp tục chờ…", "sys")
                last_login_notice = now
            time.sleep(0.5)

        # --- FPL Manager → Process (giống script gốc: refresh tới khi menu sẵn) ---
        def _menu_open(el) -> None:
            """Vaadin menubar: hover rồi click (JS click đơn thuần hay không bung submenu)."""
            try:
                driver.execute_script(
                    """
                    const el = arguments[0];
                    el.scrollIntoView({block:'center', inline:'nearest'});
                    const r = el.getBoundingClientRect();
                    const x = r.left + r.width/2, y = r.top + r.height/2;
                    for (const t of ['mouseover','mouseenter','mousemove']) {
                      el.dispatchEvent(new MouseEvent(t, {
                        bubbles:true, cancelable:true, view:window, clientX:x, clientY:y
                      }));
                    }
                    """,
                    el,
                )
                time.sleep(0.25)
            except Exception:
                pass
            try:
                el.click()
            except Exception:
                _js_click(driver, el)

        for attempt in range(10):
            if cancel and cancel.is_set():
                say("⏹ Đã dừng.", "sys")
                return summary
            try:
                mgr = WebDriverWait(driver, 2).until(
                    EC.element_to_be_clickable((By.XPATH, XP["fpl_manager"]))
                )
                _menu_open(mgr)
                break
            except Exception:
                try:
                    # fallback theo text
                    for xp in (
                        '//span[normalize-space()="FPL Manager"]/parent::a',
                        '//a[contains(.,"FPL Manager")]',
                    ):
                        try:
                            mgr = driver.find_element(By.XPATH, xp)
                            _menu_open(mgr)
                            break
                        except Exception:
                            continue
                    else:
                        driver.refresh()
                        time.sleep(0.8)
                        continue
                    break
                except Exception:
                    try:
                        driver.refresh()
                    except Exception:
                        pass
                    time.sleep(0.8)
        else:
            raise RuntimeError("Không mở được menu FPL Manager sau khi đăng nhập.")

        proc_xps = (
            XP["process"],  # li[2]/ul/li[1]/a — xpath gốc
            '//*[@id="main_navigation"]/div/ul/li[2]/ul//a[contains(.,"Process")]',
            '//span[normalize-space()="Process"]/parent::a',
            '//span[normalize-space()="Process"]',
            '//a[normalize-space()="Process"]',
            '//*[contains(@class,"v-menubar-popup")]//*[normalize-space()="Process"]',
            '//*[contains(@class,"v-menubar-menuitem") and contains(.,"Process")]',
        )
        proc_ok = False
        for attempt in range(6):
            if attempt > 0:
                # submenu chưa bung — mở lại FPL Manager
                try:
                    _menu_open(driver.find_element(By.XPATH, XP["fpl_manager"]))
                except Exception:
                    try:
                        _menu_open(driver.find_element(
                            By.XPATH,
                            '//span[normalize-space()="FPL Manager"]/parent::a',
                        ))
                    except Exception:
                        pass
                time.sleep(0.45)
            for xp in proc_xps:
                try:
                    # presence (không bắt buộc clickable) — submenu đôi khi visibility lạ
                    el = WebDriverWait(driver, 3).until(
                        EC.presence_of_element_located((By.XPATH, xp))
                    )
                    _menu_open(el)
                    proc_ok = True
                    break
                except Exception:
                    continue
            if proc_ok:
                break
        if not proc_ok:
            # Gợi ý debug: text menu đang thấy
            try:
                seen = driver.execute_script(
                    """
                    const roots = [
                      document.querySelector('#main_navigation'),
                      ...document.querySelectorAll('.v-menubar-popup')
                    ].filter(Boolean);
                    const out = [];
                    for (const r of roots) {
                      for (const n of r.querySelectorAll('a,span,.v-menubar-menuitem')) {
                        const t = (n.innerText||'').trim().replace(/\\s+/g,' ');
                        if (t && t.length < 40 && !out.includes(t)) out.push(t);
                      }
                    }
                    return out.slice(0, 25).join(' | ');
                    """
                ) or ""
            except Exception:
                seen = ""
            raise RuntimeError(
                "Không mở được mục Process trong FPL Manager."
                + (f" Menu thấy: {seen}" if seen else "")
            )

        say("Đã vào FPL Manager → Process — đang chờ trang load…", "sys")

        search_ready()
        try:
            WebDriverWait(driver, 30).until(
                EC.presence_of_element_located(
                    (By.CSS_SELECTOR, "table.v-table-table, .v-table-table")
                )
            )
        except TimeoutException:
            pass
        time.sleep(1.0)
        say("Trang Process sẵn sàng — bắt đầu check (bạn dùng máy bình thường được).",
            "sys")

        for i, cs in enumerate(callsigns):
            if cancel and cancel.is_set():
                say("⏹ Đã dừng.", "sys")
                break

            cs_upper = cs.strip().upper()
            if not cs_upper:
                continue

            cs_full = cs_upper if cs_upper.startswith("VJC") else f"VJC{cs_upper}"
            result = AtcCheckResult(callsign=cs_full)

            progress = (i + 1) / len(callsigns)
            say(f"[{i+1}/{len(callsigns)}] Tìm {cs_full}…", "",
                progress=progress, found=cs_full)

            try:
                # Overlay View chuyến trước còn trong DOM thì ``<pre>`` cũ vẫn
                # "presence" — chuyến này sẽ ăn REG/EOBT của chuyến vừa check.
                _close_view(driver)

                search_box = search_ready()

                type_callsign(search_box, cs_full)
                time.sleep(0.35)
                search_box.send_keys(Keys.ENTER)
                time.sleep(1.8)

                row_xpath = (
                    f"//table[@class='v-table-table']//tr["
                    f"translate(normalize-space(td[2]),"
                    f"'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ')"
                    f"='{cs_full}'][1]"
                )
                try:
                    flight_row = WebDriverWait(driver, 8).until(
                        EC.presence_of_element_located((By.XPATH, row_xpath)))
                except TimeoutException:
                    result.error = "Không tìm thấy trên AviWeb"
                    summary.failed += 1
                    summary.results.append(result)
                    say(f"  ✗ {cs_full}: không tìm thấy", "fail")
                    continue

                try:
                    status_el = flight_row.find_element(
                        By.XPATH, "./td[last()]//span")
                    result.status = status_el.text.strip()
                except Exception:
                    result.status = "?"

                # Chọn đúng dòng trước, rồi chuột phải + View. Không chọn thì
                # AviWeb đôi khi View chuyến đang highlight (chuyến trước).
                try:
                    _js_click(driver, flight_row)
                    time.sleep(0.2)
                except Exception:
                    pass
                ActionChains(driver).context_click(flight_row).perform()
                time.sleep(0.35)

                view_xps = (
                    "//tr[normalize-space(.//div)='View']",
                    "//div[normalize-space()='View']",
                    "//span[normalize-space()='View']",
                    "//*[contains(@class,'v-contextmenu')]//*[normalize-space()='View']",
                    "//tr[.//div[normalize-space()='View'] or .//span[normalize-space()='View']]",
                )
                view_btn = None
                for xp in view_xps:
                    try:
                        view_btn = WebDriverWait(driver, 4).until(
                            EC.presence_of_element_located((By.XPATH, xp)))
                        if view_btn.is_displayed():
                            break
                        view_btn = None
                    except TimeoutException:
                        view_btn = None
                if view_btn is None:
                    # thử lại context menu 1 lần bằng JS rồi ActionChains click View
                    _js_contextmenu(driver, flight_row)
                    time.sleep(0.4)
                    try:
                        view_btn = WebDriverWait(driver, 4).until(
                            EC.presence_of_element_located(
                                (By.XPATH, "//tr[normalize-space(.//div)='View']")))
                    except TimeoutException:
                        # KHÔNG tính là check được: chỉ thấy status trong danh sách
                        # thì chưa kiểm được gì — REG CHECK và STD CHECK đều cần
                        # REG/EOBT/DOF nằm trong FPL.
                        result.error = "có trên danh sách nhưng không mở được View"
                        summary.failed += 1
                        summary.results.append(result)
                        say(f"  ✗ {cs_full}: status={result.status}, không View được",
                            "fail")
                        continue

                try:
                    ActionChains(driver).move_to_element(view_btn).pause(0.1).click(
                        view_btn).perform()
                except Exception:
                    try:
                        view_btn.click()
                    except Exception:
                        _js_click(driver, view_btn)
                time.sleep(0.4)

                modal_text, mismatch = _read_fpl_for(driver, cs_full)
                if mismatch:
                    say(f"  · {cs_full}: {mismatch} — đóng rồi View lại", "sys")
                    _close_view(driver)
                    try:
                        _js_click(driver, flight_row)
                        time.sleep(0.2)
                    except Exception:
                        pass
                    ActionChains(driver).context_click(flight_row).perform()
                    time.sleep(0.35)
                    if view_btn is not None:
                        try:
                            _js_click(driver, view_btn)
                        except Exception:
                            pass
                    time.sleep(0.4)
                    modal_text, mismatch = _read_fpl_for(driver, cs_full)
                    if mismatch:
                        result.error = mismatch
                        summary.failed += 1
                        summary.results.append(result)
                        say(f"  ✗ {cs_full}: {mismatch}", "fail")
                        _close_view(driver)
                        continue

                if modal_text:
                    lines = modal_text.splitlines()
                    if len(lines) >= 3:
                        m_time = re.search(r"(\d+)$", lines[2])
                        if m_time:
                            result.flight_time = m_time.group(1)

                    m_reg = re.search(r"REG/([A-Z0-9-]+)", modal_text)
                    if m_reg:
                        result.reg = m_reg.group(1)

                    m_dof = re.search(r"DOF/([A-Z0-9]+)", modal_text)
                    if m_dof:
                        result.dof = m_dof.group(1)

                _close_view(driver)

                thieu = missing_detail_reason(result, modal_text)
                if thieu:
                    result.error = thieu
                    summary.failed += 1
                    summary.results.append(result)
                    say(f"  ✗ {cs_full}: status={result.status} — {result.error}",
                        "fail")
                    if modal_text:
                        # Cho xem thứ đọc được để còn biết AviWeb đổi cách hiển thị
                        # hay chuyến này thật sự thiếu dữ liệu.
                        say("      FPL đọc được: "
                            + " · ".join(modal_text.split("\n")[:2])[:90], "")
                    continue

                result.ok = True
                summary.ok += 1
                summary.results.append(result)

                parts = [f"status={result.status}"]
                if result.reg:
                    parts.append(f"REG={result.reg}")
                if result.dof:
                    parts.append(f"DOF={result.dof}")
                if result.flight_time:
                    parts.append(f"time={result.flight_time}")
                say(f"  ✓ {cs_full}: {', '.join(parts)}", "ok")

            except Exception as exc:
                if cancel and cancel.is_set():
                    say("⏹ Đã huỷ hoàn toàn.", "sys")
                    break
                result.error = str(exc)[:120]
                summary.failed += 1
                summary.results.append(result)
                say(f"  ✗ {cs_full}: {type(exc).__name__}", "fail")
                continue

    except Exception as exc:
        message = str(exc).split("Stacktrace:", 1)[0].strip()
        say(f"Lỗi AviWeb: {type(exc).__name__}: {message}", "fail")
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        _RUN_LOCK.release()

    say("─" * 48)
    say(f"■ {summary.ok}/{summary.total} check được · {summary.failed} lỗi",
        "ok" if not summary.failed else "fail")

    return summary
