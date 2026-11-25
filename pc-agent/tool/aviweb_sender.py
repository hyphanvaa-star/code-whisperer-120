"""Selenium write adapter for AviWeb FPL, DLA and CHG operations.

The adapter deliberately has no Excel dependency.  Every write receives the
exact message which the local OFP revision service displayed to the operator.
"""
from __future__ import annotations

import re
import logging
import shutil
import tempfile
import time
import threading
from pathlib import Path
from typing import Callable



class AviWebSendError(RuntimeError):
    pass


_LOG = logging.getLogger(__name__)


def operator_send_error(error: object) -> str:
    raw = str(error or "").strip()
    lowered = raw.lower()
    if "no such window" in lowered or "target window already closed" in lowered:
        return (
            "Cửa sổ AviWeb đã đóng trong lúc gửi. Hệ thống không tự gửi lại để tránh "
            "gửi trùng: hãy kiểm tra điện văn đã tới AviWeb hay chưa, mở/đăng nhập lại "
            "AviWeb, chạy CHECK AVIWEB, rồi tự quyết định có gửi lại hay không."
        )
    if isinstance(error, AviWebSendError):
        return raw.splitlines()[0]
    return "AviWeb gặp lỗi kỹ thuật; không tự gửi lại. Hãy chạy CHECK AVIWEB trước khi quyết định gửi lại."


def split_messages(content: str) -> list[str]:
    body = re.sub(r"(?m)^\s*=+.*?=+\s*$", "", str(content or ""))
    messages, depth, start = [], 0, None
    for index, char in enumerate(body):
        if char == "(":
            if depth == 0:
                start = index
            depth += 1
        elif char == ")" and depth:
            depth -= 1
            if depth == 0 and start is not None:
                messages.append(body[start:index + 1].strip())
                start = None
    return messages


def callsign_from_message(message: str) -> str:
    match = re.match(r"\((?:FPL|DLA|CHG)-([A-Z0-9]+)-", message.strip(), re.I)
    return match.group(1).upper() if match else ""


def prepare_fpl_for_aviweb(raw: str, *, preserve_lines: bool = False, rules=None) -> str:
    from .atc_rules import apply, DEFAULT_ROWS
    # Standalone compatibility only. Web callers always supply the active table.
    return apply(raw, DEFAULT_ROWS if rules is None else rules, preserve_lines=preserve_lines)['content']


def prepare_aviweb_payload(kind: str, content: str, *, rules=None) -> str:
    messages = split_messages(content)
    if str(kind or '').upper() == 'FPL':
        messages = [prepare_fpl_for_aviweb(message, rules=rules) for message in messages]
    return '\r\n\r\n'.join(messages) + ('\r\n' if messages else '')


def validate_edited_payload(kind: str, content: str, expected_callsigns: list[str]) -> str:
    """Validate an operator-edited preview without changing its ATC fields."""
    operation = str(kind or "").upper()
    messages = split_messages(content)
    if not messages:
        raise AviWebSendError("Nội dung ATC sau chỉnh sửa đang trống hoặc sai cấu trúc ngoặc")
    actual: list[str] = []
    for message in messages:
        match = re.match(r"\((FPL|DLA|CHG)-([A-Z0-9]+)-", message.strip(), re.I)
        if not match or match.group(1).upper() != operation:
            raise AviWebSendError(f"Preview {operation} chứa điện văn sai loại hoặc sai cấu trúc")
        actual.append(match.group(2).upper())
    expected = [str(value or "").strip().upper() for value in expected_callsigns if str(value or "").strip()]
    if sorted(actual) != sorted(expected):
        raise AviWebSendError(
            "Callsign sau chỉnh sửa không khớp danh sách đã chọn: "
            f"cần {', '.join(expected)}, hiện có {', '.join(actual)}"
        )
    return "\r\n\r\n".join(message.strip() for message in messages) + "\r\n"


class AviWebSender:
    LOGIN = "https://aviweb.vnaic.vn/AviWeb/login#!aaa-login"
    FILING = "https://aviweb.vnaic.vn/AviWeb/#!fplf"
    PROCESSED = "https://aviweb.vnaic.vn/AviWeb/#!manager-processed"

    def __init__(self, *, headless: bool = False):
        self.headless = headless
        self._emit_callback = None

    def _note(self, text: str, level: str = "info"):
        if self._emit_callback:
            self._emit_callback(text, level)

    @staticmethod
    def _visible_inputs(driver, selector: str):
        items = driver.find_elements("css selector", selector)
        return [item for item in items if item.is_displayed() and item.is_enabled()]

    def _type_input(self, driver, element, value: str, commit=None):
        """Interact with a visible Vaadin input, with JS-assisted clearing."""
        _, _, Actions, _, Keys, _, _ = self._selenium()
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", element)
        try:
            Actions(driver).move_to_element(element).click().perform()
            element.send_keys(Keys.CONTROL, "a"); element.send_keys(Keys.BACKSPACE)
        except Exception:
            driver.execute_script(
                "arguments[0].focus();arguments[0].value='';"
                "arguments[0].dispatchEvent(new Event('input',{bubbles:true}));", element)
        try:
            element.send_keys(value)
            if commit: element.send_keys(commit)
        except Exception as exc:
            raise AviWebSendError(
                f"Input không tương tác được: value={value!r}, displayed={element.is_displayed()}, "
                f"enabled={element.is_enabled()}, class={element.get_attribute('class')!r}"
            ) from exc

    def _type_visible_retry(self, driver, selector: str, index_from_end: int,
                            value: str, commit=None, attempts: int = 5):
        """Reacquire a Vaadin input whenever a token commit rebuilds the DOM."""
        last_error = None
        for attempt in range(1, attempts + 1):
            try:
                inputs = self._visible_inputs(driver, selector)
                if len(inputs) < index_from_end:
                    raise AviWebSendError(
                        f"Chỉ thấy {len(inputs)} input hiện; cần vị trí -{index_from_end} cho {value!r}"
                    )
                self._type_input(driver, inputs[-index_from_end], value, commit)
                return
            except Exception as exc:
                last_error = exc
                if "stale" not in str(exc).lower() and "StaleElementReference" not in type(exc).__name__:
                    raise
                self._note(f"DOM Vaadin đổi khi nhập {value}; tìm lại input lần {attempt + 1}/{attempts}", "warn")
                time.sleep(.35)
        raise AviWebSendError(f"Input liên tục bị stale khi nhập {value!r}: {last_error}") from last_error

    @staticmethod
    def _selenium():
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
            from selenium.webdriver.common.action_chains import ActionChains
            from selenium.webdriver.common.by import By
            from selenium.webdriver.common.keys import Keys
            from selenium.webdriver.support import expected_conditions as EC
            from selenium.webdriver.support.ui import WebDriverWait
            return webdriver, Options, ActionChains, By, Keys, EC, WebDriverWait
        except ImportError as exc:
            raise AviWebSendError("Thiếu Selenium trong Python đang chạy web") from exc

    def _driver(self):
        webdriver, Options, *_ = self._selenium()
        profile = Path(tempfile.mkdtemp(prefix="CFP_AviWeb_"))
        options = Options()
        for value in ("--disable-gpu", "--disable-dev-shm-usage", "--mute-audio",
                      "--no-sandbox", "--disable-extensions", "--no-first-run",
                      "--disable-save-password-bubble",
                      "--disable-features=PasswordLeakDetection,LeakDetection,PasswordManagerOnboarding"):
            options.add_argument(value)
        options.add_argument(f"--user-data-dir={profile}")
        if self.headless:
            options.add_argument("--headless=new")
        else:
            options.add_argument("--start-maximized")
        options.add_experimental_option("prefs", {"credentials_enable_service": False,
                                                   "profile.password_manager_enabled": False,
                                                   "profile.password_manager_leak_detection": False})
        return webdriver.Chrome(options=options), profile

    def _login(self, driver, username: str, password: str):
        _, _, _, By, _, EC, Wait = self._selenium()
        driver.get(self.LOGIN)
        Wait(driver, 60).until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, '[location="usernameField"] input'))).send_keys(username)
        Wait(driver, 60).until(EC.presence_of_element_located(
            (By.CSS_SELECTOR, '[location="passwordField"] input'))).send_keys(password)
        Wait(driver, 60).until(EC.element_to_be_clickable(
            (By.XPATH, '//div[@location="loginButton"]//span[text()="Login"]'))).click()
        Wait(driver, 120).until(EC.presence_of_element_located(
            (By.XPATH, '//span[normalize-space()="Flight Plan Manager" or normalize-space()="Dashboard"]')))

    @staticmethod
    def _safe_click(driver, element):
        try:
            element.click()
        except Exception:
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});arguments[0].click();", element)

    def _addresses_and_submit(self, driver):
        _, _, _, By, Keys, EC, Wait = self._selenium()
        wanted = {"VVTSVJCX", "KHOUXAAF"}
        container = Wait(driver, 60).until(EC.presence_of_element_located(
            (By.XPATH, '//div[@location="addresseesField"]')))

        def labels():
            return {element.text.strip().upper() for element in
                    container.find_elements(By.CSS_SELECTOR, ".tokenComponentTokenEdit")
                    if element.text.strip()}

        def remove_tokens():
            for token in list(container.find_elements(By.CSS_SELECTOR, ".tokenComponentToken")):
                try:
                    remove = token.find_element(By.CSS_SELECTOR, ".tokenComponentTokenRemove")
                    self._safe_click(driver, remove)
                    Wait(driver, 5).until(EC.staleness_of(token))
                except Exception:
                    continue

        def input_field():
            candidates = container.find_elements(By.CSS_SELECTOR, "input.tokenComponentInputComponent")
            visible = [item for item in candidates if item.is_displayed() and item.is_enabled()]
            if not visible:
                raise AviWebSendError("Không tìm thấy ô nhập addressee đang hoạt động")
            return visible[-1]

        for attempt in range(1, 4):
            remove_tokens()
            for address in ("VVTSVJCX", "KHOUXAAF"):
                field = input_field()
                field.send_keys(Keys.CONTROL, "a"); field.send_keys(Keys.BACKSPACE)
                field.send_keys(address); time.sleep(.35); field.send_keys(Keys.TAB)
                Wait(driver, 15).until(lambda _d, address=address: address in labels())
                time.sleep(.35)
            actual = labels()
            if actual == wanted:
                break
            self._note(f"Addressee lần {attempt} chưa khớp: {sorted(actual)}; nhập lại", "warn")
        actual = labels()
        if actual != wanted:
            raise AviWebSendError(f"Addressee chưa khớp, dừng Submit: {sorted(actual)}")
        button = Wait(driver, 60).until(EC.element_to_be_clickable((By.XPATH,
            '//div[@location="btnSubmit"]//div[contains(@class,"v-button") and not(contains(@class,"v-disabled")) and .//span[text()="Submit"]]')))
        before_url = driver.current_url
        self._safe_click(driver, button)

        def submitted(d):
            try:
                if EC.staleness_of(button)(d):
                    return "form closed"
            except Exception:
                return "form closed"
            if d.current_url != before_url:
                return "page changed"
            for notice in d.find_elements(By.CSS_SELECTOR, ".v-Notification, .v-notification, [class*='notification']"):
                text = notice.text.strip().lower()
                if notice.is_displayed() and any(word in text for word in ("success", "submitted", "sent")):
                    return text[:120]
            return False

        try:
            evidence = Wait(driver, 25).until(submitted)
        except Exception as exc:
            raise AviWebSendError(
                "Đã click Submit nhưng chưa có xác nhận từ AviWeb; không ghi SENT"
            ) from exc
        return str(evidence)

    def _send_fpl(self, driver, message: str):
        _, _, _, By, _, EC, Wait = self._selenium()
        if "#!fplf" not in str(driver.current_url):
            driver.get(self.FILING)
        self._safe_click(driver, Wait(driver, 60).until(EC.element_to_be_clickable((By.XPATH, '//span[text()="Load"]'))))
        box = Wait(driver, 60).until(EC.presence_of_element_located((By.CSS_SELECTOR, '[location="message"] textarea')))
        box.clear(); box.send_keys(message)
        self._safe_click(driver, Wait(driver, 30).until(EC.element_to_be_clickable((By.CSS_SELECTOR, '[location="btnSubmit"] div[role="button"]'))))
        self._safe_click(driver, Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH, '//div[@location="submitButton"]//span[text()="Submit"]'))))
        try:
            yes = Wait(driver, 4).until(EC.element_to_be_clickable((By.XPATH, '//div[@role="button"]//span[text()="Yes"]')))
            self._safe_click(driver, yes)
        except Exception:
            pass
        return self._addresses_and_submit(driver)

    def _open_row_action(self, driver, callsign: str, action: str):
        _, _, Actions, By, _, EC, Wait = self._selenium()
        driver.get(self.PROCESSED)
        row = Wait(driver, 180).until(EC.presence_of_element_located((By.XPATH,
            f'//div[contains(@class,"v-table-cell-wrapper") and normalize-space(text())="{callsign}"]')))
        Actions(driver).context_click(row).perform()
        self._safe_click(driver, Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH,
            f'//td[@class="gwt-MenuItem" and .//div[text()="{action}"]]'))))

    def _send_dla(self, driver, message: str):
        _, _, _, By, _, EC, Wait = self._selenium()
        callsign = callsign_from_message(message)
        match = re.match(r"\(DLA-[^-]+-[A-Z]{4}(\d{4})-", message.strip(), re.I)
        if not callsign or not match:
            raise AviWebSendError("Không đọc được callsign/EOBT từ điện văn DLA")
        self._open_row_action(driver, callsign, "Delay")
        field = Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH, '//div[@location="timeComponent"]//input[@type="text"]')))
        field.clear(); field.send_keys(match.group(1))
        self._safe_click(driver, Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH,
            '//div[@role="button" and contains(@class,"v-button")]//span[text()="Submit"]'))))
        try:
            self._safe_click(driver, Wait(driver, 4).until(EC.element_to_be_clickable((By.XPATH, '//div[@role="button"]//span[text()="Yes"]'))))
        except Exception:
            pass
        return self._addresses_and_submit(driver)

    def _send_chg(self, driver, message: str):
        """Open Change form, then paste the validated ICAO CHG message if supported.

        AviWeb's current Change UI is field-based. Route/destination field
        selectors cannot safely be inferred without a live DOM, so fail closed
        instead of sending a partial CHG.
        """
        callsign = callsign_from_message(message)
        fields = dict(re.findall(r"(?m)^-(9|10|13|15|16|18)/(.*?)(?=\r?\n-\d+/|\)$)", message, re.S))
        unsupported = sorted(set(fields) & {"15", "16"})
        if unsupported:
            raise AviWebSendError("CHG có field " + ", ".join(unsupported) + "; chưa có selector AviWeb đã xác minh, không gửi partial")
        if not callsign:
            raise AviWebSendError("Không đọc được callsign từ CHG")
        self._note(f"CHG {callsign}: mở Processed → Change")
        self._open_row_action(driver, callsign, "Change")
        _, _, _, By, Keys, EC, Wait = self._selenium()
        if "13" in fields:
            eobt = re.search(r"(\d{4})$", fields["13"].strip())
            if eobt:
                self._note(f"CHG {callsign}: nhập EOBT {eobt.group(1)}")
                box = Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH, '//div[@location="eobtField"]//input')))
                self._type_input(driver, box, eobt.group(1))
        if "9" in fields or "10" in fields:
            item9 = fields.get("9", "").strip(); item10 = fields.get("10", "").strip()
            aircraft, _, wake = item9.partition("/")
            equipment, _, surveillance = item10.partition("/")
            if aircraft:
                self._note(f"CHG {callsign}: aircraft={aircraft}")
                box = Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH, '//div[@location="aircraftTypeField"]//input')))
                self._type_input(driver, box, aircraft); time.sleep(.8); box.send_keys(Keys.TAB)
            if equipment:
                self._note(f"CHG {callsign}: equipment={equipment}")
                box = Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH, '//div[@location="aircraftEquipmentComponent"]//input')))
                self._type_input(driver, box, equipment); time.sleep(.2); box.send_keys(Keys.ENTER)
            if surveillance:
                self._note(f"CHG {callsign}: surveillance={surveillance}")
                box = Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH, '//div[@location="surveillanceEquipmentComponent"]//input')))
                self._type_input(driver, box, surveillance, Keys.ENTER)
            if wake:
                self._note(f"CHG {callsign}: wake={wake}")
                box = Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH, '//div[@location="wakeTurbulenceComponent"]//input')))
                self._type_input(driver, box, wake, Keys.ENTER)
        tokens = {}
        if "18" in fields:
            current = None
            for token in fields["18"].replace("\r", " ").replace("\n", " ").split():
                if "/" in token:
                    current, value = token.split("/", 1); tokens[current] = value
                elif current:
                    tokens[current] += " " + token
        try:
            self._note(f"CHG {callsign}: xóa field 18 cũ, giữ DOF")
            while True:
                containers = driver.find_elements(By.CSS_SELECTOR, "div.tokenComponentContainer")
                if not containers: break
                removed = False
                for token in containers[0].find_elements(By.CSS_SELECTOR, "div.tokenComponentToken"):
                    label = token.text.strip().upper()
                    if label.startswith("DOF/"): continue
                    button = token.find_element(By.CSS_SELECTOR, "div.tokenComponentTokenRemove")
                    driver.execute_script("arguments[0].scrollIntoView(true);", button)
                    self._safe_click(driver, button); Wait(driver, 5).until(EC.staleness_of(button)); removed = True; break
                if not removed: break
        except Exception as exc:
            raise AviWebSendError(f"Không xóa được field 18 cũ: {exc}") from exc
        def enter_token(code, value):
            inputs = self._visible_inputs(driver, "input.v-textfield")
            if len(inputs) < 2: raise AviWebSendError(f"Không tìm thấy token inputs cho {code}")
            self._note(f"CHG {callsign}: token {code}/{value}")
            self._type_visible_retry(driver, "input.v-textfield", 2, code, Keys.TAB); time.sleep(.45)
            self._type_visible_retry(driver, "input.v-textfield", 1, value, Keys.TAB); time.sleep(.7)
        def actual_tokens():
            result = {}
            for element in driver.find_elements(By.CSS_SELECTOR, ".tokenComponentTokenEdit"):
                label = element.text.strip()
                if "/" in label:
                    key, value = label.split("/", 1); result.setdefault(key.strip().upper(), []).append(value.strip().upper())
            return result
        def delete_token(code, value):
            target = f"{code}/{value}".strip().upper()
            containers = driver.find_elements(By.CSS_SELECTOR, "div.tokenComponentContainer")
            if not containers: return
            for element in containers[0].find_elements(By.CSS_SELECTOR, "div.tokenComponentToken"):
                if element.text.strip().upper() == target:
                    button = element.find_element(By.CSS_SELECTOR, "div.tokenComponentTokenRemove")
                    self._safe_click(driver, button); Wait(driver, 5).until(EC.staleness_of(button)); return
        for code, value in tokens.items():
            if code != "DOF": enter_token(code, value)
        for _attempt in range(5):
            actual = actual_tokens(); corrected = False
            for code, expected in tokens.items():
                values = actual.get(code.upper(), [])
                wanted = expected.strip().upper()
                if code == "DOF": continue
                if values.count(wanted) > 1:
                    while values.count(wanted) > 1:
                        delete_token(code, expected); values.remove(wanted); corrected = True
                elif wanted not in values:
                    for current in list(values): delete_token(code, current)
                    enter_token(code, expected); corrected = True
            time.sleep(.8)
            if not corrected: break
        actual = actual_tokens()
        mismatch = [f"{key}/{value} (actual={actual.get(key.upper(), [])})" for key, value in tokens.items()
                    if value.strip().upper() not in actual.get(key.upper(), [])]
        if mismatch: raise AviWebSendError("Field 18 chưa khớp, dừng Submit: " + "; ".join(mismatch))
        self._note(f"CHG {callsign}: field 18 khớp, nhập address và Submit", "ok")
        return self._addresses_and_submit(driver)

    def send(self, kind: str, content: str, username: str, password: str,
             emit: Callable[[str, str], None], cancel) -> dict:
        kind = kind.upper()
        if kind not in {"FPL", "DLA", "CHG"}:
            raise AviWebSendError("AviWeb chỉ hỗ trợ FPL, DLA, CHG; CNL đã loại khỏi phạm vi")
        messages = split_messages(content)
        if not messages:
            raise AviWebSendError("Không có điện văn hợp lệ để gửi")
        driver = None; profile = None; errors = []; sent = 0
        finished = threading.Event()
        try:
            self._emit_callback = emit
            driver, profile = self._driver()

            def stop_browser() -> None:
                cancel.wait()
                if not finished.is_set() and driver:
                    emit("AviWeb: đang đóng Chrome để dừng tác vụ", "warn")
                    try:
                        driver.quit()
                    except Exception:
                        pass

            threading.Thread(target=stop_browser, daemon=True,
                             name="aviweb-send-cancel").start()
            self._login(driver, username, password)
            if cancel.is_set():
                raise InterruptedError("Tác vụ đã được dừng")
            emit("AviWeb login OK", "ok")
            for message in messages:
                cs = callsign_from_message(message) or "UNKNOWN"
                if cancel.is_set(): raise InterruptedError("Tác vụ đã được dừng")
                try:
                    emit(f"{kind} {cs}: đang thao tác", "info")
                    evidence = {"FPL": self._send_fpl, "DLA": self._send_dla, "CHG": self._send_chg}[kind](driver, message)
                    if not evidence:
                        raise AviWebSendError("Không có bằng chứng AviWeb đã nhận Submit")
                    sent += 1; emit(f"{kind} {cs}: SENT · {evidence}", "ok")
                except Exception as exc:
                    operator_error = operator_send_error(exc)
                    errors.append(f"{cs}: {operator_error}")
                    emit(f"{kind} {cs}: LỖI {operator_error}", "error")
                    _LOG.exception("AviWeb send failed for %s %s", kind, cs)
                    emit("AviWeb: đã dừng phần còn lại của batch để tránh thao tác khi trạng thái gửi chưa chắc chắn", "warn")
                    break
            return {"sent": sent, "errors": errors, "total": len(messages)}
        except InterruptedError:
            raise
        except Exception as exc:
            _LOG.exception("AviWeb send setup/login failed")
            raise AviWebSendError(operator_send_error(exc)) from exc
        finally:
            finished.set()
            self._emit_callback = None
            if driver:
                try:
                    driver.quit()
                except Exception:
                    pass
            if profile:
                shutil.rmtree(profile, ignore_errors=True)
