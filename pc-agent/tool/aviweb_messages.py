"""Job-scoped CHG/DLA bridge. Never send to live AviWeb during tests.

The supplied sending selectors and addressees stay in aviweb_sender.py.
This wrapper adds validation and row-bound safety checks, not route selectors.
"""
from __future__ import annotations
import re
import time
from datetime import datetime, timezone, timedelta
from aviweb_sender import AviWebSender, AviWebSendError, validate_edited_payload, split_messages


def _reg(value):
    return re.sub(r'[^A-Z0-9]', '', str(value or '').upper())


def validate_content(operation, content, expected, now=None):
    operation = str(operation).upper()
    if operation not in {'CHG', 'DLA'}:
        raise AviWebSendError('Đường gửi này chỉ hỗ trợ CHG/DLA')
    if not expected or len(expected) > 30:
        raise AviWebSendError('Thiếu danh sách chuyến xác nhận')
    callsigns = [str(e.get('callsign') or '').upper() for e in expected]
    if len(set(callsigns)) != len(callsigns):
        raise AviWebSendError('Danh sách callsign bị trùng')
    normalized = validate_edited_payload(operation, content, callsigns)
    if re.sub(r'\([^()]*\)', '', str(content), flags=re.S).strip():
        raise AviWebSendError('Nội dung ngoài điện hoặc ngoặc không hợp lệ')
    current = now or datetime.now(timezone.utc)
    for message in split_messages(normalized):
        head = re.match(r'^\((CHG|DLA)-([A-Z0-9]+)-([A-Z]{4})(\d{4})-([A-Z]{4})-DOF/(\d{6})(?=\r?\n|\)$)', message)
        if not head:
            raise AviWebSendError('Header CHG/DLA không hợp lệ')
        _, cs, dep, clock, arr, dof = head.groups()
        target = next((e for e in expected if e['callsign'] == cs), None)
        if not target or (dep, arr, dof) != (target.get('dep'), target.get('arr'), target.get('dof')):
            raise AviWebSendError('Callsign/DOF/chặng khác bản xác nhận')
        if not re.fullmatch(r'(?:[01]\d|2[0-3])[0-5]\d', clock):
            raise AviWebSendError('EOBT phải từ 0000 đến 2359 UTC')
        try:
            datetime.strptime(dof, '%y%m%d')
            std = datetime.fromisoformat(str(target.get('std') or '').replace('Z', '+00:00'))
            if std.tzinfo is None or not current - timedelta(hours=6) <= std <= current + timedelta(hours=24):
                raise ValueError()
        except ValueError as exc:
            raise AviWebSendError('Chuyến đã ngoài khung −6/+24 giờ hoặc thiếu ngày giờ') from exc
        if operation == 'DLA':
            if '\n' in message:
                raise AviWebSendError('DLA không nhận field bổ sung')
            continue
        fields = {}
        for line in message[:-1].splitlines()[1:]:
            field = re.fullmatch(r'-(9|10|13|18)/(.+)', line)
            if not field or field[1] in fields:
                raise AviWebSendError('CHG chỉ nhận field 9, 10, 13, 18 một lần')
            fields[field[1]] = field[2]
        if set(fields) != {'9', '10', '13', '18'} or fields['13'] != dep + clock:
            raise AviWebSendError('CHG thiếu field hoặc EOBT không khớp header')
        if not re.fullmatch(r'[A-Z0-9]{2,4}/[LMHJ]', fields['9']) or not re.fullmatch(r'[A-Z0-9]{1,80}/[A-Z0-9]{1,40}', fields['10']):
            raise AviWebSendError('Field 9/10 sai cấu trúc')
        tokens = re.findall(r'(?:^|\s)([A-Z]{2,8})/(.*?)(?=\s[A-Z]{2,8}/|$)', fields['18'])
        keys = [key for key, _ in tokens]
        if len(keys) != len(set(keys)) or any(not v.strip() for _, v in tokens):
            raise AviWebSendError('Field 18 trùng hoặc trống token')
        token_map = dict(tokens)
        if token_map.get('DOF') != dof or not _reg(token_map.get('REG')) or _reg(token_map.get('REG')) != _reg(target.get('reg')):
            raise AviWebSendError('DOF/REG field 18 khác chuyến đã xác nhận')
    return normalized


class AviWebLayoutError(AviWebSendError):
    """Header labels could not be mapped; only then is the content match used."""


# Processed search box (same absolute XPath as atc_check). Optional narrowing:
# when missing, the completeness check still fails closed on partial tables.
_SEARCH_XPATH = '/html/body/div[1]/div/div/div[2]/div/div/div[2]/div/div/div/div/div/div/div/div/div/div/div/div[2]/div/div/div/div[2]/div/div[1]/div/div/div/div[1]/input'
MANUAL_SUBMIT_WAIT_S = 600


def _txt(element):
    value = None
    try:
        value = element.get_attribute('textContent')
    except Exception:
        value = None
    if not isinstance(value, str):
        value = getattr(element, 'text', '')
    return re.sub(r'\s+', ' ', str(value or '')).strip()


def _row_dof(text):
    value = str(text or '').strip()
    for fmt in ('%y%m%d', '%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%d/%m/%y', '%d %b %Y'):
        try:
            return datetime.strptime(value, fmt).strftime('%y%m%d')
        except ValueError:
            pass
    raise AviWebSendError('Không đọc chắc chắn DOF trên dòng Processed — không gửi')


class VerifiedAviWebSender(AviWebSender):
    """Verify the SAME row immediately before action/Submit; ambiguity blocks writes."""
    def __init__(self, expected, manual_submit=False, **kwargs):
        super().__init__(**kwargs)
        # Operator mode: fill and verify everything, then the human clicks the
        # final Submit in the visible Chrome; code never clicks it.
        self.manual_submit = bool(manual_submit)
        self._final_stage = False
        self.expected = {e['callsign']: e for e in expected}
        self.bound = None
        self.bound_snapshot = None
        self.current_callsign = ''
        self.final_submitted = False
        self.results = []

    @staticmethod
    def _row_identity(row):
        cells = row.find_elements('xpath', './td')
        values = [_txt(c).upper() for c in cells]
        # Vaadin 7 renders header captions as td.v-table-header-cell (not th) in
        # a header table separate from the body; plain HTML tables use th.
        table = 'ancestor::*[contains(concat(" ", normalize-space(@class), " "), " v-table ")][1]'
        headers = row.find_elements('xpath', table + '//*[contains(concat(" ", normalize-space(@class), " "), " v-table-header-cell ")] | ' + table + '//th')
        names = [re.sub(r'[^A-Z0-9]', '', _txt(h).upper()) for h in headers]
        if len(names) != len(values):
            raise AviWebLayoutError('Bố cục Processed chưa xác minh được — không gửi')
        aliases = ({'CALLSIGN', 'AIRCRAFTIDENTIFICATION', 'ACID', 'ARCID'}, {'DEP', 'DEPARTURE', 'DEPARTUREAERODROME', 'ADEP'}, {'DEST', 'DES', 'DESTINATION', 'DESTINATIONAERODROME', 'ADES', 'ARR'}, {'DOF', 'DATEOFFLIGHT', 'FLIGHTDATE'})
        indices = []
        for allowed in aliases:
            hits = [i for i, name in enumerate(names) if name in allowed]
            if len(hits) != 1:
                raise AviWebLayoutError('Bố cục Processed chưa xác minh được — không gửi')
            indices.append(hits[0])
        cs, dep, arr, dof = (values[i] for i in indices)
        if not re.fullmatch(r'[A-Z0-9]+', cs) or not re.fullmatch(r'[A-Z]{4}', dep) or not re.fullmatch(r'[A-Z]{4}', arr):
            raise AviWebSendError('Không xác minh được sân đi/đến trên cùng dòng AviWeb')
        return (cs, dep, arr, _row_dof(dof))

    @staticmethod
    def _content_matches(row, wanted):
        """Fallback when headers are unreadable: every expected value must sit
        on this one row, in Callsign → DEP → DEST order, with exactly one
        date cell equal to DOF. Partial or reordered data never matches."""
        cs, dep, arr, dof = wanted
        values = [_txt(c).upper() for c in row.find_elements('xpath', './td')]
        if values.count(cs) != 1 or values.count(dep) != 1 or values.count(arr) != 1 or dep == arr:
            return False
        if not values.index(cs) < values.index(dep) < values.index(arr):
            return False
        dates = []
        for value in values:
            try:
                dates.append(_row_dof(value))
            except AviWebSendError:
                pass
        return dates == [dof]

    def _row_matches(self, row, wanted):
        wanted = tuple(wanted)
        try:
            return self._row_identity(row) == wanted
        except AviWebLayoutError:
            if not getattr(self, '_fallback_noted', False):
                self._fallback_noted = True
                self._note('AviWeb: không đọc được tiêu đề cột — đối chiếu Callsign/DEP/DEST/DOF theo nội dung dòng')
            return self._content_matches(row, wanted)

    def _filter_processed(self, driver, cs):
        """Narrow Processed to this callsign so the rendered table is complete."""
        try:
            boxes = [b for b in driver.find_elements('xpath', _SEARCH_XPATH) if b.is_displayed() and b.is_enabled()]
        except Exception:
            boxes = []
        if not boxes:
            return False
        _, _, _, _, Keys, _, _ = self._selenium()
        box = boxes[0]
        try:
            driver.execute_script('arguments[0].click();', box)
            box.send_keys(Keys.CONTROL, 'a'); box.send_keys(Keys.BACKSPACE)
            box.send_keys(cs); time.sleep(.35); box.send_keys(Keys.ENTER); time.sleep(1.8)
            return True
        except Exception:
            return False

    def _candidates(self, driver, cs):
        _, _, _, By, _, _, _ = self._selenium()
        cell_xpath = f'//div[contains(@class,"v-table-cell-wrapper") and normalize-space(text())="{cs}"]'
        cells = [c for c in driver.find_elements(By.XPATH, cell_xpath) if c.is_displayed()]
        rows = []
        for cell in cells:
            row = cell.find_element(By.XPATH, 'ancestor::tr[1]')
            if all(row.id != r.id for r in rows): rows.append(row)
        if not rows:
            raise AviWebSendError(f'{cs}: không thấy dòng Processed')
        # A rendered subset of a virtual/paged table cannot establish uniqueness.
        complete = driver.execute_script('''
          const row=arguments[0]; let table=row.closest('table');
          if(!table) return false;
          const total=Number(table.getAttribute('aria-rowcount')||0);
          if(total && total>table.rows.length) return false;
          let node=table.parentElement;
          while(node && node!==document.body){
            if(node.scrollHeight>Math.max(table.scrollHeight,table.getBoundingClientRect().height)+6 && node.scrollHeight>node.clientHeight+6) return false;
            if(String(node.className).split(' ').includes('v-table')) break;
            node=node.parentElement;
          }
          return true;
        ''', rows[0])
        if not complete:
            raise AviWebSendError('Danh sách AviWeb đang phân trang/ảo hóa, chưa chứng minh được chuyến duy nhất — không gửi')
        return rows

    def _verify_bound(self, driver):
        if not self.bound or not self.current_callsign:
            raise AviWebSendError('Thiếu dòng AviWeb đã xác minh')
        target = self.expected[self.current_callsign]
        std = datetime.fromisoformat(target['std'].replace('Z', '+00:00'))
        now = datetime.now(timezone.utc)
        if not now - timedelta(hours=6) <= std <= now + timedelta(hours=24):
            raise AviWebSendError('Chuyến đã ngoài khung −6/+24 giờ — không Submit')
        wanted = (target['callsign'], target['dep'], target['arr'], target['dof'])
        rows = self._candidates(driver, self.current_callsign)
        matches = [r for r in rows if self._row_matches(r, wanted)]
        if len(matches) != 1 or matches[0].id != self.bound.id:
            raise AviWebSendError('Dòng Processed đã đổi hoặc không duy nhất — dừng trước Submit')
        if not self._row_matches(self.bound, self.bound_snapshot):
            raise AviWebSendError('Danh tính dòng AviWeb đã thay đổi — không Submit')

    def _open_row_action(self, driver, callsign, action):
        _, _, Actions, By, _, EC, Wait = self._selenium()
        if action not in {'Delay', 'Change'} or callsign not in self.expected:
            raise AviWebSendError('Thao tác hoặc callsign không thuộc bản xác nhận')
        driver.get(self.PROCESSED)
        Wait(driver, 180).until(EC.presence_of_element_located((By.CSS_SELECTOR, 'table.v-table-table, .v-table-table')))
        if self._filter_processed(driver, callsign):
            self._note(f'{callsign}: đã lọc Processed theo callsign')
        Wait(driver, 60).until(EC.presence_of_element_located((By.XPATH,
            f'//div[contains(@class,"v-table-cell-wrapper") and normalize-space(text())="{callsign}"]')))
        target = self.expected[callsign]
        wanted = (target['callsign'], target['dep'], target['arr'], target['dof'])
        rows = self._candidates(driver, callsign)
        matches = [r for r in rows if self._row_matches(r, wanted)]
        if len(matches) != 1:
            raise AviWebSendError(f'{callsign}: không có duy nhất dòng đúng DOF/chặng — không gửi')
        self.bound = matches[0]; self.current_callsign = callsign; self.bound_snapshot = wanted
        self.final_submitted = False
        self._safe_click(driver, self.bound)
        self._verify_bound(driver)
        Actions(driver).context_click(self.bound).perform()
        # Keep the uploaded action selector unchanged.
        self._safe_click(driver, Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH,
            f'//td[@class="gwt-MenuItem" and .//div[text()="{action}"]]'))))

    def _safe_click(self, driver, element):
        label = element.text.strip()
        if label == 'Submit':
            self._verify_bound(driver)
            # Uploaded token helpers are global. Require one visible form to
            # prevent another window's token inputs from authorizing a write.
            windows = [w for w in driver.find_elements('css selector', '.v-window') if w.is_displayed()]
            if len(windows) != 1:
                raise AviWebSendError('Không xác định được duy nhất form AviWeb đang gửi')
            if self._emit_callback:
                self._note(f'{self.current_callsign}: đã kiểm tra đúng DOF/chặng trước Submit')
            if self.manual_submit and self._final_stage:
                return self._wait_operator_submit(driver, element)
            # One click only: a native click that threw may already have submitted.
            element.click()
            return
        return super()._safe_click(driver, element)

    def _wait_operator_submit(self, driver, element):
        """Hand the verified form to the operator. Only a real click/Enter on
        this Submit button followed by the form closing counts as sent; closing
        the form any other way, Chrome closing or a timeout means not sent."""
        driver.execute_script('''
          const b=arguments[0]; window.__aviOperatorSubmit=0;
          const mark=()=>{window.__aviOperatorSubmit=Date.now();};
          b.addEventListener('click',mark,true);
          b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')mark();},true);
        ''', element)
        try:
            driver.switch_to.window(driver.current_window_handle)
        except Exception:
            pass
        self._note(f'{self.current_callsign}: ĐÃ ĐIỀN XONG — kiểm tra trên Chrome rồi tự bấm Submit (chờ tối đa {MANUAL_SUBMIT_WAIT_S // 60} phút)', 'ok')
        deadline = time.monotonic() + MANUAL_SUBMIT_WAIT_S
        clicked = False
        while time.monotonic() < deadline:
            try:
                clicked = bool(driver.execute_script('return window.__aviOperatorSubmit||0')) or clicked
                if '/login' in str(driver.current_url):
                    raise AviWebSendError('AviWeb mất đăng nhập khi chờ bấm Submit — chưa xác nhận gửi')
                element.is_enabled()
            except AviWebSendError:
                raise
            except Exception as exc:
                name = type(exc).__name__
                if 'StaleElement' in name:
                    if clicked:
                        return 'operator Submit'
                    raise AviWebSendError('Form AviWeb đã đóng mà không bấm Submit — chưa gửi') from exc
                raise AviWebSendError('Chrome AviWeb đã đóng khi chờ bấm Submit — kiểm tra AviWeb trước khi gửi lại') from exc
            time.sleep(.5)
        raise AviWebSendError(f'Quá {MANUAL_SUBMIT_WAIT_S // 60} phút chưa bấm Submit — không tự gửi')

    def _addresses_and_submit(self, driver):
        self._verify_bound(driver)
        baseline = set(n.text.strip() for n in driver.find_elements('css selector', '.v-Notification, .v-notification, [class*="notification"]') if n.is_displayed())
        self._final_stage = True
        try:
            evidence = super()._addresses_and_submit(driver)
        finally:
            self._final_stage = False
        notices = [n.text.strip() for n in driver.find_elements('css selector', '.v-Notification, .v-notification, [class*="notification"]') if n.is_displayed() and n.text.strip() not in baseline]
        if '/login' in driver.current_url or any(re.search(r'\b(error|rejected|failed|not sent|not submitted)\b', n, re.I) for n in notices):
            raise AviWebSendError('AviWeb báo lỗi hoặc mất đăng nhập sau Submit; chưa xác nhận đã gửi, không tự gửi lại')
        self.final_submitted = True
        self.results.append({'callsign': self.current_callsign, 'evidence': str(evidence)})
        return evidence


def send_messages(payload, say, cancel):
    operation = str(payload.get('operation') or '').upper()
    expected = payload.get('expected') or []
    content = validate_content(operation, str(payload.get('content') or ''), expected)
    username, password = str(payload.get('aviweb_user') or ''), str(payload.get('aviweb_pass') or '')
    if not username or not password:
        raise AviWebSendError('Chưa có tài khoản AviWeb đã lưu trên web')
    def emit(text, level='info'):
        say(text, {'error':'bad','warn':'bad','ok':'ok'}.get(level,''))
    manual = payload.get('manual_submit') is True
    # Operator mode always shows Chrome; hidden Chrome cannot be clicked.
    sender = VerifiedAviWebSender(expected, manual_submit=manual, headless=(not manual) and bool(payload.get('headless', True)))
    try:
        result = sender.send(operation, content, username, password, emit, cancel)
    except Exception:
        return {'sent': len(sender.results), 'total': len(expected), 'failed': 1,
                'pending': max(0,len(expected)-len(sender.results)-1), 'receipts': sender.results,
                'errors': ['Tác vụ dừng hoặc mất kết nối; kiểm tra AviWeb trước khi quyết định gửi lại.']}
    sent = int(result.get('sent') or 0)
    failed = 1 if result.get('errors') else 0
    return {**result, 'failed': failed, 'pending': max(0,len(expected)-sent-failed), 'receipts': sender.results}
