/* CHG/DLA-only editor. The exact validated content is sent; FPL exports remain independent. */
(function () {
  const core = window.__aviwebTools;
  if (!core) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'aviwebEditor'; dialog.className = 'avi-editor';
  dialog.setAttribute('aria-labelledby', 'aviTitle');
  dialog.innerHTML = '<header><div><span class="avi-kicker">AVIWEB · ATC</span><h2 id="aviTitle">Điện văn AviWeb</h2></div><button class="btn" type="button" aria-label="Đóng bảng AviWeb" title="Đóng">✕</button></header><div class="avi-layout"><nav aria-label="Chuyến đã chọn" id="aviFlights"></nav><section class="avi-main"><div id="aviSource" class="avi-source"></div><div id="aviFields" class="avi-fields"></div><div class="avi-tokens" id="aviTokens"></div><div class="avi-preview-head"><h3 id="aviPreviewTitle">Điện văn</h3><span id="aviStep"></span></div><pre id="aviPreview" aria-labelledby="aviPreviewTitle"></pre><div id="aviError" role="alert"></div><div id="aviStatus" role="status" aria-live="polite"></div><pre id="aviLog"></pre></section></div><footer><div class="avi-actions"><button class="btn" type="button" id="aviCopy" title="Copy điện văn">⧉ Copy</button><button class="btn" type="button" id="aviExport" title="Xuất tất cả điện đã chọn">↓ Xuất TXT</button><button class="btn" type="button" id="aviCheckStatus" title="Đọc lại trạng thái lệnh">↻ Trạng thái</button></div><div class="avi-actions"><label class="avi-manual" title="Mở Chrome thật: Trợ lý PC điền và kiểm tra xong thì dừng, anh tự bấm Submit trên AviWeb"><input type="checkbox" id="aviManual"><span>Hiện Chrome · tôi tự bấm Submit</span></label><button class="btn" type="button" id="aviReview">Xem lại</button><button class="btn" type="button" id="aviBack" hidden>← Chỉnh sửa</button><button class="btn primary" type="button" id="aviConfirm" hidden>Xác nhận gửi AviWeb</button></div></footer>';
  document.body.appendChild(dialog);
  const el = id => dialog.querySelector('#' + id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let plan = null, messages = [], index = 0, reviewed = false, submitting = false, job = false, timer = null, owner = '', activeOp = '', loading = false;
  function fitDialog() {
    const zoom = (parseFloat(document.documentElement.style.zoom) || 1) * (parseFloat(document.body.style.zoom) || 1);
    dialog.style.zoom = zoom > 0.05 ? String(1 / zoom) : '';
  }
  window.addEventListener('resize', fitDialog);
  const uid = () => typeof ftKeepUid === 'function' ? ftKeepUid() : (window.parent.__fbUserId ? window.parent.__fbUserId() : '');
  function close() { dialog.close(); }
  const manualKey = () => 'avi_manual_submit:' + (uid() || '');
  function syncManual() {
    try { el('aviManual').checked = localStorage.getItem(manualKey()) === '1'; } catch (_) { el('aviManual').checked = false; }
    manualLabel();
  }
  function manualLabel() { el('aviConfirm').textContent = el('aviManual').checked ? 'Mở Chrome · tôi bấm Submit' : 'Xác nhận gửi AviWeb'; }
  el('aviManual').onchange = () => { try { localStorage.setItem(manualKey(), el('aviManual').checked ? '1' : '0'); } catch (_) {} manualLabel(); };
  dialog.querySelector('header button').onclick = close;
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) e.stopPropagation(); });
  function error(e) { el('aviError').textContent = e instanceof Error ? e.message : String(e || ''); }
  async function request(path, body) {
    if (!owner || owner !== uid()) throw new Error('Tài khoản đã đổi; mở lại bảng.');
    const r = await fetch(path, body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {});
    const d = await r.json();
    if (!r.ok || d.error) throw new Error(d.error || 'Không kết nối được hệ thống.');
    if (owner !== uid()) throw new Error('Tài khoản đã đổi; không dùng kết quả cũ.');
    return d;
  }
  function content() {
    if (!plan) throw new Error('Chưa có bản soạn.');
    return core.validateBatch(plan.operation, messages.map(m => core.serialize(m)).join('\r\n\r\n'), plan.flights).content;
  }
  function controls() {
    const locked = loading || submitting || job;
    el('aviReview').hidden = reviewed || job;
    el('aviBack').hidden = !reviewed || job;
    el('aviConfirm').hidden = !reviewed || job;
    el('aviConfirm').disabled = locked;
    el('aviReview').disabled = locked || !plan;
    el('aviBack').disabled = locked;
    el('aviManual').disabled = locked;
    el('aviCopy').disabled = !plan;
    el('aviExport').disabled = !plan;
    el('aviCheckStatus').disabled = !plan || loading || submitting;
    dialog.querySelectorAll('#aviFields input,#aviTokens input,#aviTokens button,#aviFields select').forEach(i => { i.disabled = reviewed || locked || i.dataset.locked === '1'; });
    el('aviStep').textContent = job ? 'Kết quả gửi' : reviewed ? 'Xác nhận · ' + messages.length + ' điện' : 'Chỉnh điện · ' + messages.length + ' chuyến';
    dialog.classList.toggle('avi-review', reviewed || job);
  }
  function preview() {
    try {
      const text = reviewed ? content() : core.serialize(messages[index]);
      el('aviPreview').textContent = text; error('');
    } catch (e) { el('aviPreview').textContent = ''; error(e); }
    controls();
  }
  function renderFlights() {
    el('aviFlights').innerHTML = messages.map((m, i) => '<button class="btn avi-flight' + (i === index ? ' on' : '') + '" type="button" data-index="' + i + '"><strong>' + esc(m.callsign) + '</strong><span>' + esc(m.dep + ' → ' + m.arr) + '</span><small>DOF ' + esc(m.dof) + '</small></button>').join('');
    el('aviFlights').querySelectorAll('button').forEach(b => { b.onclick = () => { index = Number(b.dataset.index); render(); }; });
  }
  function renderTokens() {
    const m = messages[index];
    const host = el('aviTokens');
    if (!m || m.kind !== 'CHG') { host.innerHTML = ''; return; }
    host.innerHTML = '<div class="avi-token-head"><h3>Field 18</h3><button class="btn" type="button" id="aviAddToken" title="Thêm token" aria-label="Thêm token field 18">＋</button></div>' + m.tokens.map((t,i) => '<div class="avi-token-row"><input aria-label="Mã token ' + (i+1) + '" data-token="' + i + '" data-part="code" maxlength="8" value="' + esc(t.code) + '"' + (t.code === 'DOF' ? ' data-locked="1" disabled' : '') + '><span>/</span><input aria-label="Giá trị ' + esc(t.code || 'token ' + (i+1)) + '" data-token="' + i + '" data-part="value" maxlength="1500" value="' + esc(t.value) + '"' + (t.code === 'DOF' ? ' data-locked="1" disabled' : '') + '><button class="btn" type="button" aria-label="Xóa token ' + esc(t.code || i+1) + '" title="Xóa token" data-remove="' + i + '"' + (t.code === 'DOF' ? ' data-locked="1" disabled' : '') + '>×</button></div>').join('');
    host.querySelectorAll('input').forEach(i => { i.oninput = () => { const t = m.tokens[Number(i.dataset.token)]; if (t && i.dataset.locked !== '1') { t[i.dataset.part] = i.value.toUpperCase(); i.value = t[i.dataset.part]; preview(); } }; });
    host.querySelectorAll('[data-remove]').forEach(b => { b.onclick = () => { if (reviewed || job || m.tokens[Number(b.dataset.remove)]?.code === 'DOF') return; m.tokens.splice(Number(b.dataset.remove),1); renderTokens(); preview(); }; });
    el('aviAddToken').onclick = () => { if (reviewed || job) return; m.tokens.push({code:'',value:''}); renderTokens(); preview(); host.querySelectorAll('input[data-part="code"]').item(m.tokens.length - 1)?.focus(); };
  }
  function render() {
    if (!plan || !messages[index]) return;
    const m = messages[index], s = plan.flights.find(s => s.callsign === m.callsign);
    el('aviTitle').textContent = m.kind + ' AviWeb';
    renderFlights();
    el('aviSource').innerHTML = '<div><strong>' + esc(m.callsign) + '</strong><span>' + esc(m.dep + ' → ' + m.arr) + '</span><span>DOF ' + esc(m.dof) + '</span><span>REG ' + esc(s?.reg || '—') + '</span></div><small>OFP FliteBrief · CFP ' + esc(s?.cfp || '—') + ' · Crewlist ETD ' + esc(s?.crew_etd || '') + '</small><details><summary>FPL nguồn</summary><pre>' + esc(s?.original || '') + '</pre></details>';
    const fields = [['eobt','EOBT UTC',4]].concat(m.kind === 'CHG' ? [['aircraft','Loại máy bay',4],['wake','Wake',1],['equipment','Equipment',80],['surveillance','Surveillance',40]] : []);
    el('aviFields').innerHTML = fields.map(([key,label,max]) => '<label>' + label + '<input data-field="' + key + '" aria-label="' + label + '" maxlength="' + max + '"' + (key === 'eobt' ? ' inputmode="numeric" pattern="[0-9]{4}"' : '') + ' value="' + esc(m[key]) + '"></label>').join('');
    el('aviFields').querySelectorAll('input').forEach(i => { i.oninput = () => { if (reviewed || job) return; m[i.dataset.field] = i.value.toUpperCase(); i.value = m[i.dataset.field]; preview(); }; });
    renderTokens(); preview();
  }
  async function status() {
    if (!plan || owner !== uid()) return;
    try {
      const d = await request('/api/atc/aviweb/status?plan_id=' + encodeURIComponent(plan.plan_id));
      const r = d.result || {};
      if (d.status === 'draft') { if (!job) el('aviStatus').textContent = 'Bản soạn chưa gửi · hiệu lực đến ' + new Date(plan.expires_at).toISOString().slice(11,16) + ' UTC'; return; }
      job = true; reviewed = true; controls();
      el('aviPreview').textContent = content();
      el('aviLog').textContent = (r.lines || []).map(l => typeof l === 'string' ? l : l.text).filter(Boolean).join('\n');
      const finished = ['done','failed'].includes(d.status);
      if (finished) {
        clearTimeout(timer); timer = null;
        const ok = Number(r.sent || 0), failed = Number(r.failed || (d.status === 'failed' ? 1 : 0));
        const pending = Math.max(0, messages.length - ok - failed);
        el('aviStatus').textContent = 'Đã gửi ' + ok + ' · Lỗi/chưa xác nhận ' + failed + ' · Chưa gửi ' + pending;
        if (r.error) error(r.error);
        if (Array.isArray(r.errors) && r.errors.length) error(r.errors.join('\n'));
      } else {
        const lines = (r.lines || []).map(l => typeof l === 'string' ? l : l.text).filter(Boolean);
        const last = String(lines[lines.length - 1] || '');
        el('aviStatus').textContent = d.status === 'pending' ? 'Đã giao Trợ lý PC · đang chờ gửi'
          : /tự bấm Submit/.test(last) ? 'Chrome đã điền xong — anh kiểm tra rồi bấm Submit trên AviWeb'
          : 'Trợ lý PC đang thao tác AviWeb…';
        timer = setTimeout(status, 2000);
      }
    } catch (e) { error(e); el('aviStatus').textContent = 'Chưa đọc được trạng thái · không tự gửi lại'; if (job) timer = setTimeout(status, 5000); }
  }
  el('aviReview').onclick = () => { try { content(); reviewed = true; render(); } catch(e) { error(e); } };
  el('aviBack').onclick = () => { reviewed = false; render(); };
  el('aviCopy').onclick = async () => { try { await navigator.clipboard.writeText(reviewed ? content() : core.serialize(messages[index])); el('aviStatus').textContent = 'Đã copy điện văn'; } catch(e) { error(e); } };
  el('aviExport').onclick = () => { try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content()],{type:'text/plain;charset=utf-8'})); a.download = plan.operation + '-AVIWEB.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href),1000); } catch(e) { error(e); } };
  el('aviCheckStatus').onclick = () => { clearTimeout(timer); status(); };
  el('aviConfirm').onclick = async () => {
    if (!plan || !reviewed || submitting || job) return;
    let text;
    try { text = content(); } catch(e) { error(e); return; }
    submitting = true; controls(); el('aviStatus').textContent = 'Đang xác minh lại nguồn và giao lệnh…';
    try {
      const d = await request('/api/atc/aviweb/execute', {plan_id:plan.plan_id, confirmed:true, content:text, manual_submit:el('aviManual').checked});
      job = !!d.job_id; await status();
    } catch(e) { error(e); el('aviStatus').textContent = 'Chưa xác nhận giao lệnh · kiểm tra trạng thái trước khi gửi lại'; await status(); }
    finally { submitting = false; controls(); }
  };
  window.__aviwebOpen = async (operation, explicitItems) => {
    if (!['CHG','DLA'].includes(operation)) return;
    if (loading) throw new Error('Đang đọc chuyến AviWeb; chờ bảng hiện tại nạp xong.');
    if (explicitItems !== undefined && job && plan && owner === uid() && timer) throw new Error('Có lệnh AviWeb đang chạy; chờ có kết quả trước khi mở chuyến khác.');
    if (job && plan && owner === uid() && timer) { fitDialog(); if (!dialog.open) dialog.showModal(); await status(); return; }
    if (typeof ftMsgClose === 'function') ftMsgClose();
    const items = explicitItems !== undefined ? explicitItems : (typeof ftPickedItems === 'function' ? ftPickedItems() : []);
    if (!Array.isArray(items) || !items.length) { alert(explicitItems !== undefined ? 'Chưa chọn được đúng chuyến.' : 'Tick ít nhất một chuyến trong Flight Planning.'); return; }
    clearTimeout(timer); timer = null; plan = null; messages = []; index = 0; reviewed = false; submitting = false; job = false; owner = uid(); activeOp = operation; loading = true;
    el('aviTitle').textContent = operation + ' AviWeb'; el('aviFlights').innerHTML = ''; el('aviSource').innerHTML = ''; el('aviFields').innerHTML = ''; el('aviTokens').innerHTML = ''; el('aviPreview').textContent = ''; el('aviLog').textContent = ''; error(''); el('aviStatus').textContent = 'Đang đọc OFP và Crewlist của ' + items.length + ' chuyến đã chọn…';
    syncManual(); fitDialog(); if (!dialog.open) dialog.showModal(); controls();
    try {
      const d = await request('/api/atc/aviweb/plan', {operation:activeOp, items:items.map(i => ({flt:String(i.flt),date:i.date || '',dep:i.dep || '',arr:i.arr || '', ...(i.sector_id ? {sector_id:Number(i.sector_id)} : {})}))});
      plan = d; messages = core.parse(d.content, d.operation); render(); await status();
    } catch(e) { error(e); el('aviStatus').textContent = 'Chưa lập điện · chưa gửi'; }
    finally { loading = false; controls(); }
  };
  const menu = document.getElementById('ftMsgMenu');
  if (menu) ['DLA','CHG'].forEach(op => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn avi-menu'; b.textContent = op + ' AviWeb'; b.onclick = e => { e.preventDefault(); e.stopPropagation(); window.__aviwebOpen(op).catch(error); }; menu.appendChild(b); });
})();
