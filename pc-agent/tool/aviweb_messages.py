"""Job-scoped CHG/DLA bridge. Never send to live AviWeb during tests.

The supplied sending selectors and addressees stay in aviweb_sender.py.
This wrapper adds validation and row-bound safety checks, not route selectors.
"""
from __future__ import annotations
import re
import time
from datetime import datetime, timezone, timedelta
from aviweb_sender import AviWebSender, AviWebSendError, validate_edited_payload, split_messages, callsign_from_message


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
    """DOF from a Processed date cell. AviWeb shows the flight date with its
    EOBT ("2026-11-26 15:10"); only a trailing clock time is dropped."""
    value = re.sub(r'[ T]+\d{1,2}:\d{2}(?::\d{2})?\s*(?:Z|UTC)?$', '', str(text or '').strip(), flags=re.I)
    for fmt in ('%y%m%d', '%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%d/%m/%y', '%d %b %Y'):
        try:
            return datetime.strptime(value, fmt).strftime('%y%m%d')
        except ValueError:
            pass
    raise AviWebSendError('Không đọc chắc chắn DOF trên dòng Processed — không gửi')


def _row_callsign(text):
    """Callsign cell; AviWeb prefixes an expand icon ("+VJC334")."""
    return re.sub(r'^[^A-Z0-9]+', '', str(text or '').upper().strip()).strip()


def _row_icao(text):
    """Aerodrome cell: "VVPQ" or "VVPQ (Kien giang)" -> VVPQ; anything else ''."""
    hit = re.fullmatch(r'([A-Z]{4})(?:\s*\([^()]*\))?', str(text or '').upper().strip())
    return hit[1] if hit else ''


def delay_clock(eobt):
    """ICAO EOBT "1510" -> "15:10": AviWeb's Delay time box rejects bare digits."""
    hit = re.fullmatch(r'([01]\d|2[0-3])([0-5]\d)', str(eobt or '').strip())
    if not hit:
        raise AviWebSendError('EOBT trong điện DLA không hợp lệ — không gửi')
    return f'{hit[1]}:{hit[2]}'


_MONTHS = {m: i for i, m in enumerate('JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(), 1)}


def shown_callsigns(text):
    """Values printed after each "Aircraft Identification" caption. The Change
    page repeats the caption above an input box (innerText shows no value), so
    the text right after it is the next caption ("SSR Code"): only a token
    holding a digit is a callsign, a caption word never is."""
    ids = set()
    for hit in re.finditer(r'Aircraft\s+Identification\s*:?\s*([^\t\r\n]*)', str(text or '')):
        token = re.match(r'([A-Z0-9]{2,8})(?![A-Za-z0-9])', hit[1].strip())
        if token and re.search(r'\d', token[1]):
            ids.add(token[1])
    return ids


def form_matches(text, wanted):
    """Identity shown on an AviWeb action page (Delay/Change open as their own
    page, so the Processed list is gone). The page must show exactly one
    "DEP - DEST - Mon. DD" banner equal to the confirmed sector and day, and
    the confirmed callsign as Aircraft Identification. None = no banner."""
    cs, dep, arr, dof = wanted
    text = str(text or '')
    heads = set(re.findall(r'(?<![A-Z0-9])([A-Z]{4})\s*-\s*([A-Z]{4})\s*-\s*([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})(?!\d)', text))
    if not heads:
        return None
    if len(heads) != 1:
        return False
    h_dep, h_arr, mon, day = next(iter(heads))
    if (h_dep, h_arr) != (dep, arr) or _MONTHS.get(mon.upper()) != int(dof[2:4]) or int(day) != int(dof[4:6]):
        return False
    ids = shown_callsigns(text)
    if ids:
        return ids == {cs}
    return bool(re.search(r'(?<![A-Z0-9])' + re.escape(cs) + r'(?![A-Z0-9])', text))


# Change opens the full ICAO form: the flight sits in input boxes, which
# innerText never shows. Read each located field's own boxes and the tokens.
FORM_SNAPSHOT_JS = """
var shown=function(e){return !!(e.offsetWidth||e.offsetHeight||e.getClientRects().length)};
var out={fields:[],tokens:[],inputs:[]};
document.querySelectorAll('[location]').forEach(function(el){
  if(!shown(el)) return; var vals=[];
  el.querySelectorAll('input,textarea').forEach(function(i){
    if(i.closest('[location]')===el && shown(i) && i.value) vals.push(String(i.value));});
  out.fields.push([el.getAttribute('location'),vals,vals.length?'':String(el.innerText||'').slice(0,120)]);});
document.querySelectorAll('.tokenComponentTokenEdit').forEach(function(e){
  if(shown(e)) out.tokens.push(String(e.innerText||e.value||''));});
document.querySelectorAll('input,textarea').forEach(function(i){
  if(shown(i) && i.value) out.inputs.push(String(i.value));});
return out;
"""

_F_CALLSIGN = re.compile(r'aircraft_?id|callsign|arcid|acid', re.I)
_F_DEP = re.compile(r'depart|adep', re.I)
_F_ARR = re.compile(r'dest|ades', re.I)
_F_NOT_AERODROME = re.compile(r'alt|time|date|eobt|eet', re.I)


def form_fields_match(snapshot, wanted):
    """Identity of an AviWeb form page read from its boxes (FORM_SNAPSHOT_JS).
    True = callsign, DEP, DEST and day all shown and equal to the confirmed
    flight; False = something shown contradicts it; None = not shown (yet)."""
    cs, dep, arr, dof = wanted
    if not isinstance(snapshot, dict):
        return None
    def clean(v):
        return re.sub(r'\s+', ' ', str(v or '')).strip().upper()
    seen_cs, seen_dep, seen_arr = set(), set(), set()
    for item in snapshot.get('fields') or []:
        try:
            name, vals, text = item
        except (TypeError, ValueError):
            continue
        name = str(name or '')
        values = [clean(v) for v in (vals or [])] or [clean(l) for l in str(text or '').splitlines()[-1:]]
        values = [v for v in values if v]
        if _F_CALLSIGN.search(name):
            seen_cs.update(_row_callsign(v) for v in values)
        elif not _F_NOT_AERODROME.search(name):
            codes = {c for c in (_row_icao(v) for v in values) if c}
            if _F_DEP.search(name):
                seen_dep |= codes
            elif _F_ARR.search(name):
                seen_arr |= codes
    dofs = set()
    for token in snapshot.get('tokens') or []:
        hit = re.fullmatch(r'DOF\s*/\s*(\d{6})', clean(token))
        if hit:
            dofs.add(hit[1])
    inputs = [clean(v) for v in (snapshot.get('inputs') or [])]
    if (seen_cs and seen_cs != {cs}) or (seen_dep and seen_dep != {dep}) or (seen_arr and seen_arr != {arr}) or (dofs and dofs != {dof}):
        return False
    if not dofs:
        # No DOF token: the day must be shown in a date box.
        for value in inputs:
            try:
                dofs.add(_row_dof(value))
            except AviWebSendError:
                pass
        if dof not in dofs:
            return None
    if not seen_cs and cs in inputs:
        seen_cs = {cs}
    if not (seen_dep and seen_arr):
        # Field names unknown: DEP must come before DEST in form order.
        codes = [_row_icao(v) for v in inputs]
        if dep in codes and arr in codes[codes.index(dep) + 1:]:
            seen_dep, seen_arr = seen_dep or {dep}, seen_arr or {arr}
    return True if (seen_cs and seen_dep and seen_arr) else None


def form_summary(snapshot):
    """Short field list for the error line, so a refusal shows what AviWeb showed."""
    if not isinstance(snapshot, dict):
        return ''
    parts = [f"{n}={'|'.join(map(str, v or [])) or str(t or '').strip()[:20]}" for n, v, t in (snapshot.get('fields') or [])
             if isinstance(n, str) and re.search(r'ident|callsign|depart|dest|adep|ades|eobt|date', n, re.I)]
    parts += [str(t) for t in (snapshot.get('tokens') or []) if str(t).upper().startswith('DOF')]
    return '; '.join(parts)[:300]


class VerifiedAviWebSender(AviWebSender):
    """Verify the SAME row immediately before action/Submit; ambiguity blocks writes."""
    def __init__(self, expected, manual_submit=False, **kwargs):
        super().__init__(**kwargs)
        # Operator mode: fill and verify everything, then the human clicks
        # EVERY Submit (Delay step and final send) in the visible Chrome;
        # code never clicks one.
        self.manual_submit = bool(manual_submit)
        self._final_stage = False
        # Change keeps its addressee popup behind the page's own Submit.
        self._page_submit_first = False
        self._step_note = 'ĐÃ ĐIỀN GIỜ MỚI'
        self.expected = {e['callsign']: e for e in expected}
        self.bound = None
        self.bound_snapshot = None
        # Set once the action page of the bound flight was verified: (page, id).
        self.form_token = None
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
        # Vaadin's row-number column has no matching header cell class.
        if len(names) == len(values) - 1 and re.fullmatch(r'\d*', values[0]):
            names = [''] + names
        if len(names) != len(values):
            raise AviWebLayoutError('Bố cục Processed chưa xác minh được — không gửi')
        aliases = ({'CALLSIGN', 'AIRCRAFTID', 'AIRCRAFTIDENTIFICATION', 'ACID', 'ARCID'}, {'DEP', 'DEPARTURE', 'DEPARTUREAERODROME', 'ADEP'}, {'DEST', 'DES', 'DESTINATION', 'DESTINATIONAERODROME', 'ADES', 'ARR'}, {'DOF', 'DATEOFFLIGHT', 'FLIGHTDATE'})
        indices = []
        for allowed in aliases:
            hits = [i for i, name in enumerate(names) if name in allowed]
            if len(hits) != 1:
                raise AviWebLayoutError('Bố cục Processed chưa xác minh được — không gửi')
            indices.append(hits[0])
        cs, dep, arr, dof = (values[i] for i in indices)
        cs, dep, arr = _row_callsign(cs), _row_icao(dep), _row_icao(arr)
        if not re.fullmatch(r'[A-Z0-9]+', cs) or not dep or not arr:
            raise AviWebSendError('Không xác minh được sân đi/đến trên cùng dòng AviWeb')
        return (cs, dep, arr, _row_dof(dof))

    @staticmethod
    def _content_matches(row, wanted):
        """Fallback when headers are unreadable: the row must hold Callsign →
        DEP → DEST in that order, each exactly once, and the cell right after
        DEST must be the first date on the row and equal DOF (AviWeb puts Date
        of Flight there; later Creation/Update dates are ignored). Partial or
        reordered data never matches."""
        cs, dep, arr, dof = wanted
        raw = [_txt(c).upper() for c in row.find_elements('xpath', './td')]
        calls = [_row_callsign(v) for v in raw]
        ports = [_row_icao(v) for v in raw]
        if calls.count(cs) != 1 or ports.count(dep) != 1 or ports.count(arr) != 1 or dep == arr:
            return False
        at = ports.index(arr)
        if not calls.index(cs) < ports.index(dep) < at or at + 1 >= len(raw):
            return False
        dates = []
        for value in raw:
            try:
                dates.append(_row_dof(value))
            except AviWebSendError:
                dates.append('')
        return dates[at + 1] == dof and not any(dates[:at + 1])

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
        if '#!manager-processed' not in str(driver.current_url):
            return self._verify_form(driver, wanted)
        rows = self._candidates(driver, self.current_callsign)
        matches = [r for r in rows if self._row_matches(r, wanted)]
        if len(matches) != 1:
            raise AviWebSendError('Dòng Processed đã đổi hoặc không duy nhất — dừng trước Submit')
        if self.form_token:
            # Back on the list after the verified action page: the list was
            # rebuilt, so the unique matching row is bound again.
            self.bound = matches[0]
            return
        if matches[0].id != self.bound.id:
            raise AviWebSendError('Dòng Processed đã đổi hoặc không duy nhất — dừng trước Submit')
        if not self._row_matches(self.bound, self.bound_snapshot):
            raise AviWebSendError('Danh tính dòng AviWeb đã thay đổi — không Submit')

    @staticmethod
    def _page_token(driver):
        hit = re.search(r'#!([\w-]+)/id=(\d+)', str(driver.current_url))
        return (hit[1], hit[2]) if hit else None

    def _verify_form(self, driver, wanted):
        """Delay/Change replace the Processed list with their own page; the
        flight is then proven by the page banner, not by the hidden list."""
        token = self._page_token(driver)
        seen = form_matches(driver.execute_script('return document.body.innerText'), wanted)
        snapshot = None
        if seen is None:
            # No Delay banner: the Change form keeps the flight in its boxes.
            snapshot = driver.execute_script(FORM_SNAPSHOT_JS)
            seen = form_fields_match(snapshot, wanted)
        if seen is True and (not self.form_token or not token or self.form_token in (token, ('page', ''))):
            self.form_token = token or self.form_token or ('page', '')
            return
        if seen is None and token and token == self.form_token:
            return  # same verified page, banner covered by the next step
        shown = form_summary(snapshot)
        raise AviWebSendError(f'{wanted[0]}: form AviWeb không hiện đúng chuyến/chặng/ngày đã xác nhận — không Submit'
                              + (f' (form đang hiện: {shown})' if shown else ''))

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
        self.form_token = None
        self._safe_click(driver, self.bound)
        self._verify_bound(driver)
        Actions(driver).context_click(self.bound).perform()
        # Keep the uploaded action selector unchanged.
        self._safe_click(driver, Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH,
            f'//td[@class="gwt-MenuItem" and .//div[text()="{action}"]]'))))
        if action == 'Change':
            self._await_change_form(driver, wanted)

    def _await_change_form(self, driver, wanted, timeout=45):
        """Prove the flight on the Change page BEFORE anything is typed, so a
        wrong or half-loaded form stops here instead of after the edits."""
        end = time.time() + timeout
        last = None
        while True:
            if '#!manager-processed' not in str(driver.current_url):
                try:
                    return self._verify_form(driver, wanted)
                except AviWebSendError as exc:
                    last = exc
                    snapshot = driver.execute_script(FORM_SNAPSHOT_JS)
                    if form_fields_match(snapshot, wanted) is False:
                        raise
            if time.time() >= end:
                break
            time.sleep(.5)
        if last:
            raise last
        # Change stayed on the Processed list (popup form): the row check gates Submit.

    def _safe_click(self, driver, element):
        label = element.text.strip()
        if label == 'Submit':
            self._verify_bound(driver)
            # Uploaded token helpers are global. Require one visible form to
            # prevent another window's token inputs from authorizing a write.
            windows = [w for w in driver.find_elements('css selector', '.v-window') if w.is_displayed()]
            if len(windows) > 1 or (not windows and not self.form_token):
                raise AviWebSendError('Không xác định được duy nhất form AviWeb đang gửi')
            if self._final_stage and windows:
                element = self._popup_submit(driver, windows[0], element)
            if self._emit_callback:
                self._note(f'{self.current_callsign}: đã kiểm tra đúng DOF/chặng trước Submit')
            if self.manual_submit:
                return self._wait_operator_submit(driver, element, final=self._final_stage)
            # One click only: a native click that threw may already have submitted.
            element.click()
            return
        return super()._safe_click(driver, element)

    _SUBMIT_XPATH = './/div[@role="button" and contains(@class,"v-button") and not(contains(@class,"v-disabled"))]//span[text()="Submit"]'

    def _popup_submit(self, driver, window, element):
        """The page under the addressee popup has a Submit of its own; the
        final click must be the popup's single Submit, never the page's."""
        if driver.execute_script('return arguments[0].contains(arguments[1]);', window, element):
            return element
        inside = [b for b in window.find_elements('xpath', self._SUBMIT_XPATH) if b.is_displayed()]
        if len(inside) != 1:
            raise AviWebSendError('Không xác định được duy nhất nút Submit trong khung địa chỉ AviWeb — không gửi')
        return inside[0]

    def _wait_operator_submit(self, driver, element, final=True):
        """Hand the verified form to the operator. Only a real click/Enter on
        this Submit button followed by the form closing counts as sent; closing
        the form any other way, Chrome closing or a timeout means not sent.
        An intermediate Submit (Delay step) resumes on the operator's click;
        the next step then proves AviWeb accepted it or fails closed."""
        driver.execute_script('''
          const b=arguments[0].closest('.v-button')||arguments[0]; window.__aviOperatorSubmit=0;
          const mark=()=>{window.__aviOperatorSubmit=Date.now();};
          b.addEventListener('click',mark,true);
          b.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')mark();},true);
        ''', element)
        try:
            driver.switch_to.window(driver.current_window_handle)
        except Exception:
            pass
        step = 'ĐÃ ĐIỀN ĐỊA CHỈ NHẬN (bước 2/2)' if final else f'{self._step_note} (bước 1/2)'
        self._note(f'{self.current_callsign}: {step} — kiểm tra trên Chrome rồi tự bấm Submit (chờ tối đa {MANUAL_SUBMIT_WAIT_S // 60} phút)', 'ok')
        deadline = time.monotonic() + MANUAL_SUBMIT_WAIT_S
        clicked = False
        while time.monotonic() < deadline:
            try:
                clicked = bool(driver.execute_script('return window.__aviOperatorSubmit||0')) or clicked
                if '/login' in str(driver.current_url):
                    raise AviWebSendError('AviWeb mất đăng nhập khi chờ bấm Submit — chưa xác nhận gửi')
                element.is_enabled()
                if clicked and not final:
                    self._note(f'{self.current_callsign}: đã nhận Submit bước 1 — tiếp tục nhập địa chỉ nhận')
                    return 'operator Submit'
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

    _DELAY_XPATH = '//div[@location="timeComponent"]//input[@type="text"]'

    def _delay_fields(self, driver, callsign):
        """The Delay row holds a clock box and a date box side by side. Return
        the single clock box and the values of every other text box, so the
        date is never typed into and any side effect is caught."""
        def value(box):
            return str(box.get_attribute('value') or '').strip()

        def is_date(box):
            return 'datefield' in str(box.get_attribute('class') or '').lower() or bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}.*', value(box)))

        boxes = [b for b in driver.find_elements('xpath', self._DELAY_XPATH) if b.is_displayed()]
        clocks = [b for b in boxes if not is_date(b) and re.fullmatch(r'(?:\d{1,2}:?\d{2})?', value(b))]
        if len(clocks) != 1:
            raise AviWebSendError(f'{callsign}: không xác định được duy nhất ô giờ Delay — không gửi')
        others = sorted(value(b) for b in driver.find_elements('css selector', 'input[type="text"]')
                        if b.is_displayed() and b.id != clocks[0].id)
        return clocks[0], others

    def _send_dla(self, driver, message):
        """Same selectors as the supplied sender; only the time is typed as
        HH:MM and read back before any Submit."""
        _, _, _, By, Keys, EC, Wait = self._selenium()
        callsign = callsign_from_message(message)
        match = re.match(r'\(DLA-[^-]+-[A-Z]{4}(\d{4})-', message.strip(), re.I)
        if not callsign or not match:
            raise AviWebSendError('Không đọc được callsign/EOBT từ điện văn DLA')
        clock = delay_clock(match[1])
        self._open_row_action(driver, callsign, 'Delay')
        Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH, self._DELAY_XPATH)))
        self._verify_bound(driver)
        field, others = self._delay_fields(driver, callsign)
        was_red = 'error' in str(field.get_attribute('class') or '').lower()
        # No TAB: it moves the cursor into the date box next to the time box.
        self._type_input(driver, field, clock)
        driver.execute_script('arguments[0].blur();', field)
        time.sleep(.6)
        field, after = self._delay_fields(driver, callsign)
        if after != others:
            raise AviWebSendError(f'{callsign}: ô ngày/ô khác trên form Delay bị thay đổi — không Submit')
        shown = re.sub(r'\D', '', str(field.get_attribute('value') or ''))
        if shown != match[1]:
            raise AviWebSendError(f'{callsign}: ô giờ Delay hiện "{shown}" khác EOBT {match[1]} — không Submit')
        if 'error' in str(field.get_attribute('class') or '').lower() and not was_red:
            if not self.manual_submit:
                raise AviWebSendError(f'{callsign}: AviWeb không nhận giờ Delay {clock} — không Submit')
            self._note(f'{callsign}: AviWeb đang báo đỏ ô giờ {clock} — sửa trên Chrome trước khi bấm Submit', 'warn')
        self._note(f'DLA {callsign}: đã nhập giờ mới {clock}')
        self._safe_click(driver, Wait(driver, 30).until(EC.element_to_be_clickable((By.XPATH,
            '//div[@role="button" and contains(@class,"v-button")]//span[text()="Submit"]'))))
        try:
            self._safe_click(driver, Wait(driver, 4).until(EC.element_to_be_clickable((By.XPATH, '//div[@role="button"]//span[text()="Yes"]'))))
        except Exception:
            pass
        return self._addresses_and_submit(driver)

    def _send_chg(self, driver, message):
        """Supplied field edits unchanged; AviWeb's Change page then needs its
        own Submit before the addressee popup exists (two Submits, like Delay)."""
        self._page_submit_first = True
        self._step_note = 'ĐÃ SỬA XONG FORM CHANGE'
        try:
            return super()._send_chg(driver, message)
        finally:
            self._page_submit_first = False
            self._step_note = 'ĐÃ ĐIỀN GIỜ MỚI'

    _ADDRESSEES_XPATH = '//div[@location="addresseesField"]'

    def _page_submit(self, driver):
        """Step 1 on the Change page: its single visible Submit opens the popup."""
        cs = self.current_callsign
        def shown(xpath):
            return [e for e in driver.find_elements('xpath', xpath) if e.is_displayed()]
        if not shown(self._ADDRESSEES_XPATH):
            buttons = shown(self._SUBMIT_XPATH[1:])
            if len(buttons) != 1:
                raise AviWebSendError(f'{cs}: không xác định được duy nhất nút Submit trên form Change — không gửi')
            self._note(f'CHG {cs}: Submit form Change (bước 1/2) để mở khung địa chỉ nhận')
            self._safe_click(driver, buttons[0])
        # The operator may fix a red box and press Submit again in manual mode.
        end = time.monotonic() + (180 if self.manual_submit else 60)
        while not shown(self._ADDRESSEES_XPATH):
            for yes in shown('//div[@role="button"]//span[text()="Yes"]')[:1]:
                AviWebSender._safe_click(driver, yes)
            if '/login' in str(driver.current_url):
                raise AviWebSendError(f'{cs}: AviWeb mất đăng nhập sau Submit bước 1 — chưa gửi')
            if time.monotonic() >= end:
                raise AviWebSendError(f'{cs}: AviWeb chưa mở khung địa chỉ nhận sau Submit bước 1 (kiểm tra ô báo đỏ trên form Change) — chưa gửi')
            time.sleep(.5)
        self._note(f'CHG {cs}: khung địa chỉ nhận đã mở — nhập VVTSVJCX, KHOUXAAF')

    def _addresses_and_submit(self, driver):
        if self._page_submit_first:
            self._page_submit(driver)
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
