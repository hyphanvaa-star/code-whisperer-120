"""Job-scoped CHG/DLA bridge. Never send to live AviWeb during tests.

The supplied sending selectors and addressees stay in aviweb_sender.py.
This wrapper adds validation and row-bound safety checks, not route selectors.
"""
from __future__ import annotations
import re
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
    def __init__(self, expected, **kwargs):
        super().__init__(**kwargs)
        self.expected = {e['callsign']: e for e in expected}
        self.bound = None
        self.bound_snapshot = None
        self.current_callsign = ''
        self.final_submitted = False
        self.results = []

    @staticmethod
    def _row_identity(row):
        cells = row.find_elements('xpath', './td')
        values = [c.text.strip().upper() for c in cells]
        # Read actual header labels instead of guessing UIDL-to-DOM td offsets.
        headers = row.find_elements('xpath', 'ancestor::*[contains(concat(" ", normalize-space(@class), " "), " v-table ")][1]//th')
        names = [re.sub(r'[^A-Z0-9]', '', h.text.upper()) for h in headers]
        aliases = ({'CALLSIGN', 'AIRCRAFTIDENTIFICATION', 'ACID'}, {'DEP', 'DEPARTURE', 'DEPARTUREAERODROME', 'ADEP'}, {'DEST', 'DESTINATION', 'DESTINATIONAERODROME', 'ADES'}, {'DOF', 'DATEOFFLIGHT', 'FLIGHTDATE'})
        indices = []
        for allowed in aliases:
            hits = [i for i, name in enumerate(names) if name in allowed]
            if len(hits) != 1 or hits[0] >= len(values):
                raise AviWebSendError('Bố cục Processed chưa xác minh được — không gửi')
            indices.append(hits[0])
        cs, dep, arr, dof = (values[i] for i in indices)
        if not re.fullmatch(r'[A-Z0-9]+', cs) or not re.fullmatch(r'[A-Z]{4}', dep) or not re.fullmatch(r'[A-Z]{4}', arr):
            raise AviWebSendError('Không xác minh được sân đi/đến trên cùng dòng AviWeb')
        return (cs, dep, arr, _row_dof(dof))

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
        matches = [r for r in rows if self._row_identity(r) == wanted]
        if len(matches) != 1 or matches[0].id != self.bound.id:
            raise AviWebSendError('Dòng Processed đã đổi hoặc không duy nhất — dừng trước Submit')
        if self._row_identity(self.bound) != self.bound_snapshot:
            raise AviWebSendError('Danh tính dòng AviWeb đã thay đổi — không Submit')

    def _open_row_action(self, driver, callsign, action):
        _, _, Actions, By, _, EC, Wait = self._selenium()
        if action not in {'Delay', 'Change'} or callsign not in self.expected:
            raise AviWebSendError('Thao tác hoặc callsign không thuộc bản xác nhận')
        driver.get(self.PROCESSED)
        Wait(driver, 180).until(EC.presence_of_element_located((By.XPATH,
            f'//div[contains(@class,"v-table-cell-wrapper") and normalize-space(text())="{callsign}"]')))
        target = self.expected[callsign]
        wanted = (target['callsign'], target['dep'], target['arr'], target['dof'])
        rows = self._candidates(driver, callsign)
        matches = [r for r in rows if self._row_identity(r) == wanted]
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
            # One click only: a native click that threw may already have submitted.
            element.click()
            return
        return super()._safe_click(driver, element)

    def _addresses_and_submit(self, driver):
        self._verify_bound(driver)
        baseline = set(n.text.strip() for n in driver.find_elements('css selector', '.v-Notification, .v-notification, [class*="notification"]') if n.is_displayed())
        evidence = super()._addresses_and_submit(driver)
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
    sender = VerifiedAviWebSender(expected, headless=bool(payload.get('headless', True)))
    try:
        result = sender.send(operation, content, username, password, emit, cancel)
    except Exception:
        return {'sent': len(sender.results), 'total': len(expected), 'failed': 1,
                'pending': max(0,len(expected)-len(sender.results)-1), 'receipts': sender.results,
                'errors': ['Tác vụ dừng hoặc mất kết nối; kiểm tra AviWeb trước khi quyết định gửi lại.']}
    sent = int(result.get('sent') or 0)
    failed = 1 if result.get('errors') else 0
    return {**result, 'failed': failed, 'pending': max(0,len(expected)-sent-failed), 'receipts': sender.results}
