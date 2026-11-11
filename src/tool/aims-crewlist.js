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
    + '<button type="button" class="aims-go">⬇ Tải & nạp vào So sánh</button><div class="aims-msg" aria-live="polite"></div>';
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
      if(typeof uploadExcel !== 'function') throw new Error('Không tìm thấy chức năng nạp Crewlist trên trang');
      await uploadExcel(file);
      say('✓ Đã nạp ' + name);
      setTimeout(() => { if(!go.disabled) box.hidden = true; }, 1500);
    }catch(err){
      say((err && err.message) || String(err), true);
    }finally{
      clearInterval(tick);
      go.disabled = false; pick.disabled = false;
    }
  };
})();
