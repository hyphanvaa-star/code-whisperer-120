(function(){
  const pick = document.getElementById('btnAims');
  if(!pick) return;
  const pad = n => String(n).padStart(2, '0');
  const vnDay = add => { const d = new Date(Date.now() + 7 * 3600e3 + (add || 0) * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  const box = document.createElement('div');
  box.className = 'aims-pop'; box.hidden = true;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Tải Crewlist từ AIMS');
  box.innerHTML = '<div class="aims-hd"><b>Tải Crewlist từ AIMS</b><button type="button" class="aims-x" aria-label="Đóng">✕</button></div>'
    + '<p class="aims-hint">Lấy báo cáo Daily Flight Schedule (1.2.1) bằng tài khoản AIMS đã lưu trong 🔑 Tài khoản, giữ nguyên các cột bạn đã chọn trên AIMS.</p>'
    + '<div class="aims-row"><label>Từ ngày<input type="date" class="aims-from"></label><label>Đến ngày<input type="date" class="aims-to"></label></div>'
    + '<div class="aims-row"><label>Từ giờ<input type="time" step="60" class="aims-tfrom"></label><label>Đến giờ<input type="time" step="60" class="aims-tto"></label></div>'
    + '<button type="button" class="aims-go">⬇ Tải & nạp vào So sánh</button><div class="aims-msg" aria-live="polite"></div>'
    + '<div class="aims-watch"><div class="aims-wrow"><label class="aims-sw"><input type="checkbox" class="aims-auto"> 🔔 Tự động quét AIMS</label>'
    + '<label class="aims-ev">mỗi <select class="aims-every"><option value="5">5</option><option value="10">10</option><option value="15">15</option><option value="30">30</option></select> phút</label></div>'
    + '<p class="aims-hint">Khi bật, web tự lấy AIMS theo chu kỳ (ngày khai thác hiện tại, theo giờ bên trên), so với Crewlist đang dùng; thấy đổi tàu / crew / giờ là rung chuông, báo chuyến và tự nạp bản mới. Cần mở ít nhất một tab web.</p>'
    + '<div class="aims-wst" aria-live="polite"></div><div class="aims-log"></div></div>';
  document.body.appendChild(box);
  const tFrom = box.querySelector('.aims-tfrom'), tTo = box.querySelector('.aims-tto');
  const TKEY = 'aims.timeRange';
  function loadTimes(){
    let t = null; try{ t = JSON.parse(localStorage.getItem(TKEY) || 'null'); }catch(_){}
    const ok = v => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);
    tFrom.value = t && ok(t.from) ? t.from : '04:55';
    tTo.value = t && ok(t.to) ? t.to : '04:55';
  }
  function saveTimes(){ try{ localStorage.setItem(TKEY, JSON.stringify({from: tFrom.value, to: tTo.value})); }catch(_){} }
  tFrom.addEventListener('change', saveTimes); tTo.addEventListener('change', saveTimes);
  const from = box.querySelector('.aims-from'), to = box.querySelector('.aims-to'), go = box.querySelector('.aims-go'), msg = box.querySelector('.aims-msg');
  function place(){
    const r = pick.getBoundingClientRect();
    box.style.top = Math.round(r.bottom + 8) + 'px';
    box.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - 348, r.right - 340))) + 'px';
  }
  function open(){
    if(!from.value) from.value = vnDay(0);
    if(!to.value) to.value = vnDay(1);
    if(!tFrom.value || !tTo.value) loadTimes();
    box.hidden = false; place();
  }
  pick.addEventListener('click', e => { e.stopPropagation(); box.hidden ? open() : (box.hidden = true); });
  box.querySelector('.aims-x').onclick = () => { box.hidden = true; };
  box.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => { if(!go.disabled) box.hidden = true; });
  window.addEventListener('resize', () => { if(!box.hidden) place(); });
  function say(t, bad){ msg.textContent = t; msg.className = 'aims-msg' + (bad ? ' bad' : ''); }
  const curXls = () => { try{ return typeof xls !== 'undefined' ? xls : null; }catch(_){ return null; } };
  async function loadFile(file){
    if(typeof uploadExcel !== 'function') throw new Error('Không tìm thấy chức năng nạp Crewlist trên trang');
    const before = curXls();
    await uploadExcel(file);
    const after = curXls();
    return !!after && after !== before;
  }
  go.onclick = async () => {
    if(!from.value || !to.value){ say('Chọn đủ hai ngày.', true); return; }
    if(from.value > to.value){ say('Ngày bắt đầu phải trước ngày kết thúc.', true); return; }
    if(!/^\d{2}:\d{2}$/.test(tFrom.value) || !/^\d{2}:\d{2}$/.test(tTo.value)){ say('Chọn đủ giờ bắt đầu và kết thúc.', true); return; }
    saveTimes();
    go.disabled = true; pick.disabled = true;
    const t0 = Date.now();
    const tick = setInterval(() => say('Đang lấy từ AIMS… ' + Math.round((Date.now() - t0) / 1000) + 's'), 1000);
    say('Đang lấy từ AIMS…');
    try{
      const r = await fetch('/api/aims/crewlist', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({start: from.value, end: to.value, fromTime: tFrom.value, toTime: tTo.value})});
      const ct = r.headers.get('content-type') || '';
      if(ct.indexOf('json') >= 0){ const d = await r.json(); throw new Error((d && d.error) || ('HTTP ' + r.status)); }
      if(!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      let name = 'AIMS.xlsx';
      try{ name = decodeURIComponent(r.headers.get('x-filename') || name); }catch(_){}
      clearInterval(tick);
      say('Đã tải ' + Math.round(blob.size / 1024) + ' KB — đang nạp ' + name + '…');
      const file = new File([blob], name, {type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      if(!(await loadFile(file))) throw new Error('Không nạp được file vào So sánh');
      say('✓ Đã nạp ' + name);
      setTimeout(() => { if(!go.disabled) box.hidden = true; }, 1500);
    }catch(err){
      say((err && err.message) || String(err), true);
    }finally{
      clearInterval(tick);
      go.disabled = false; pick.disabled = false;
    }
  };

  // ---- Tự động quét AIMS + chuông ----
  const auto = box.querySelector('.aims-auto'), every = box.querySelector('.aims-every');
  const wst = box.querySelector('.aims-wst'), logBox = box.querySelector('.aims-log');
  const K = {cfg: 'aims.watch', lock: 'aims.watch.lock', last: 'aims.watch.last', log: 'aims.watch.log', unread: 'aims.watch.unread', ev: 'aims.watch.event', st: 'aims.watch.status'};
  const me = Math.random().toString(36).slice(2);
  const rd = (k, d) => { try{ const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; }catch(_){ return d; } };
  const wr = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} };
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const hhmm = iso => { const d = new Date(new Date(iso).getTime() + 7 * 3600e3); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };
  const KIND = {reg: ['TÀU', 'reg'], crew: ['CREW', 'crew'], time: ['GIỜ', 'time'], added: ['MỚI', 'add'], removed: ['BỎ', 'rem']};

  pick.style.position = 'relative';
  const bell = document.createElement('span');
  bell.className = 'aims-bell'; bell.setAttribute('aria-hidden', 'true');
  bell.innerHTML = '🔔<i class="aims-cnt"></i>';
  pick.appendChild(bell);
  const cnt = bell.querySelector('.aims-cnt');

  function cfg(){ const c = rd(K.cfg, {}); return {on: !!c.on, every: [5, 10, 15, 30].indexOf(+c.every) >= 0 ? +c.every : 10}; }
  function range(){
    const ft = /^\d{2}:\d{2}$/.test(tFrom.value) ? tFrom.value : '04:55';
    const vn = new Date(Date.now() + 7 * 3600e3);
    const [h, m] = ft.split(':').map(Number);
    const startMs = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - (vn.getUTCHours() * 60 + vn.getUTCMinutes() < h * 60 + m ? 864e5 : 0);
    const iso = ms => new Date(ms).toISOString().slice(0, 10);
    return {start: iso(startMs), end: iso(startMs + 864e5), fromTime: ft, toTime: /^\d{2}:\d{2}$/.test(tTo.value) ? tTo.value : ft};
  }
  function paintBell(ring){
    const c = cfg(), n = +rd(K.unread, 0) || 0;
    bell.classList.toggle('on', c.on);
    bell.style.display = c.on || n ? '' : 'none';
    cnt.textContent = n ? (n > 99 ? '99+' : String(n)) : '';
    cnt.style.display = n ? '' : 'none';
    pick.title = (n ? '🔔 AIMS có ' + n + ' thay đổi chưa xem. ' : '') + (c.on ? 'Đang tự quét AIMS mỗi ' + c.every + ' phút. ' : '') + 'Bấm để tải Crewlist từ AIMS.';
    if(ring){ bell.classList.remove('ring'); void bell.offsetWidth; bell.classList.add('ring'); }
  }
  function paintStatus(){
    const st = rd(K.st, null), c = cfg(), r = range();
    let t = c.on ? 'Đang theo dõi ' + r.start.slice(8, 10) + '/' + r.start.slice(5, 7) + ' ' + r.fromTime + ' → ' + r.end.slice(8, 10) + '/' + r.end.slice(5, 7) + ' ' + r.toTime + '.' : 'Đang tắt.';
    if(st && st.at) t += ' Lần quét cuối ' + hhmm(st.at) + ': ' + st.text;
    wst.textContent = t;
    wst.className = 'aims-wst' + (st && st.bad ? ' bad' : '');
  }
  function paintLog(){
    const log = rd(K.log, []);
    if(!log.length){ logBox.innerHTML = ''; return; }
    logBox.innerHTML = '<div class="aims-lh"><b>Thay đổi AIMS đã phát hiện</b><button type="button" class="aims-clr">Xoá</button></div>' + log.map(e =>
      '<div class="aims-le"><div class="aims-lt">' + hhmm(e.at) + ' · ' + e.changes.length + ' chuyến' + (e.loaded ? ' · đã nạp ' + esc(e.file) : '') + '</div>'
      + e.changes.slice(0, 40).map(x => '<div class="aims-li">' + (x.kinds || []).map(k => '<span class="aims-k ' + (KIND[k] || ['', ''])[1] + '">' + (KIND[k] || [k])[0] + '</span>').join('')
        + '<b>' + esc(x.flt) + '</b> ' + esc(x.route) + (x.day ? ' <span class="aims-d">' + esc(x.day) + '</span>' : '') + '<div class="aims-tx">' + esc(x.text) + '</div></div>').join('')
      + (e.changes.length > 40 ? '<div class="aims-tx">… và ' + (e.changes.length - 40) + ' chuyến khác</div>' : '') + '</div>').join('');
    logBox.querySelector('.aims-clr').onclick = () => { wr(K.log, []); wr(K.unread, 0); paintLog(); paintBell(); };
  }
  let actx = null;
  function chime(){
    try{
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if(actx.state === 'suspended') actx.resume();
      [880, 1175, 880, 1175].forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.22;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.21);
      });
    }catch(_){}
  }
  let toast = null;
  function showToast(e){
    if(!toast){
      toast = document.createElement('div'); toast.className = 'aims-toast'; toast.setAttribute('role', 'alert');
      document.body.appendChild(toast);
    }
    toast.innerHTML = '<div class="aims-th">🔔 AIMS vừa thay đổi ' + e.changes.length + ' chuyến<button type="button" aria-label="Đóng">✕</button></div>'
      + e.changes.slice(0, 6).map(x => '<div class="aims-ti"><b>' + esc(x.flt) + '</b> ' + esc(x.route) + ' ' + esc(x.day) + ' — ' + esc(x.text) + '</div>').join('')
      + (e.changes.length > 6 ? '<div class="aims-ti">… và ' + (e.changes.length - 6) + ' chuyến khác</div>' : '')
      + '<div class="aims-tf">' + (e.loaded ? '✓ Đã nạp bản AIMS mới vào So sánh' : 'Bấm để xem') + '</div>';
    toast.hidden = false;
    toast.querySelector('button').onclick = ev => { ev.stopPropagation(); toast.hidden = true; };
    toast.onclick = ev => { ev.stopPropagation(); toast.hidden = true; open(); wr(K.unread, 0); paintBell(); };
  }
  function notify(e, ring){
    if(ring){ chime(); showToast(e); }
    paintBell(ring); paintLog(); paintStatus();
    if(ring && document.hidden && window.Notification && Notification.permission === 'granted'){
      try{ new Notification('🔔 AIMS thay đổi ' + e.changes.length + ' chuyến', {body: e.changes.slice(0, 4).map(x => x.flt + ' ' + x.route + ': ' + x.text).join('\n'), tag: 'aims-watch'}); }catch(_){}
    }
  }
  function b64File(b64, name){
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new File([u], name, {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  let busy = false;
  async function check(){
    if(busy || go.disabled) return;
    busy = true; wr(K.last, Date.now());
    wst.textContent = 'Đang quét AIMS…';
    try{
      const r = await fetch('/api/aims/watch', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(range())});
      const d = await r.json().catch(() => ({error: 'HTTP ' + r.status}));
      if(!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
      const changes = d.changes || [];
      let loaded = false;
      if(d.file_b64){ try{ loaded = await loadFile(b64File(d.file_b64, d.filename || 'AIMS.xlsx')); }catch(_){} }
      if(changes.length){
        const e = {at: d.checked_at || new Date().toISOString(), changes, file: d.filename, loaded};
        wr(K.log, [e].concat(rd(K.log, [])).slice(0, 20));
        wr(K.unread, (+rd(K.unread, 0) || 0) + changes.length);
        wr(K.st, {at: e.at, text: '⚠ ' + changes.length + ' chuyến thay đổi' + (loaded ? ', đã nạp bản mới.' : '.'), bad: false});
        wr(K.ev, {id: me + Date.now(), at: e.at});
        notify(e, true);
      }else{
        wr(K.st, {at: d.checked_at || new Date().toISOString(), text: d.first ? (loaded ? 'đã nạp bản AIMS mới làm mốc so sánh.' : 'chưa có Crewlist để so.') : 'không có thay đổi.'});
        paintStatus();
      }
    }catch(err){
      wr(K.st, {at: new Date().toISOString(), text: '✕ ' + ((err && err.message) || String(err)), bad: true});
      paintStatus();
    }finally{ busy = false; }
  }
  function leader(){
    const c = cfg(), l = rd(K.lock, null), now = Date.now();
    if(!l || l.id === me || now - l.at > 90e3){ wr(K.lock, {id: me, at: now}); return true; }
    return false;
  }
  function tick(){
    const c = cfg();
    if(!c.on) return;
    if(!leader()) return;
    if(Date.now() - (+rd(K.last, 0) || 0) >= c.every * 60e3) check();
  }
  function setCfg(on){
    wr(K.cfg, {on, every: +every.value || 10});
    if(on){
      try{ actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); }catch(_){}
      if(window.Notification && Notification.permission === 'default'){ try{ Notification.requestPermission(); }catch(_){} }
      wr(K.last, 0); wr(K.lock, {id: me, at: Date.now()}); check();
    }
    paintBell(); paintStatus();
  }
  auto.onchange = () => setCfg(auto.checked);
  every.onchange = () => { const c = cfg(); wr(K.cfg, {on: c.on, every: +every.value || 10}); paintBell(); paintStatus(); };
  window.addEventListener('storage', ev => {
    if(ev.key === K.ev){ const log = rd(K.log, []); if(log[0]) notify(log[0], true); }
    else if(ev.key === K.unread || ev.key === K.log || ev.key === K.cfg){ const c = cfg(); auto.checked = c.on; every.value = String(c.every); paintBell(); paintLog(); paintStatus(); }
    else if(ev.key === K.st) paintStatus();
  });
  window.addEventListener('beforeunload', () => { const l = rd(K.lock, null); if(l && l.id === me) try{ localStorage.removeItem(K.lock); }catch(_){} });
  pick.addEventListener('click', () => { if(!box.hidden){ wr(K.unread, 0); paintBell(); paintLog(); paintStatus(); } });
  (function init(){ const c = cfg(); auto.checked = c.on; every.value = String(c.every); loadTimes(); paintBell(); paintLog(); paintStatus(); setInterval(tick, 30e3); setTimeout(tick, 5e3); })();
})();
