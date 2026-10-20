(function () {
  const anchor = document.getElementById('ftAtcBtn');
  if (!anchor) return;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = anchor.className;
  btn.id = 'ftEzfwBtn'; btn.textContent = 'Tạo EZFW';
  anchor.insertAdjacentElement('afterend', btn);
  const modal = document.createElement('div');
  modal.className = 'ftlib-modal'; modal.id = 'ftEzfwModal';
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-label', 'Tạo ATC và EZFW');
  modal.innerHTML = '<div class="khb-ezfw-dialog"><div class="khb-ezfw-head"><strong>TẠO ATC & EZFW</strong><button type="button" class="btn small" id="ftEzfwClose" aria-label="Đóng">×</button></div><form id="ftEzfwForm"><label for="ftEzfwFlights">Số hiệu chuyến bay</label><input id="ftEzfwFlights" autocomplete="off" spellcheck="false" placeholder="7527 3901" required><div class="khb-ezfw-actions"><button type="submit" class="btn small primary" id="ftEzfwRun">Tạo và lưu</button></div></form><pre id="ftEzfwLog" role="status" aria-live="polite"></pre></div>';
  document.body.appendChild(modal);
  const style = document.createElement('style');
  style.textContent = '#ftEzfwModal{position:fixed;inset:0;z-index:12000;display:none;align-items:center;justify-content:center;background:var(--x-overlay, var(--line));padding:20px}#ftEzfwModal.open{display:flex}.khb-ezfw-dialog{width:min(640px,95vw);max-height:85vh;overflow:auto;background:var(--x-card);color:var(--x-ink);border:1px solid var(--x-line);border-radius:8px;padding:20px}.khb-ezfw-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}#ftEzfwForm label{display:block;margin-bottom:8px}#ftEzfwFlights{box-sizing:border-box;width:100%;font-size:22px;padding:12px;border:1px solid var(--x-line);background:var(--x-bg);color:var(--x-ink);border-radius:6px}.khb-ezfw-actions{display:flex;justify-content:flex-end;margin-top:12px}#ftEzfwLog{white-space:pre-wrap;overflow-wrap:anywhere;min-height:100px;max-height:360px;overflow:auto;font:14px/1.6 var(--x-mono);border-top:1px solid var(--x-line);padding-top:12px}';
  document.head.appendChild(style);
  const input = document.getElementById('ftEzfwFlights');
  const log = document.getElementById('ftEzfwLog');
  const run = document.getElementById('ftEzfwRun');
  let busy = false;
  const line = text => { log.textContent += (log.textContent ? '\n' : '') + text; log.scrollTop = log.scrollHeight; };
  btn.onclick = () => { modal.classList.add('open'); input.focus(); };
  document.getElementById('ftEzfwClose').onclick = () => modal.classList.remove('open');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('open'); };
  document.getElementById('ftEzfwForm').onsubmit = async e => {
    e.preventDefault(); if (busy) return;
    busy = true; run.disabled = true; input.disabled = true; log.textContent = '';
    let es;
    let timer;
    const finish = () => { busy = false; run.disabled = false; input.disabled = false; clearTimeout(timer); if (es) es.close(); };
    try {
      line('Đang kiểm tra trợ lý PC và Crewlist…');
      const res = await fetch('/api/fpltext/ezfw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flight: input.value.trim() }) });
      const d = await res.json();
      if (!res.ok || d.error || !d.id) throw new Error(d.error || 'Không tạo được yêu cầu.');
      es = new EventSource('/api/stream?id=' + encodeURIComponent(d.id));
      timer = setTimeout(() => { line('Hết thời gian chờ. Kiểm tra nhật ký trợ lý PC trước khi thử lại.'); finish(); }, 20 * 60 * 1000);
      es.onmessage = ev => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === 'line') line(m.text || '');
          if (m.type === 'end') { line(m.text || 'Không hoàn thành — xem lỗi phía trên.'); finish(); }
        } catch (_) { line('Không đọc được phản hồi.'); finish(); }
      };
      es.onerror = () => { line('Mất kết nối theo dõi — kiểm tra trợ lý PC trước khi bấm lại.'); finish(); };
    } catch (err) { line(err.message || 'Không tạo được file.'); finish(); }
  };
})();