/* V 6.13 — Tab "Hiển thị chung" ẩn đi; "Dữ liệu so sánh" là tab mở đầu.
   Kết quả Check OFP live (trước nằm ở tab phụ "Check OFP" của khung phải, khung
   này bị ẩn khi ở So sánh) giờ mở trong một bảng nổi riêng. Bảng dùng lại đúng
   #paneLimitCheck và renderOfpCheckPane() của trang gốc — chỉ đổi chỗ hiển thị,
   không đổi logic chấm chuyến. */
(function(){
  if(window.__ofpCkModal) return;
  window.__ofpCkModal = true;
  var q = function(s){ return document.querySelector(s); };
  var lastAt = null;

  var css = document.createElement("style");
  css.textContent = [
    "#mGeneral{display:none !important}",
    ".aside-head .modes #mCompare .mode-bang#genBang{right:30px !important}",
    ".ock-ov{position:fixed;inset:0;z-index:10050;display:none;align-items:center;justify-content:center;",
    "  background:rgba(15,23,42,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);padding:24px}",
    ".ock-ov.on{display:flex;animation:ockFade .16s ease-out}",
    ".ock-box{width:min(920px,96vw);max-height:88vh;display:flex;flex-direction:column;background:#fff;color:#0f172a;",
    "  border-radius:18px;box-shadow:0 30px 80px rgba(15,23,42,.35),0 0 0 1px rgba(15,23,42,.06);overflow:hidden;",
    "  font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;animation:ockUp .2s ease-out}",
    ".ock-hd{display:flex;align-items:center;gap:14px;padding:18px 22px 14px;border-bottom:1px solid #eef0f4;",
    "  background:linear-gradient(180deg,#f8fafc,#fff)}",
    ".ock-ic{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;flex:none;font-weight:900;",
    "  font-size:13px;letter-spacing:.06em;color:#fff;background:linear-gradient(135deg,#0d9488,#0f766e);",
    "  box-shadow:0 6px 14px rgba(13,148,136,.32)}",
    ".ock-tt{flex:1;min-width:0}",
    ".ock-tt h3{margin:0;font-size:19px;font-weight:800;letter-spacing:-.01em;color:#0f172a}",
    ".ock-sub{font-size:13px;color:#64748b;margin-top:2px}",
    ".ock-x{flex:none;width:36px;height:36px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;color:#475569;",
    "  font-size:22px;line-height:1;cursor:pointer;display:grid;place-items:center}",
    ".ock-x:hover{background:#f1f5f9;color:#0f172a}",
    ".ock-chips{display:flex;flex-wrap:wrap;gap:8px;padding:12px 22px;border-bottom:1px solid #eef0f4;background:#fff}",
    ".ock-chip{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:999px;font-size:13px;",
    "  font-weight:700;border:1px solid transparent}",
    ".ock-chip b{font-size:15px;font-weight:900}",
    ".ock-chip.crit{color:#b91c1c;background:#fef2f2;border-color:#fecaca}",
    ".ock-chip.warn{color:#92400e;background:#fffbeb;border-color:#fde68a}",
    ".ock-chip.wait{color:#475569;background:#f1f5f9;border-color:#e2e8f0}",
    ".ock-chip.fail{color:#9a3412;background:#fff7ed;border-color:#fed7aa}",
    ".ock-chip.ok{color:#fff;background:#16a34a;border-color:#16a34a}",
    ".ock-body{flex:1;min-height:0;overflow:auto;background:#f8fafc;padding:16px 22px 18px}",
    ".ock-body #paneLimitCheck{display:flex !important;flex-direction:column;padding:0;overflow:visible;font-size:15px}",
    ".ock-body .ofp-sum{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px;margin:0 0 12px}",
    ".ock-body .ofp-head{margin:0 0 10px;font-size:12px}",
    ".ock-body .ofp-row{background:#fff;border:1px solid #e2e8f0;border-left:5px solid #f59e0b;border-radius:12px;",
    "  padding:12px 16px;margin:0 0 10px;box-shadow:0 1px 2px rgba(15,23,42,.04)}",
    ".ock-body .ofp-row:first-of-type{border-top:1px solid #e2e8f0}",
    ".ock-body .ofp-row:has(.ofp-tag.crit){border-left-color:#dc2626;background:#fffafa}",
    ".ock-body .ofp-row:has(.ofp-tag.wait){border-left-color:#94a3b8}",
    ".ock-body .ofp-row:has(.ofp-tag.fail){border-left-color:#ea580c}",
    ".ock-body .ofp-cs{font-size:16.5px;font-weight:900;color:#0f172a;margin:0 4px}",
    ".ock-body .ofp-why{color:#334155;padding-left:4px;margin-top:6px}",
    ".ock-body .ofp-ev{color:#1e3a8a;background:#eff6ff;border-radius:8px;padding:4px 10px;margin:4px 0 0 18px;",
    "  font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:13.5px}",
    ".ock-body .empty{background:#fff;border:1px dashed #cbd5e1;border-radius:12px;padding:28px;text-align:center;color:#64748b}",
    ".ock-ft{display:flex;align-items:center;gap:10px;padding:12px 22px;border-top:1px solid #eef0f4;background:#fff;",
    "  font-size:12.5px;color:#94a3b8}",
    ".ock-ft .sp{flex:1}",
    ".ock-btn{border:1px solid #0f766e;background:#0d9488;color:#fff;font-weight:800;border-radius:10px;padding:8px 16px;",
    "  font-size:14px;cursor:pointer}",
    ".ock-btn:hover{background:#0f766e}",
    ".ock-btn:disabled{opacity:.55;cursor:default}",
    ".ock-btn.ghost{background:#fff;color:#334155;border-color:#e2e8f0}",
    ".ock-btn.ghost:hover{background:#f1f5f9}",
    "#ofpCheckStat{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}",
    "#ockBody #paneLimitCheck{--ofp-text:#0f172a;--ofp-muted:#475569;--ofp-evidence:#1e3a8a;--ofp-success:#15803d;",
    "  --ofp-danger:#b91c1c;--ofp-warning:#92400e;--ofp-divider:#e2e8f0;color:#0f172a !important}",
    "#ockBody #paneLimitCheck .ofp-row{border-color:#e2e8f0 !important;border-left-color:#f59e0b !important}",
    "#ockBody #paneLimitCheck .ofp-row:has(.ofp-tag.crit){border-left-color:#dc2626 !important}",
    "#ockBody #paneLimitCheck .ofp-row:has(.ofp-tag.wait){border-left-color:#94a3b8 !important}",
    "#ockBody #paneLimitCheck .ofp-row:has(.ofp-tag.fail){border-left-color:#ea580c !important}",
    "#ockBody #paneLimitCheck .ofp-why{color:#334155 !important}",
    "#ockBody #paneLimitCheck .ofp-tag{font-size:12.5px;padding:2px 10px}",
    "#ockBody #paneLimitCheck .ofp-tag.crit{background:#fef2f2 !important;border-color:#fecaca !important}",
    "#ockBody #paneLimitCheck .ofp-tag.warn{background:#fffbeb !important;border-color:#fde68a !important}",
    "#ockBody #paneLimitCheck .ofp-tag.wait{background:#f1f5f9 !important;border-color:#e2e8f0 !important}",
    "#ockBody #paneLimitCheck .ofp-tag.fail{background:#fff7ed !important;border-color:#fed7aa !important}",
    "#ockBody #paneLimitCheck .ofp-tag.ok{background:#16a34a !important;border-color:#16a34a !important;color:#fff !important}",
    ".ock-x:focus-visible,.ock-btn:focus-visible{outline:2px solid #0d9488;outline-offset:2px}",
    "@keyframes ockFade{from{opacity:0}to{opacity:1}}",
    "@keyframes ockUp{from{transform:translateY(14px) scale(.985);opacity:0}to{transform:none;opacity:1}}"
  ].join("\n");
  document.head.appendChild(css);

  var ov = document.createElement("div");
  ov.className = "ock-ov";
  ov.id = "ofpCkModal";
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.setAttribute("aria-labelledby", "ockTitle");
  ov.innerHTML = '<div class="ock-box">'
    + '<header class="ock-hd"><div class="ock-ic">OFP</div>'
    + '<div class="ock-tt"><h3 id="ockTitle">Kết quả Check OFP live</h3>'
    + '<div class="ock-sub" id="ockSub">Chưa chạy lượt nào</div></div>'
    + '<button type="button" class="ock-x" id="ockClose" aria-label="Đóng" title="Đóng (ESC)">×</button></header>'
    + '<div class="ock-chips" id="ockChips"></div>'
    + '<div class="ock-body" id="ockBody"></div>'
    + '<footer class="ock-ft"><span>ESC hoặc bấm ra ngoài để đóng</span><span class="sp"></span>'
    + '<button type="button" class="ock-btn ghost" id="ockDone">Đóng</button>'
    + '<button type="button" class="ock-btn" id="ockRerun">Check lại OFP</button></footer>'
    + '</div>';
  document.body.appendChild(ov);

  function report(){ try{ return ofpCheckReport || []; }catch(e){ return []; } }

  function paintChips(){
    var rows = report();
    var n = {crit: 0, warn: 0, wait: 0, fail: 0, ok: 0};
    for(var i = 0; i < rows.length; i++){
      var it = rows[i];
      var need = false;
      try{ need = ofpItemNeedsAttention(it); }catch(e){}
      if(!need){ n.ok++; continue; }
      var s = it.state === "ok" ? "warn" : it.state;
      if(n[s] !== undefined) n[s]++;
    }
    var chip = function(cls, label, v){
      return v ? '<span class="ock-chip ' + cls + '"><b>' + v + '</b>' + label + '</span>' : '';
    };
    var html = chip("crit", "vi phạm", n.crit) + chip("warn", "còn lưu ý", n.warn)
      + chip("wait", "chưa có OFP REL", n.wait) + chip("fail", "lỗi tải OFP", n.fail)
      + chip("ok", "hợp lệ", n.ok);
    var box = q("#ockChips");
    box.innerHTML = html;
    box.style.display = html ? "" : "none";
    var sub = q("#ockSub");
    if(rows.length){
      var t = lastAt || new Date();
      var p = function(x){ return String(x).padStart(2, "0"); };
      sub.textContent = "Đã đọc OFP " + rows.length + " chuyến · cập nhật " + p(t.getHours()) + ":" + p(t.getMinutes())
        + " · " + p(t.getUTCHours()) + ":" + p(t.getUTCMinutes()) + "Z";
    }else{
      sub.textContent = "Chưa chạy lượt nào — bấm “Check lại OFP” để bắt đầu";
    }
    var btn = q("#btnOfpCheck"), rr = q("#ockRerun");
    if(btn && rr) rr.disabled = !!btn.disabled;
  }

  function mountPane(){
    var pane = q("#paneLimitCheck");
    if(pane && pane.parentNode !== q("#ockBody")) q("#ockBody").appendChild(pane);
  }

  function openModal(){
    mountPane();
    try{ renderOfpCheckPane(); }catch(e){ console.error(e); }
    paintChips();
    ov.classList.add("on");
    setTimeout(function(){ var x = q("#ockClose"); if(x) x.focus(); }, 30);
  }
  function closeModal(){ ov.classList.remove("on"); }
  window.ofpCkOpen = openModal;
  window.ofpCkClose = closeModal;

  ov.addEventListener("mousedown", function(ev){ if(ev.target === ov) closeModal(); });
  q("#ockClose").onclick = closeModal;
  q("#ockDone").onclick = closeModal;
  q("#ockRerun").onclick = function(){
    var btn = q("#btnOfpCheck");
    if(btn && !btn.disabled){ closeModal(); btn.click(); }
  };
  document.addEventListener("keydown", function(ev){
    if(ev.key === "Escape" && ov.classList.contains("on")){ ev.stopPropagation(); closeModal(); }
  }, true);

  // Vẽ lại pane gốc → cập nhật luôn các chip đếm của bảng nổi.
  if(typeof window.renderOfpCheckPane === "function"){
    var origRender = window.renderOfpCheckPane;
    window.renderOfpCheckPane = function(){
      var r = origRender.apply(this, arguments);
      try{ paintChips(); }catch(e){}
      return r;
    };
  }

  // Xong lượt Check OFP: không nhảy sang tab phụ của khung phải (đã ẩn ở So sánh)
  // mà mở bảng nổi kết quả.
  window.finishOfpCheck = function(line, color, setStat){
    ofpCheckSummary = {text: line, color: color};
    lastAt = new Date();
    mountPane();
    renderOfpCheckPane();
    if(typeof setStat === "function") setStat("→ xem kết quả", color || "");
    openModal();
  };

  function wire(){
    mountPane();
    var stat = q("#ofpCheckStat");
    if(stat){
      stat.onclick = openModal;
      stat.title = "Bấm để mở bảng kết quả Check OFP live";
    }
    var tab = q("#tabLimit");
    if(tab){ tab.onclick = openModal; }

    // Ẩn tab Hiển thị chung; nhãn đỏ đếm vi phạm của nó chuyển sang tab So sánh.
    var g = q("#mGeneral"), c = q("#mCompare");
    if(g){ g.setAttribute("aria-hidden", "true"); g.tabIndex = -1; }
    var bang = q("#genBang");
    if(bang && c && bang.parentNode !== c) c.insertBefore(bang, c.firstChild);
    if(bang){
      bang.onclick = function(ev){
        ev.stopPropagation();
        if(mode !== "compare") setMode("compare");
        try{ if(limUnseen().length) limBangToggle(); }catch(e){}
      };
    }

    // Mọi lối cũ về "general" giờ về So sánh.
    if(typeof window.setMode === "function" && !window.setMode.__noGeneral){
      var origSet = window.setMode;
      window.setMode = function(m){ return origSet.call(this, m === "general" ? "compare" : m); };
      window.setMode.__noGeneral = true;
    }
    if(typeof mode !== "undefined" && mode === "general") setMode("compare");

    // Chưa có Crewlist: bảng So sánh dựng từ danh sách FliteBrief. Lúc mở trang
    // danh sách chưa về, nên khi chuyến về (hoặc tự làm mới) thì vẽ lại bảng.
    if(typeof window.render === "function" && !window.render.__cmpBoot){
      var origR = window.render, seen = null, tmr = null;
      window.render = function(){
        var r = origR.apply(this, arguments);
        try{
          if(flights !== seen && flights.length){
            seen = flights;
            clearTimeout(tmr);
            tmr = setTimeout(function(){
              if(mode === "compare" && !xls && !lastCmp) setMode("compare");
            }, 120);
          }
        }catch(e){}
        return r;
      };
      window.render.__cmpBoot = true;
    }
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
