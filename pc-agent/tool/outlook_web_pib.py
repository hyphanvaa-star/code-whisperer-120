"""Tải PIB qua phiên Outlook Web (không cần IT duyệt Graph app).

Cách hoạt động
--------------
1. Mở Chrome với profile riêng khi token cache thiếu hoặc bị từ chối.
2. Lấy access token Outlook từ localStorage/sessionStorage của trang OWA.
3. Probe mailbox rồi gọi Outlook REST tải ``PIB_NORMAL-*.pdf``.

Không đăng ký Azure app, không cần license Outlook desktop — chỉ cần
đăng nhập được **Outlook Web** trên trình duyệt tool mở ra.
"""

from __future__ import annotations

import base64
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

import requests

import config
from chrome_drv import attach_chrome
from utils.cache import atomic_replace
from utils.logging_setup import get_logger
from utils.parsing import safe_filename

log = get_logger("outlook_web_pib")

OWA_URL = "https://outlook.office.com/mail/"
OUTLOOK_REST = "https://outlook.office.com/api/v2.0"


def rest_root(mailbox: str = "") -> str:
    """Gốc REST: hộp đang login (``/me``) hoặc hộp chung ``users('omc@...')``."""
    box = (mailbox or "").strip()
    if box:
        return f"{OUTLOOK_REST}/users('{quote(box, safe='@.-_+')}')"
    return f"{OUTLOOK_REST}/me"
# Đĩa cục bộ, không nằm dưới data/ — xem config._browser_profile_root().
PROFILE_DIR = config.BROWSER_PROFILE_DIR / "chrome_owa_profile"
TOKEN_CACHE = config.CACHE_DIR / "owa_token.json"
FOLDER_CACHE = config.CACHE_DIR / "owa_pib_folder.json"
# Hộp thư soạn nháp ATC/EZFW — tách khỏi phiên PIB/GENDEC.
MAIL_PROFILE_DIR = config.BROWSER_PROFILE_DIR / "chrome_owa_mail_profile"
MAIL_TOKEN_CACHE = config.CACHE_DIR / "owa_mail_token.json"
_POOL = 8  # tải PDF song song
# Keep a short request buffer without discarding several usable minutes.
_TOKEN_SAFETY_S = 60
_SESSION_LOCK = threading.RLock()


_RE_PIB = re.compile(r"^PIB[_-].*\.pdf$", re.I)
_RE_CS = re.compile(r"PIB[_-][A-Z]+[_-]([A-Z]{2,3}\d+)", re.I)


class OwaError(RuntimeError):
    """Không lấy được phiên Outlook Web / token."""


class OwaAuthError(OwaError):
    """Token OWA thiếu, hết hạn hoặc bị mailbox từ chối."""

    def __init__(self, message: str, *, status: int | None = None, stage: str = ""):
        super().__init__(message)
        self.status = status
        self.stage = stage


class OwaCancelled(OwaError):
    """Người dùng đã dừng job OWA."""


def _status_code(response: requests.Response, stage: str) -> None:
    """Nâng lỗi auth riêng để caller có thể lấy phiên mới đúng một lần."""
    if response.status_code in (401, 403):
        raise OwaAuthError(
            f"Phiên Outlook Web bị từ chối tại {stage} (HTTP {response.status_code}).",
            status=response.status_code,
            stage=stage,
        )
    if response.status_code >= 400:
        body = (response.text or "").replace("\n", " ")[:200]
        raise OwaError(f"Outlook REST lỗi tại {stage} HTTP {response.status_code}: {body}")


def _load_cached_token(cache: Path | None = None) -> str:
    path = cache or TOKEN_CACHE
    if not path.is_file():
        return ""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return str(data.get("token") or "")
    except (OSError, json.JSONDecodeError, TypeError):
        return ""


def invalidate_session(token_cache: Path | None = None) -> None:
    """Bỏ token/folder cache sau lỗi auth; giữ Chrome profile để silent sign-in."""
    paths = [token_cache] if token_cache is not None else [TOKEN_CACHE, FOLDER_CACHE]
    for path in paths:
        if path is None:
            continue
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            log.warning("không xoá được cache %s: %s", path.name, exc)


def _save_token(token: str, cache: Path | None = None) -> None:
    config.ensure_dirs()
    _save_json_cache(cache or TOKEN_CACHE, {"token": token, "at": time.time()})


def _b64url_json(seg: str) -> dict[str, Any]:
    pad = "=" * (-len(seg) % 4)
    try:
        raw = base64.urlsafe_b64decode(seg + pad)
        value = json.loads(raw.decode("utf-8", errors="replace"))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def _jwt_claims(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    return _b64url_json(parts[1])


def _token_ok_for_mail(token: str) -> bool:
    """Token còn đủ hạn và dành cho Outlook/Exchange mailbox."""
    c = _jwt_claims(token)
    if not c:
        return False
    exp = c.get("exp")
    if not isinstance(exp, (int, float)) or exp < time.time() + _TOKEN_SAFETY_S:
        return False
    aud = str(c.get("aud") or "").lower()
    return any(
        resource in aud
        for resource in (
            "outlook.office.com",
            "outlook.office365.com",
            "00000002-0000-0ff1-ce00-000000000000",  # Exchange
        )
    )


def _extract_tokens_from_driver(driver) -> list[str]:
    """Quét localStorage + sessionStorage lấy JWT."""
    script = r"""
    const found = [];
    const push = (s) => {
      if (!s || typeof s !== 'string') return;
      const re = /eyJ[A-Za-z0-9_\-]+?\.[A-Za-z0-9_\-]+?\.[A-Za-z0-9_\-+=\/]*/g;
      let m;
      while ((m = re.exec(s)) !== null) found.push(m[0]);
      try {
        const j = JSON.parse(s);
        const walk = (o) => {
          if (!o) return;
          if (typeof o === 'string') { push(o); return; }
          if (typeof o !== 'object') return;
          for (const k of Object.keys(o)) {
            const lk = String(k).toLowerCase();
            if (lk.includes('access') || lk.includes('token') || lk === 'secret')
              push(typeof o[k] === 'string' ? o[k] : JSON.stringify(o[k]));
            else if (typeof o[k] === 'object') walk(o[k]);
          }
        };
        walk(j);
      } catch (e) {}
    };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        push(localStorage.key(i));
        push(localStorage.getItem(localStorage.key(i)));
      }
    } catch (e) {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        push(sessionStorage.key(i));
        push(sessionStorage.getItem(sessionStorage.key(i)));
      }
    } catch (e) {}
    return [...new Set(found)];
    """
    try:
        raw = driver.execute_script(script) or []
    except Exception as exc:
        log.debug("không đọc storage: %s", exc)
        return []
    out: list[str] = []
    for t in raw:
        if isinstance(t, str) and t.startswith("eyJ") and _token_ok_for_mail(t):
            out.append(t)
    # Luồng này gọi Outlook REST: ưu tiên đúng resource Outlook, không chọn Graph.
    def score(tok: str) -> int:
        c = _jwt_claims(tok)
        aud = str(c.get("aud") or "").lower()
        scp = str(c.get("scp") or "").lower()
        s = 0
        if "outlook" in aud or "00000002-0000-0ff1" in aud:
            s += 20
        if "mail.read" in scp or "owa.accessasuser.all" in scp:
            s += 5
        if "graph.microsoft.com" in aud or "00000003-0000" in aud:
            s -= 10
        exp = c.get("exp") or 0
        s += min(int(exp) % 1000, 99)
        return s

    out.sort(key=score, reverse=True)
    return out


def _make_driver(*, headless: bool = False, profile_dir: Path | None = None):
    try:
        from selenium import webdriver
    except ImportError as exc:
        raise OwaError("Chưa cài selenium. Chạy: py -m pip install selenium") from exc

    root = Path(profile_dir) if profile_dir is not None else PROFILE_DIR
    root.mkdir(parents=True, exist_ok=True)
    opt = webdriver.ChromeOptions()
    # Login/token checks need the DOM, not every image/script in the mailbox.
    opt.page_load_strategy = "eager"
    if headless:
        opt.add_argument("--headless=new")
    opt.add_argument(f"--user-data-dir={root}")
    opt.add_argument("--profile-directory=Default")
    opt.add_argument("--window-size=1400,900")
    opt.add_argument("--disable-gpu")
    opt.add_argument("--no-first-run")
    opt.add_argument("--no-default-browser-check")
    opt.add_argument("--disable-notifications")
    opt.add_argument("--disable-save-password-bubble")
    opt.add_argument("--hide-crash-restore-bubble")
    opt.add_argument("--disable-session-crashed-bubble")
    for arg in config.lean_browser_args():
        opt.add_argument(arg)
    opt.add_experimental_option(
        "excludeSwitches", ["enable-automation", "enable-password-manager"]
    )
    opt.add_experimental_option("useAutomationExtension", False)
    # Cho phép download PDF. Ổ D: không có thì ensure_d_folder xuống data/pibwx
    # — không gọi Path.resolve() trực tiếp (WinError 3: 'D:\\').
    out = str(config.safe_resolve(config.ensure_d_folder("pibwx")))
    opt.add_experimental_option("prefs", {
        "download.default_directory": out,
        "download.prompt_for_download": False,
        "plugins.always_open_pdf_externally": True,
        "credentials_enable_service": False,
        "profile.password_manager_enabled": False,
        "profile.password_manager_leak_detection": False,
        "profile.exit_type": "Normal",
        "profile.exited_cleanly": True,
    })
    return attach_chrome(webdriver, opt)


def _visible(el) -> bool:
    try:
        return bool(el and el.is_displayed())
    except Exception:
        return False


def _find_first(driver, css: str):
    from selenium.webdriver.common.by import By

    for el in driver.find_elements(By.CSS_SELECTOR, css):
        if _visible(el):
            return el
    return None


def _enable(driver, el) -> None:
    try:
        driver.execute_script(
            """
            const e = arguments[0];
            e.disabled = false;
            e.removeAttribute('disabled');
            e.setAttribute('aria-disabled', 'false');
            e.classList && e.classList.remove('disabled');
            """,
            el,
        )
    except Exception:
        pass


def _robust_click(driver, el) -> bool:
    """Click thường → JS click → ActionChains (MS login hay chặn click thường)."""
    if el is None:
        return False
    try:
        driver.execute_script(
            "arguments[0].scrollIntoView({block:'center', inline:'center'});", el
        )
    except Exception:
        pass
    _enable(driver, el)
    try:
        el.click()
        return True
    except Exception:
        pass
    try:
        driver.execute_script("arguments[0].click();", el)
        return True
    except Exception:
        pass
    try:
        from selenium.webdriver.common.action_chains import ActionChains

        ActionChains(driver).move_to_element(el).pause(0.15).click().perform()
        return True
    except Exception:
        pass
    return False


def _primary_buttons(driver) -> list:
    """Next / Sign in / Tiếp theo / Đăng nhập trên form Microsoft."""
    from selenium.webdriver.common.by import By

    found: list = []
    seen: set[int] = set()

    def add(el) -> None:
        try:
            i = id(el)
            if i in seen:
                return
            seen.add(i)
            if _visible(el):
                found.append(el)
        except Exception:
            pass

    for css in (
        "#idSIButton9",
        "input#idSIButton9",
        "input[type='submit']",
        "button[type='submit']",
        "button[data-testid='primaryButton']",
        "input[data-report-event='Signin_Submit']",
        "button[data-report-event='Signin_Submit']",
    ):
        try:
            for el in driver.find_elements(By.CSS_SELECTOR, css):
                add(el)
        except Exception:
            pass

    labels = (
        "sign in",
        "next",
        "đăng nhập",
        "tiếp theo",
        "yes",
        "có",
        "continue",
        "tiếp tục",
        "confirm",
        "xác nhận",
        "ok",
        "submit",
        "accept",
        "allow",
    )
    try:
        for el in driver.find_elements(By.CSS_SELECTOR, "input[type='submit'], button, [role='button']"):
            try:
                val = (
                    (el.get_attribute("value") or "")
                    + " "
                    + (el.text or "")
                    + " "
                    + (el.get_attribute("aria-label") or "")
                ).strip().lower()
            except Exception:
                continue
            if any(x == val or x in val for x in labels):
                add(el)
    except Exception:
        pass
    return found


def _button_label(el) -> str:
    try:
        return " ".join(
            part
            for part in (
                el.get_attribute("value") or "",
                el.text or "",
                el.get_attribute("aria-label") or "",
            )
            if part
        ).strip().casefold()
    except Exception:
        return ""


def _click_login_choice(driver, labels: tuple[str, ...]) -> bool:
    """Click đúng nút xác nhận theo allowlist; không click nút Cancel/No."""
    wanted = tuple(label.casefold() for label in labels)
    for el in _primary_buttons(driver):
        label = _button_label(el)
        if label and any(label == item or item in label for item in wanted):
            if _robust_click(driver, el):
                return True
    return False


_TRUST_MARKERS = (
    "do you trust",
    "trust this device",
    "trust this browser",
    "trust this app",
    "trust this organization",
    "bạn có tin tưởng",
    "tin cậy thiết bị",
    "tin cậy trình duyệt",
    "tin tưởng",
)
_KMSI_MARKERS = (
    "stay signed in",
    "keep me signed in",
    "duy trì đăng nhập",
    "giữ tôi đăng nhập",
    "kmsidescription",
    'id="kmsi',
)
_TRUST_CLICK = (
    "continue", "tiếp tục", "yes", "có", "confirm", "xác nhận",
    "accept", "allow", "next", "tiếp theo",
)


def _visible_login_text(driver) -> str:
    """Chữ người dùng thấy + HTML — không cắt 12k đầu (script Microsoft rất dài)."""
    bits: list[str] = []
    try:
        bits.append(str(driver.execute_script(
            """
            let t = ((document.body && document.body.innerText) || '');
            try {
              for (const f of document.querySelectorAll('iframe, frame')) {
                try {
                  const d = f.contentDocument;
                  if (d && d.body) t += '\\n' + (d.body.innerText || '');
                } catch (e) {}
              }
            } catch (e) {}
            return t.slice(0, 24000);
            """
        ) or ""))
    except Exception:
        pass
    try:
        bits.append(str(driver.page_source or ""))
    except Exception:
        pass
    return "\n".join(bits).lower()


def _iter_login_contexts(driver):
    """Default document rồi từng iframe/frame (form Microsoft hay nằm trong iframe)."""
    from selenium.webdriver.common.by import By

    try:
        driver.switch_to.default_content()
    except Exception:
        pass
    yield
    try:
        frames = list(driver.find_elements(By.CSS_SELECTOR, "iframe, frame"))
    except Exception:
        frames = []
    for fr in frames[:8]:
        try:
            tag = (getattr(fr, "tag_name", None) or "").lower()
        except Exception:
            continue
        if tag not in ("iframe", "frame"):
            continue
        try:
            driver.switch_to.frame(fr)
            yield
        except Exception:
            pass
        finally:
            try:
                driver.switch_to.default_content()
            except Exception:
                pass


def _click_trust_or_kmsi(driver) -> str:
    """Bấm Continue/Yes trên 'Do you trust …' hoặc Stay signed in. Rỗng = không thấy."""
    blob = _visible_login_text(driver)
    if any(m in blob for m in _TRUST_MARKERS):
        if _click_login_choice(driver, _TRUST_CLICK):
            return "trust"
        btn = _find_first(driver, "#idSIButton9, button[data-testid='primaryButton']")
        if btn is not None and _robust_click(driver, btn):
            return "trust"
    if any(m in blob for m in _KMSI_MARKERS) or _find_first(
        driver, "#KmsiDescription, #kmsiTitle"
    ) is not None:
        if _click_login_choice(
            driver, ("yes", "có", "continue", "tiếp tục", "ok")
        ):
            return "kmsi"
        btn = _find_first(driver, "#idSIButton9, button[data-testid='primaryButton']")
        if btn is not None and _robust_click(driver, btn):
            return "kmsi"
    return ""


def _submit_login(driver, field=None) -> bool:
    """Ưu tiên Enter trên ô đang điền — ổn định hơn click Sign in."""
    from selenium.webdriver.common.keys import Keys

    if field is not None:
        try:
            field.click()
        except Exception:
            pass
        try:
            field.send_keys(Keys.ENTER)
            return True
        except Exception:
            pass
        try:
            driver.execute_script(
                """
                const e = arguments[0];
                e.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
                e.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', code:'Enter', keyCode:13, bubbles:true}));
                if (e.form) e.form.requestSubmit ? e.form.requestSubmit() : e.form.submit();
                """,
                field,
            )
            return True
        except Exception:
            pass

    for el in _primary_buttons(driver):
        if _robust_click(driver, el):
            return True
    return False


def _set_input(driver, el, value: str) -> None:
    """Gõ chắc vào input (clear + send_keys + fallback JS)."""
    from selenium.webdriver.common.keys import Keys

    try:
        el.click()
    except Exception:
        pass
    try:
        el.clear()
    except Exception:
        pass
    try:
        el.send_keys(Keys.CONTROL, "a")
        el.send_keys(Keys.BACKSPACE)
    except Exception:
        pass
    try:
        el.send_keys(value)
    except Exception:
        try:
            driver.execute_script(
                """
                const e = arguments[0], v = arguments[1];
                e.focus();
                e.value = v;
                e.dispatchEvent(new Event('input', {bubbles:true}));
                e.dispatchEvent(new Event('change', {bubbles:true}));
                """,
                el,
                value,
            )
        except Exception:
            pass
    # chờ nút Sign in / Next enable
    time.sleep(0.1)


def _try_auto_login(
    driver,
    username: str,
    password: str,
    done: dict[str, Any],
    say: Callable[[str], None],
) -> None:
    """Điền form Microsoft và tự xử lý các xác nhận phiên an toàn."""
    from selenium.webdriver.common.by import By

    url = (driver.current_url or "").lower()
    try:
        driver.switch_to.default_content()
    except Exception:
        pass

    # Chọn tài khoản đã lưu trên picker
    if username and not done.get("pick") and any(
        host in url
        for host in (
            "login.microsoftonline.com",
            "login.microsoft.com",
            "login.live.com",
            "login.windows.net",
        )
    ):
        try:
            for el in driver.find_elements(
                By.CSS_SELECTOR,
                "[data-test-id], .tile-container, div[role='listitem'], .table",
            ):
                txt = (el.text or "").lower()
                if username.lower() in txt and _visible(el):
                    if _robust_click(driver, el):
                        done["pick"] = True
                        say("Đã chọn tài khoản Outlook…")
                        time.sleep(0.15)
                        return
        except Exception:
            pass

    # Email
    if username and not done.get("email"):
        email = _find_first(
            driver, 'input[name="loginfmt"], #i0116, input[type="email"]'
        )
        if email is not None:
            try:
                cur = (email.get_attribute("value") or "").strip()
                if username.lower() not in cur.lower():
                    _set_input(driver, email, username)
                    say(f"Đã điền email: {username}")
                if _submit_login(driver, email):
                    done["email"] = True
                    say("Đã bấm Next (email)…")
                    time.sleep(0.15)
                    return
                say("⚠ Chưa bấm được Next — thử lại…")
            except Exception as exc:
                log.debug("auto email: %s", exc)

    # Password
    if password and not done.get("password"):
        if time.monotonic() - float(done.get("password_submitted_at") or 0) < 2.0:
            return
        # Một số màn hình hiện "Use your password" trước
        try:
            # Avoid reading thousands of unrelated divs on each login tick.
            for a in driver.find_elements(By.CSS_SELECTOR, "#idA_PWD_SwitchToPassword, a, button"):
                t = (a.text or "").strip().lower()
                if t in (
                    "use your password",
                    "sử dụng mật khẩu",
                    "enter your password",
                    "password",
                ) and _visible(a):
                    _robust_click(driver, a)
                    time.sleep(0.15)
                    break
        except Exception:
            pass

        pw = _find_first(
            driver, 'input[name="passwd"], #i0118, input[type="password"]'
        )
        if pw is not None:
            try:
                cur = pw.get_attribute("value") or ""
                if not cur:
                    _set_input(driver, pw, password)
                    say("Đã điền mật khẩu…")
                # thử submit nhiều kiểu — không đánh dấu done nếu vẫn còn ô password
                if _submit_login(driver, pw):
                    # Keep a submit cooldown: a slow Microsoft response must not
                    # cause rapid duplicate password submissions.
                    done["password_submitted_at"] = time.monotonic()
                    time.sleep(0.25)
                    still = _find_first(
                        driver,
                        'input[name="passwd"], #i0118, input[type="password"]',
                    )
                    if still is None or not _visible(still):
                        done["password"] = True
                        say("Đã Sign in.")
                    else:
                        # còn ô password → click có thể chưa ăn, thử lần nữa sau
                        say("Đã gửi Sign in — chờ Microsoft phản hồi…")
                        done["password_tries"] = int(done.get("password_tries") or 0) + 1
                        if int(done["password_tries"]) >= 3:
                            done["password"] = True  # tránh spam vô hạn
                    return
                say("⚠ Chưa bấm được Sign in — thử lại…")
            except Exception as exc:
                log.debug("auto password: %s", exc)

    # Do you trust Vietjetair? / Stay signed in — form hay nằm trong iframe.
    if not done.get("trust") or not done.get("kmsi"):
        for _ in _iter_login_contexts(driver):
            kind = _click_trust_or_kmsi(driver)
            if kind == "trust" and not done.get("trust"):
                done["trust"] = True
                say("Đã tự bấm Continue cho Do you trust Vietjetair…")
                time.sleep(0.15)
                return
            if kind == "kmsi" and not done.get("kmsi"):
                done["kmsi"] = True
                say("Đã tự chọn Stay signed in…")
                time.sleep(0.15)
                return

    # Báo lỗi đăng nhập nếu có
    for eid in ("usernameError", "passwordError", "error", "passwordErrorLink"):
        try:
            err = driver.find_element(By.ID, eid)
            if _visible(err):
                txt = (err.text or "").strip()
                if txt and not done.get("err_shown"):
                    say(f"⚠ Microsoft: {txt[:120]}")
                    done["err_shown"] = True
        except Exception:
            pass


def ensure_session(
    *,
    timeout_s: float = 300.0,
    on_status: Callable[[str], None] | None = None,
    cancel: Any | None = None,
    creds: tuple[str, str] | None = None,
    profile_dir: Path | None = None,
    token_cache: Path | None = None,
) -> str:
    """Mở OWA bằng profile bền, lấy token mới rồi xác nhận được mailbox.

    Profile còn đăng nhập sẽ tự đi thẳng vào mail. Nếu Microsoft yêu cầu MFA thì
    Chrome vẫn hiện và hàm chờ người dùng xác nhận trong ``timeout_s``.
    """
    say = on_status or (lambda m: None)
    with _SESSION_LOCK:
        if cancel is not None and cancel.is_set():
            raise OwaCancelled("Đã huỷ làm mới phiên Outlook Web.")
        user, password = creds if creds is not None else config.get_owa_credentials()
        driver = _make_driver(headless=True, profile_dir=profile_dir)
        if cancel is not None and hasattr(cancel, "add_abort"):
            cancel.add_abort(driver.quit)
        done: dict[str, Any] = {}
        try:
            say("Đang mở Outlook Web để làm mới phiên…")
            if user:
                say(f"Auto-login Outlook: {user}")
            else:
                say("Chưa có tài khoản lưu — hãy đăng nhập trên Chrome.")
            driver.get(OWA_URL)
            deadline = time.time() + timeout_s
            token = ""
            rejected: set[str] = set()
            # Do not immediately reload OWA while it is still acquiring tokens.
            last_hint = time.time()
            last_auto = 0.0
            while time.time() < deadline:
                if cancel is not None and cancel.is_set():
                    raise OwaCancelled("Đã huỷ làm mới phiên Outlook Web.")
                url = (driver.current_url or "").lower()
                login_page = any(
                    host in url
                    for host in (
                        "login.microsoftonline.com",
                        "login.microsoft.com",
                        "login.live.com",
                        "login.windows.net",
                    )
                )
                if login_page:
                    if time.time() - last_auto > 0.25:
                        _try_auto_login(driver, user, password, done, say)
                        last_auto = time.time()
                    if time.time() - last_hint > 15:
                        say("Cần xác nhận MFA/đăng nhập trên cửa sổ Chrome…")
                        last_hint = time.time()
                else:
                    # Trang OWA bình thường không cần dò/click login. Chỉ xử lý
                    # khi nội dung thật sự có prompt xác nhận (KMSI/trust); tránh
                    # gọi find_elements vô ích và giúp driver mock tối giản.
                    page = _visible_login_text(driver)
                    has_prompt = any(
                        x in page for x in _TRUST_MARKERS + _KMSI_MARKERS
                    )
                    if has_prompt and time.time() - last_auto > 0.25:
                        _try_auto_login(driver, user, password, done, say)
                        last_auto = time.time()
                    tokens = _extract_tokens_from_driver(driver)
                    for candidate in tokens:
                        if candidate in rejected:
                            continue
                        try:
                            _probe_mailbox(candidate)
                        except OwaAuthError:
                            rejected.add(candidate)
                            continue
                        token = candidate
                        break
                    if token:
                        break
                    if "outlook.office.com" in url and time.time() - last_hint > 20:
                        say("Đã vào Outlook — đang lấy token phiên…")
                        try:
                            driver.get(OWA_URL)
                        except Exception:
                            pass
                        last_hint = time.time()
                if cancel is not None and hasattr(cancel, "wait"):
                    cancel.wait(0.2)
                else:
                    time.sleep(0.2)

            if not token:
                raise OwaAuthError(
                    "Không lấy được phiên Outlook Web trong thời gian chờ; "
                    "hãy xác nhận MFA/Authenticator rồi thử lại.",
                    stage="browser login",
                )
            _save_token(token, token_cache)
            say("Outlook Web sẵn sàng.")
            return token
        finally:
            try:
                driver.quit()
            except Exception:
                pass


def _probe_mailbox(token: str) -> None:
    """Probe nhỏ tới chính Outlook REST resource dùng để tải PIB."""
    response = _rest_session(token).get(
        f"{OUTLOOK_REST}/me/mailfolders?$top=1&$select=Id", timeout=30
    )
    _status_code(response, "kiểm tra mailbox")


def ensure_fresh_token(
    *,
    timeout_s: float = 420.0,
    on_status: Callable[[str], None] | None = None,
    cancel: Any | None = None,
    force: bool = False,
    creds: tuple[str, str] | None = None,
    profile_dir: Path | None = None,
    token_cache: Path | None = None,
) -> str:
    """Trả token đã probe; tự mở Chrome lấy mới nếu cache stale/bị từ chối."""
    say = on_status or (lambda m: None)
    with _SESSION_LOCK:
        if cancel is not None and cancel.is_set():
            raise OwaCancelled("Đã huỷ làm mới phiên Outlook Web.")
        if force:
            invalidate_session(token_cache)
        token = "" if force else _load_cached_token(token_cache)
        if token and _token_ok_for_mail(token):
            say("Đang kiểm tra phiên Outlook Web…")
            try:
                _probe_mailbox(token)
                say("Outlook Web sẵn sàng.")
                return token
            except OwaAuthError:
                say("Phiên Outlook Web đã hết hiệu lực — đang lấy phiên mới…")
                invalidate_session(token_cache)
        elif token:
            say("Token Outlook Web sắp hết hạn — đang lấy phiên mới…")
            invalidate_session(token_cache)
        else:
            say("Chưa có phiên Outlook Web hợp lệ — đang đăng nhập…")
        return ensure_session(
            timeout_s=timeout_s, on_status=say, cancel=cancel,
            creds=creds, profile_dir=profile_dir, token_cache=token_cache,
        )


def get_token(
    *,
    interactive: bool = True,
    on_status: Callable[[str], None] | None = None,
) -> str:
    """Tương thích caller cũ; luồng PIB mới dùng ``ensure_fresh_token``."""
    token = _load_cached_token()
    if token and _token_ok_for_mail(token):
        return token
    if not interactive:
        raise OwaAuthError(
            "Chưa có phiên Outlook Web hợp lệ.", stage="token cache"
        )
    return ensure_session(on_status=on_status)


def _callsign_of(name: str, subject: str = "") -> str:
    m = _RE_CS.search(name)
    if m:
        return m.group(1).upper()
    m2 = re.search(r"\b([A-Z]{2,3}\d{1,5})\b", (subject or "").upper())
    return m2.group(1) if m2 else ""


def _wanted_left(callsigns: set[str] | None, res: Any) -> set[str] | None:
    """Callsign chưa có file. ``None`` khi không lọc theo số hiệu."""
    if not callsigns:
        return None
    import graph_pib

    found: set[str] = set()
    for item in res.saved:
        found |= graph_pib.cs_keys(item.callsign)
    return {c for c in callsigns if not (graph_pib.cs_keys(c) & found)}


def _absorb_pib(into: Any, part: Any) -> None:
    into.saved.extend(part.saved)
    into.scanned += part.scanned
    into.errors.extend(part.errors)


def _download_pib_sources(
    token: str,
    *,
    since: datetime | None,
    until: datetime | None,
    callsigns: set[str] | None,
    days: float,
    overwrite: bool,
    out_dir: Path | str | None,
    on_progress: Callable[[str, str], None] | None,
    folder_name: str,
    cancel: Any | None,
) -> Any:
    """PIB chung OMC (SGN/HAN/DAD) trước, thiếu thì folder PIB mail cá nhân."""
    import graph_pib

    box = config.OMC_SHARED_MAILBOX
    stations: list[tuple[str, str]] = []
    try:
        stations = _find_pib_station_folders(_rest_session(token), box)
    except OwaAuthError:
        raise
    except OwaError as exc:
        log.info("PIB hộp %s: %s", box, exc)
        if on_progress:
            on_progress(f"· hộp {box}: {exc}", "")

    common = dict(
        since=since, until=until, days=days, overwrite=overwrite,
        out_dir=out_dir, on_progress=on_progress, cancel=cancel,
    )
    res = graph_pib.Result()
    remain: set[str] | None = set(callsigns) if callsigns else None
    for fid, name in stations:
        if remain is not None and not remain:
            break
        part = _download_outlook_rest(
            token, callsigns=remain, folder_name=name, mailbox=box,
            folder_id=fid, **common,
        )
        _absorb_pib(res, part)
        remain = _wanted_left(callsigns, res)
    if remain is None or remain:
        if stations and remain and on_progress:
            on_progress("· chưa đủ trên hộp OMC — tìm PIB mail cá nhân", "")
        try:
            part = _download_outlook_rest(
                token,
                callsigns=remain if callsigns else None,
                folder_name=folder_name,
                mailbox="",
                **common,
            )
            _absorb_pib(res, part)
        except (OwaAuthError, OwaCancelled):
            raise
        except OwaError as exc:
            # Hộp cá nhân thiếu thư mục PIB (hoặc lỗi liệt kê) — bỏ qua,
            # giữ nguyên các file đã tải được từ hộp chung OMC.
            log.info("PIB mail cá nhân: %s", exc)
            if on_progress:
                on_progress(f"· mail cá nhân: {exc} — giữ kết quả từ hộp OMC", "")
    return res


def download(
    token: str,
    *,
    since: datetime | None = None,
    until: datetime | None = None,
    callsigns: set[str] | None = None,
    days: float = 2.0,
    overwrite: bool = False,
    out_dir: Path | str | None = None,
    on_progress: Callable[[str, str], None] | None = None,
    folder_name: str = "PIB",
    cancel: Any | None = None,
) -> Any:
    """Tải PIB qua Outlook REST bằng token lấy trực tiếp từ Outlook Web."""
    claims = _jwt_claims(token)
    audience = str(claims.get("aud") or "").lower()
    if "outlook" not in audience and "00000002-0000-0ff1" not in audience:
        raise OwaAuthError(
            "Outlook Web không cấp token cho Outlook mailbox.",
            stage="token audience",
        )
    return _download_pib_sources(
        token,
        since=since,
        until=until,
        callsigns=callsigns,
        days=days,
        overwrite=overwrite,
        out_dir=out_dir,
        on_progress=on_progress,
        folder_name=folder_name,
        cancel=cancel,
    )


def _folder_name(f: dict[str, Any]) -> str:
    return (f.get("DisplayName") or f.get("displayName") or "").strip()


def _folder_id(f: dict[str, Any]) -> str:
    return str(f.get("Id") or f.get("id") or "")


def _save_json_cache(path: Path, data: dict[str, Any]) -> None:
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


def _load_folder_map() -> dict[str, str]:
    """Đọc cache folder: bản mới ``{tên: id}``, bản cũ ``{name, id}`` vẫn đọc được."""
    if not FOLDER_CACHE.is_file():
        return {}
    try:
        raw = json.loads(FOLDER_CACHE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    keys = set(raw)
    if keys <= {"name", "id", "at"}:
        name = str(raw.get("name") or "").strip()
        fid = str(raw.get("id") or "").strip()
        return {name: fid} if name and fid else {}
    out: dict[str, str] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        name, fid = key.strip(), value.strip()
        if name and fid:
            out[name] = fid
    return out


def _folder_cache_put(name: str, fid: str) -> None:
    mapping = _load_folder_map()
    for key in list(mapping):
        if key.casefold() == name.casefold():
            del mapping[key]
    mapping[name] = fid
    try:
        _save_json_cache(FOLDER_CACHE, mapping)
    except OSError:
        log.debug("không lưu được folder cache", exc_info=True)


def drop_folder_cache(folder_name: str = "") -> None:
    """Xoá một folder khỏi cache, hoặc cả file nếu không chỉ tên."""
    want = (folder_name or "").strip()
    if not want:
        try:
            FOLDER_CACHE.unlink(missing_ok=True)
        except OSError:
            pass
        return
    mapping = _load_folder_map()
    changed = False
    suffix = f"::{want}".casefold()
    for key in list(mapping):
        k = key.casefold()
        if k == want.casefold() or k.endswith(suffix):
            del mapping[key]
            changed = True
    if changed:
        try:
            _save_json_cache(FOLDER_CACHE, mapping)
        except OSError:
            log.debug("không ghi được folder cache", exc_info=True)


def _rest_session(token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    })
    return s


def _mail_recipient(addr: str) -> dict[str, Any]:
    name = str(addr or "").strip()
    if "@" in name:
        return {"EmailAddress": {"Address": name}}
    return {"EmailAddress": {"Name": name, "Address": name}}


def create_draft(
    token: str,
    *,
    subject: str,
    body: str,
    to: list[str] | tuple[str, ...] = (),
    cc: list[str] | tuple[str, ...] = (),
    attachments: list[Path] | tuple[Path, ...] | list[str] | tuple[str, ...] = (),
    mailbox: str = "",
    html: bool = False,
    inline: dict[str, Path | str] | None = None,
) -> str:
    """Lưu nháp, không Send.

    ``mailbox`` rỗng → ``/me/messages`` (hộp thư riêng). Có địa chỉ → nháp nằm
    trong Drafts của **hộp thư chung** đó (``/users('...')/messages``), cần quyền
    Full Access; thiếu quyền thì Exchange trả 403 → :class:`OwaAuthError`.

    ``html=True`` để thân thư là HTML. Thân dạng Text thì Outlook Web không cho
    dán ảnh vào và cũng không chèn được chữ ký.
    """
    files: list[dict[str, Any]] = []
    for raw in attachments:
        p = Path(raw)
        if not p.is_file():
            raise OwaError(f"Thiếu file đính kèm: {p}")
        files.append({
            "@odata.type": "#Microsoft.OutlookServices.FileAttachment",
            "Name": p.name,
            "ContentBytes": base64.b64encode(p.read_bytes()).decode("ascii"),
        })
    for cid, raw in (inline or {}).items():
        p = Path(raw)
        if not p.is_file():
            raise OwaError(f"Thiếu ảnh chèn trong thư: {p}")
        files.append({
            "@odata.type": "#Microsoft.OutlookServices.FileAttachment",
            "Name": p.name,
            "ContentBytes": base64.b64encode(p.read_bytes()).decode("ascii"),
            "IsInline": True,
            "ContentId": str(cid),
        })
    payload: dict[str, Any] = {
        "Subject": subject,
        "Body": {"ContentType": "HTML" if html else "Text", "Content": body},
        "ToRecipients": [_mail_recipient(a) for a in to if a],
        "CcRecipients": [_mail_recipient(a) for a in cc if a],
    }
    if files:
        payload["Attachments"] = files
    box = str(mailbox or "").strip()
    # Giữ nguyên @ . - _ trong địa chỉ: %40 chỉ làm log khó đọc khi lần lỗi quyền.
    url = (f"{OUTLOOK_REST}/users('{quote(box, safe='@.-_+')}')/messages" if box
           else f"{OUTLOOK_REST}/me/messages")
    response = _rest_session(token).post(url, json=payload, timeout=60)
    _status_code(response, f"soạn nháp trong {box}" if box else "soạn nháp")
    try:
        created = response.json()
    except (ValueError, TypeError):
        created = {}
    return str(created.get("Id") or created.get("id") or "")


def _folder_cache_key(folder_name: str, mailbox: str = "") -> str:
    name = (folder_name or "").strip()
    box = (mailbox or "").strip()
    return f"{box}::{name}" if box else name


def _list_mailfolders(s: requests.Session, mailbox: str = "") -> list[dict[str, Any]]:
    """Lấy hết mail folder (Outlook REST mặc định chỉ ~10 — thiếu PIB)."""
    out: list[dict[str, Any]] = []
    url: str | None = f"{rest_root(mailbox)}/mailfolders?$top=100"
    while url:
        r = s.get(url, timeout=60)
        _status_code(r, "liệt kê thư mục")
        try:
            data = r.json()
        except (ValueError, TypeError) as exc:
            raise OwaError("Outlook REST trả dữ liệu folder không hợp lệ.") from exc
        out.extend(data.get("value") or [])
        url = data.get("@odata.nextLink")
    return out


# Folder OMC đánh số: ``8. PIB``, ``8.1 SGN``, ``0. FLIGHT PLAN``.
_NUMBERED_FOLDER = frozenset({"flight plan", "pib", "sgn", "han", "dad", "gendec"})
PIB_STATIONS = ("SGN", "HAN", "DAD")


def _folder_name_matches(display: str, want: str) -> bool:
    """``PIB`` khớp ``8. PIB``; ``SGN`` khớp ``8.1 SGN``."""
    got = (display or "").casefold().strip()
    need = (want or "").casefold().strip()
    if not got or not need:
        return False
    if got == need:
        return True
    if need in _NUMBERED_FOLDER:
        stripped = re.sub(r"^[\d.]+\s*", "", got).strip()
        return stripped == need
    return False


def _find_folder_id(
    s: requests.Session, folder_name: str = "PIB", *, mailbox: str = "",
) -> tuple[str, str]:
    """Trả ``(id, display_name)``. Cache Id theo tên — PIB và FPL không đè nhau."""
    want = folder_name.strip()
    cache_key = _folder_cache_key(want, mailbox)
    config.ensure_dirs()
    cached = _load_folder_map()
    for name, fid in cached.items():
        if name.casefold() == cache_key.casefold() and fid:
            return fid, want if mailbox.strip() else name

    tops = _list_mailfolders(s, mailbox)

    def kids(parent_id: str) -> list[dict[str, Any]]:
        r = s.get(
            f"{rest_root(mailbox)}/mailfolders/{parent_id}/childfolders?$top=100",
            timeout=60,
        )
        _status_code(r, "liệt kê thư mục con")
        return r.json().get("value") or []

    stack = list(tops)
    seen: set[str] = set()
    while stack:
        f = stack.pop()
        fid = _folder_id(f)
        if not fid or fid in seen:
            continue
        seen.add(fid)
        name = _folder_name(f)
        if _folder_name_matches(name, want):
            _folder_cache_put(cache_key, fid)
            return fid, name
        cnt = int(f.get("ChildFolderCount") or f.get("childFolderCount") or 0)
        if cnt:
            stack.extend(kids(fid))

    names = ", ".join(_folder_name(f) for f in tops[:30])
    raise OwaError(
        f"Không thấy thư mục {folder_name!r} trong mailbox. "
        f"Folder hiện có (một phần): {names}"
    )


def _find_pib_station_folders(
    s: requests.Session, mailbox: str,
) -> list[tuple[str, str]]:
    """Thư mục SGN / HAN / DAD nằm ngay dưới PIB của hộp chung."""
    parent_id, _parent = _find_folder_id(s, "PIB", mailbox=mailbox)
    r = s.get(
        f"{rest_root(mailbox)}/mailfolders/{parent_id}/childfolders?$top=100",
        timeout=60,
    )
    _status_code(r, "liệt kê thư mục PIB")
    kids = r.json().get("value") or []
    found: list[tuple[str, str]] = []
    for station in PIB_STATIONS:
        for kid in kids:
            if _folder_name_matches(_folder_name(kid), station):
                found.append((_folder_id(kid), _folder_name(kid)))
                break
    return found


def _subject_hits_want(subject: str, want: set[str] | None) -> bool:
    """True nếu subject khả năng chứa callsign đang tìm — tránh gọi attachments."""
    if not want:
        return True
    import graph_pib

    cs = _callsign_of("", subject)
    if cs and (graph_pib.cs_keys(cs) & want):
        return True
    compact = re.sub(r"[^A-Z0-9]", "", (subject or "").upper())
    for k in want:
        if len(k) >= 3 and k in compact:
            return True
    return False


def _download_outlook_rest(
    token: str,
    *,
    since: datetime | None,
    until: datetime | None,
    callsigns: set[str] | None,
    days: float,
    overwrite: bool,
    out_dir: Path | str | None,
    on_progress: Callable[[str, str], None] | None,
    folder_name: str,
    cancel: Any | None = None,
    mailbox: str = "",
    folder_id: str = "",
) -> Any:
    """Tải nhanh: lọc subject → chỉ fetch attachment khớp → tải PDF song song."""
    import graph_pib

    out = Path(out_dir) if out_dir is not None else config.get_path("pibwx")
    out.mkdir(parents=True, exist_ok=True)
    want: set[str] | None = None
    want_list: list[str] = []
    if callsigns:
        want = set()
        want_list = [c for c in callsigns if c]
        for c in want_list:
            want |= graph_pib.cs_keys(c)

    lo = since or (datetime.now(timezone.utc) - timedelta(days=days))
    hi = until
    s = _rest_session(token)

    if folder_id:
        fid, found_name = folder_id, folder_name
    else:
        fid, found_name = _find_folder_id(s, folder_name, mailbox=mailbox)
    root = rest_root(mailbox)
    where = f"{mailbox} / {found_name}" if mailbox else found_name
    log.info("OWA REST thư mục %r", where)
    if on_progress:
        on_progress(f"· thư mục Outlook: {where}", "")

    flt = (
        f"ReceivedDateTime ge {lo.strftime('%Y-%m-%dT%H:%M:%SZ')} "
        f"and HasAttachments eq true"
    )
    if hi is not None:
        flt += f" and ReceivedDateTime le {hi.strftime('%Y-%m-%dT%H:%M:%SZ')}"

    res = graph_pib.Result()
    found_keys: set[str] = set()

    def still_missing() -> bool:
        if not want_list:
            return True  # không chỉ định CS → quét hết cửa sổ (giới hạn trang)
        return any(not (graph_pib.cs_keys(c) & found_keys) for c in want_list)

    # Ứng viên cần tải PDF (đã khớp CS, chưa có file / overwrite)
    to_fetch: list[tuple[str, str, str, datetime | None, str, Path]] = []
    # (mid, aid, cs, when, subject, target)

    url: str | None = (
        f"{root}/mailfolders/{fid}/messages"
        f"?$filter={quote(flt)}"
        f"&$select=Id,Subject,ReceivedDateTime"
        f"&$orderby=ReceivedDateTime desc&$top=50"
    )
    pages = 0
    while url and still_missing():
        if cancel is not None and cancel.is_set():
            raise OwaCancelled("Đã huỷ tải PIB từ Outlook Web.")
        r = s.get(url, timeout=60)
        if r.status_code >= 400:
            # Folder Id có thể cũ; chỉ bỏ đúng folder này, giữ cache PIB/FPL kia.
            drop_folder_cache(found_name)
            _status_code(r, "liệt kê thư PIB")
        data = r.json()
        batch = data.get("value") or []
        pages += 1
        url = data.get("@odata.nextLink") if still_missing() else None

        for msg in batch:
            if cancel is not None and cancel.is_set():
                raise OwaCancelled("Đã huỷ tải PIB từ Outlook Web.")
            if want_list and not still_missing():
                break
            res.scanned += 1
            subject = msg.get("Subject") or msg.get("subject") or ""
            # Lọc subject trước — tiết kiệm ~90% round-trip attachments
            if want and not _subject_hits_want(subject, want):
                continue

            when = None
            rdt = msg.get("ReceivedDateTime") or msg.get("receivedDateTime")
            if rdt:
                when = datetime.fromisoformat(str(rdt).replace("Z", "+00:00"))
            mid = msg.get("Id") or msg.get("id")

            # Chỉ lấy metadata — KHÔNG kéo ContentBytes (rất nặng)
            ar = s.get(
                f"{root}/messages/{mid}/attachments"
                f"?$select=Id,Name,Size,ContentType",
                timeout=45,
            )
            if ar.status_code in (401, 403):
                _status_code(ar, "liệt kê tệp đính kèm")
            if ar.status_code >= 400:
                res.errors.append(f"{subject[:40]}: HTTP {ar.status_code}")
                continue

            for a in ar.json().get("value") or []:
                name = a.get("Name") or a.get("name") or ""
                if not _RE_PIB.match(name):
                    continue
                cs = _callsign_of(name, subject)
                keys = graph_pib.cs_keys(cs)
                if want and not (keys & want):
                    continue
                # Đã có bản mới hơn (orderby desc) cho CS này → bỏ
                if want_list and (keys & found_keys):
                    continue

                target = out / safe_filename(name)
                if target.exists() and not overwrite and target.stat().st_size > 0:
                    res.saved.append(
                        graph_pib.PibFile(cs, target, when, subject, skipped=True)
                    )
                    found_keys |= keys
                    if on_progress:
                        on_progress(f"· đã có {target.name}", cs)
                    continue

                aid = a.get("Id") or a.get("id")
                if mid and aid:
                    to_fetch.append((str(mid), str(aid), cs, when, subject, target))
                    found_keys |= keys  # đặt chỗ — tránh xếp hàng trùng CS

        if pages >= 20:  # 20*50 = 1000 thư tối đa
            break

    def _pull(item: tuple[str, str, str, datetime | None, str, Path]):
        if cancel is not None and cancel.is_set():
            raise OwaCancelled("Đã huỷ tải PIB từ Outlook Web.")
        mid, aid, cs, when, subject, target = item
        sess = _rest_session(token)
        br = sess.get(
            f"{root}/messages/{mid}/attachments/{aid}/$value",
            timeout=180,
        )
        if br.status_code in (401, 403):
            _status_code(br, "tải PDF")
        if br.status_code >= 400 or not br.content:
            return ("err", cs, subject, target, f"{target.name}: HTTP {br.status_code}")
        tmp = target.with_name(
            f"{target.name}.part{os.getpid()}-{threading.get_ident()}"
        )
        try:
            tmp.write_bytes(br.content)
            atomic_replace(tmp, target)
        finally:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
        return ("ok", cs, subject, target, when)

    if to_fetch:
        if on_progress:
            on_progress(f"· tải {len(to_fetch)} PDF song song…", "")
        workers = min(_POOL, len(to_fetch))
        pool = ThreadPoolExecutor(max_workers=workers)
        futs = [pool.submit(_pull, it) for it in to_fetch]
        terminal_error: OwaError | None = None
        try:
            for fut in as_completed(futs):
                try:
                    kind, cs, subject, target, extra = fut.result()
                except (OwaAuthError, OwaCancelled) as exc:
                    terminal_error = exc
                    for pending in futs:
                        pending.cancel()
                    break
                except Exception as exc:
                    res.errors.append(str(exc))
                    continue
                if kind == "err":
                    res.errors.append(str(extra))
                    continue
                when = extra if isinstance(extra, datetime) or extra is None else None
                res.saved.append(graph_pib.PibFile(cs, target, when, subject))
                if on_progress:
                    on_progress(f"✓ tải mới: {target.name}", cs)
                log.info("OWA REST lưu %s", target.name)
        finally:
            # Luôn chờ worker thoát trước khi caller mở Chrome/retry. Các request
            # đang chạy không huỷ tức thời; để chúng sống nền có thể ghi file muộn.
            pool.shutdown(wait=True, cancel_futures=terminal_error is not None)
        if terminal_error is not None:
            raise terminal_error

    log.info(
        "OWA REST quét %d thư | tải %d | lưu mới %d | bỏ qua %d | lỗi %d",
        res.scanned,
        len(to_fetch),
        len(res.new),
        len(res.saved) - len(res.new),
        len(res.errors),
    )
    return res
