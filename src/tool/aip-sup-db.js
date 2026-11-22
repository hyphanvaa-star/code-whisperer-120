/* Database → "AIP SUP": danh sách AIP SUP hiện hành theo quốc gia (Singapore, Hàn Quốc, Hồng Kông,
   Malaysia, Thái Lan đọc trực tiếp từ eAIP; Nhật/Đài Loan/Úc hiện các SUP đã tự đọc khi check NOTAM).
   Mỗi SUP cho biết đã có vùng vẽ được chưa; bấm "Đọc vùng" để máy chủ tải và tách toạ độ ngay. */
(function(){
  function esc(t){ return String(t == null ? "" : t).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function fmtTs(ms){ if(!ms) return ""; var d = new Date(ms); var p = function(n){ return ("0"+n).slice(-2); }; return p(d.getDate())+"/"+p(d.getMonth()+1)+" "+p(d.getHours())+":"+p(d.getMinutes()); }
  function init(){
    var wrap = document.getElementById("wrapDatabase");
    if(!wrap){ return false; }
    if(document.getElementById("dbxSupPane")) return true;
    var grid = wrap.querySelector(".dbx-grid");
    var opener = document.createElement("button");
    opener.type = "button"; opener.id = "dbxAipSup"; opener.style.display = "none";
    wrap.appendChild(opener);
    var pane = document.createElement("section");
    pane.id = "dbxSupPane"; pane.style.display = "none";
    pane.innerHTML = '<div class="sup-toolbar"><button class="btn small" type="button" id="dbxSupBack">← Danh mục</button><h3>AIP SUP</h3><span id="dbxSupTotal"></span>'
      + '<label class="sup-only"><input type="checkbox" id="dbxSupOnly"> Chỉ SUP có vùng</label>'
      + '<input type="search" id="dbxSupQ" aria-label="Tìm SUP" placeholder="Tìm số SUP / nội dung / tên vùng…">'
      + '<button class="btn small" type="button" id="dbxSupReload" title="Tải lại danh sách SUP mới nhất từ cổng AIP các nước">↻ Cập nhật danh sách</button></div>'
      + '<div class="sup-layout"><nav id="dbxSupCountries" aria-label="Quốc gia"></nav><div class="sup-content">'
      + '<div class="sup-heading"><h3 id="dbxSupCountry"></h3><span id="dbxSupInfo"></span><button class="btn small" type="button" id="dbxSupReadAll">Đọc vùng tất cả SUP chưa đọc</button></div>'
      + '<div class="sup-scroll"><table aria-label="Danh sách AIP SUP"><thead><tr><th>SUP</th><th>Hiệu lực</th><th>Nội dung</th><th>Vùng vẽ được</th><th></th></tr></thead><tbody id="dbxSupRows"></tbody></table></div></div></div>';
    wrap.appendChild(pane);
    var st = document.createElement("style");
    st.textContent = `
      #dbxSupPane{color:var(--x-ink);font-size:16px;min-height:0;flex:1;flex-direction:column;gap:16px}
      #dbxSupPane .sup-toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
      #dbxSupPane h3{margin:0;font-size:22px;letter-spacing:0}
      #dbxSupTotal,#dbxSupInfo{color:var(--x-ink2);font-size:14px}
      #dbxSupPane .sup-only{display:flex;align-items:center;gap:6px;font-size:14px;color:var(--x-ink2);margin-left:auto;cursor:pointer}
      #dbxSupQ{min-width:220px;flex:0 1 320px;background:var(--x-card);color:var(--x-ink);border:1px solid var(--x-line);border-radius:6px;padding:9px 12px;font-size:15px}
      #dbxSupPane .sup-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:22px;min-height:0;flex:1}
      #dbxSupCountries{display:flex;flex-direction:column;gap:6px;overflow:auto;align-self:start;max-height:640px}
      #dbxSupCountries button{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;border-radius:6px;padding:10px 12px;background:var(--x-card);color:var(--x-ink);border:1px solid var(--x-line);cursor:pointer;font:inherit}
      #dbxSupCountries button b{font-size:16px}
      #dbxSupCountries button span{font-size:12px;color:var(--x-ink2)}
      #dbxSupCountries button.on{border-color:var(--x-red);box-shadow:inset 3px 0 0 var(--x-red)}
      #dbxSupCountries button.auto b::after{content:" · tự động";font-weight:600;font-size:11px;color:var(--x-red)}
      #dbxSupPane .sup-content{display:flex;flex-direction:column;min-width:0;min-height:0;gap:10px}
      #dbxSupPane .sup-heading{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
      #dbxSupPane .sup-heading a{color:var(--x-red);font-size:13px}
      #dbxSupReadAll{margin-left:auto}
      #dbxSupPane .sup-scroll{overflow:auto;flex:1;min-height:0;max-height:640px;border-top:3px solid var(--x-red);background:var(--x-card)}
      #dbxSupPane table{width:100%;border-collapse:collapse;font-size:15px;line-height:1.45}
      #dbxSupPane thead th{position:sticky;top:0;z-index:1;text-align:left;padding:10px;background:var(--x-bg);color:var(--x-ink2);-webkit-text-fill-color:var(--x-ink2);border-bottom:1px solid var(--x-line);font-size:13px;font-weight:700;white-space:nowrap}
      #dbxSupPane tbody td{padding:10px;border-bottom:1px solid var(--x-line2,var(--x-line));color:var(--x-ink);-webkit-text-fill-color:var(--x-ink);vertical-align:top;background:var(--x-card)}
      #dbxSupPane td.sup-no{font-weight:750;white-space:nowrap;font-variant-numeric:tabular-nums}
      #dbxSupPane td.sup-date{white-space:nowrap;font-size:13px;color:var(--x-ink2);-webkit-text-fill-color:var(--x-ink2)}
      #dbxSupPane td.sup-act{white-space:nowrap;text-align:right}
      #dbxSupPane td.sup-act .btn{margin-left:4px}
      #dbxSupPane .sup-ok{display:inline-block;background:#16a34a;color:#fff;-webkit-text-fill-color:#fff;font-weight:700;border-radius:999px;padding:1px 9px;font-size:13px}
      #dbxSupPane .sup-none{color:var(--x-ink2);-webkit-text-fill-color:var(--x-ink2);font-size:13px}
      #dbxSupPane .sup-names{display:block;font-size:13px;margin-top:3px;color:var(--x-ink2);-webkit-text-fill-color:var(--x-ink2)}
      #dbxSupPane tr.sup-detail td{background:var(--x-bg)}
      #dbxSupPane .sup-area{display:flex;gap:10px;align-items:center;padding:3px 0;font-size:14px}
      #dbxSupPane .sup-area code{font-size:12px;color:var(--x-ink2);-webkit-text-fill-color:var(--x-ink2)}
      #dbxSupPane .sup-copy{padding:2px 8px;border:1px solid var(--x-line);border-radius:6px;background:var(--x-card);color:var(--x-ink2);font-size:12px;cursor:pointer}
      #dbxSupPane .sup-copy:hover{border-color:var(--x-red);color:var(--x-red)}
      @media(max-width:1000px){#dbxSupPane .sup-layout{grid-template-columns:minmax(0,1fr)}#dbxSupCountries{flex-direction:row;flex-wrap:wrap;max-height:none}}
    `;
    document.head.appendChild(st);
    var data = null, country = "SG", open = {}, busy = false, stopAll = false;
    var $ = function(id){ return pane.querySelector("#"+id); };
    function cur(){ return data && data.countries.find(function(c){ return c.cc === country; }); }
    function areaCount(s){ return s.read && s.read.ok ? s.read.areas.length : 0; }
    function drawCountries(){
      var h = "";
      (data ? data.countries : []).forEach(function(c){
        var withArea = c.sups.filter(areaCount).length;
        var sub = c.error ? "lỗi tải danh sách" : (c.live ? c.sups.length + " SUP · " + withArea + " có vùng" : withArea + " SUP đã đọc vùng");
        h += '<button type="button" data-cc="'+c.cc+'" class="'+(c.cc===country?"on ":"")+(c.live?"auto":"")+'"><b>'+esc(c.name)+'</b><span>'+esc(c.firs.join(" · "))+' — '+esc(sub)+'</span></button>';
      });
      $("dbxSupCountries").innerHTML = h;
      var tot = data ? data.countries.reduce(function(a, c){ return a + c.sups.length; }, 0) : 0;
      $("dbxSupTotal").textContent = data ? tot + " SUP · " + data.countries.length + " quốc gia" : "";
    }
    function readCell(s){
      if(!s.read) return '<span class="sup-none">Chưa đọc</span>';
      if(s.read.ok){
        var names = s.read.areas.map(function(a){ return a.name; });
        return '<span class="sup-ok">✓ '+names.length+' vùng</span><span class="sup-names">'+esc(names.slice(0, 6).join(", "))+(names.length > 6 ? "…" : "")+'</span>';
      }
      var e = String(s.read.error || "");
      return '<span class="sup-none">'+(/không có tọa độ/.test(e) ? "Không có vùng (SUP mặt đất / thủ tục)" : "Chưa đọc được: " + esc(e.slice(0, 90)))+'</span>';
    }
    function drawRows(){
      var c = cur(); var body = $("dbxSupRows");
      if(!c){ body.innerHTML = '<tr><td colspan="5" class="sup-none">'+(data ? "Không có dữ liệu" : "Đang tải danh sách AIP SUP…")+'</td></tr>'; return; }
      $("dbxSupCountry").textContent = c.name;
      var info = c.error ? "⚠ " + c.error : (c.live ? "Cập nhật " + fmtTs(c.updated) : "SUP được đọc tự động khi check NOTAM");
      $("dbxSupInfo").innerHTML = esc(info) + (c.src ? ' · <a href="'+esc(c.src)+'" target="_blank" rel="noopener">Nguồn eAIP ↗</a>' : "");
      $("dbxSupReadAll").style.display = c.live ? "" : "none";
      var q = ($("dbxSupQ").value || "").toLowerCase(), only = $("dbxSupOnly").checked;
      var list = c.sups.filter(function(s){
        if(only && !areaCount(s)) return false;
        if(!q) return true;
        var names = s.read && s.read.areas ? s.read.areas.map(function(a){ return a.name; }).join(" ") : "";
        return (s.sup + " " + s.label + " " + s.subject + " " + names).toLowerCase().indexOf(q) >= 0;
      });
      if(!list.length){ body.innerHTML = '<tr><td colspan="5" class="sup-none">Không có SUP phù hợp</td></tr>'; return; }
      var h = "";
      list.forEach(function(s){
        var id = c.cc + ":" + s.sup;
        var period = s.from || s.to ? esc(s.from || "") + (s.to ? " → " + esc(s.to) : "") : "";
        h += '<tr data-id="'+esc(id)+'"><td class="sup-no">'+esc(s.label || s.sup)+'</td><td class="sup-date">'+period+'</td><td>'+esc(s.subject || "")+'</td><td>'+readCell(s)+'</td>'
          + '<td class="sup-act">'+(areaCount(s) ? '<button class="btn small" type="button" data-act="show" data-sup="'+esc(s.sup)+'">'+(open[id] ? "Ẩn toạ độ" : "Toạ độ")+'</button>' : "")
          + (c.live ? '<button class="btn small" type="button" data-act="read" data-sup="'+esc(s.sup)+'">'+(s.read ? "Đọc lại" : "Đọc vùng")+'</button>' : "")
          + (s.url ? '<a class="btn small" href="'+esc(s.url)+'" target="_blank" rel="noopener">Mở ↗</a>' : "") + '</td></tr>';
        if(open[id] && areaCount(s)){
          h += '<tr class="sup-detail"><td colspan="5">' + s.read.areas.map(function(a, i){
            return '<div class="sup-area"><b>'+esc(a.name)+'</b><code>'+a.ring.length+' điểm · '+a.ring[0][0].toFixed(4)+', '+a.ring[0][1].toFixed(4)+'…</code><button type="button" class="sup-copy" data-copy="'+esc(s.sup)+'" data-i="'+i+'">Copy toạ độ</button></div>';
          }).join("") + '</td></tr>';
        }
      });
      body.innerHTML = h;
    }
    function draw(){ drawCountries(); drawRows(); }
    function load(force){
      $("dbxSupRows").innerHTML = '<tr><td colspan="5" class="sup-none">Đang tải danh sách AIP SUP'+(force ? " mới nhất" : "")+'…</td></tr>';
      fetch("/api/aipsup/catalog" + (force ? "?force=1" : ""), {cache:"no-store"}).then(function(r){ return r.json(); }).then(function(d){
        if(d && d.error){ $("dbxSupRows").innerHTML = '<tr><td colspan="5" class="sup-none">Lỗi: '+esc(d.error)+'</td></tr>'; return; }
        data = d; if(!cur() && data.countries[0]) country = data.countries[0].cc; draw();
      }).catch(function(){ $("dbxSupRows").innerHTML = '<tr><td colspan="5" class="sup-none">Không tải được danh sách AIP SUP</td></tr>'; });
    }
    function readOne(cc, sup, force){
      return fetch("/api/aipsup/read?cc=" + encodeURIComponent(cc) + "&sup=" + encodeURIComponent(sup) + (force ? "&force=1" : ""), {cache:"no-store"})
        .then(function(r){ return r.json(); }).then(function(d){
          var c = data && data.countries.find(function(x){ return x.cc === cc; });
          var s = c && c.sups.find(function(x){ return x.sup === sup; });
          if(s && d) s.read = { ok: !!d.ok, ts: d.ts, areas: d.areas || [], error: d.error };
        });
    }
    function show(){ grid.style.display = "none"; wrap.querySelectorAll("#dbxBookPane,#dbxFilePane,#dbxDefPane,#dbxAirPane,#dbxAptPane").forEach(function(x){ x.style.display = "none"; }); pane.style.display = "flex"; if(!data) load(false); else draw(); }
    function hide(){ stopAll = true; pane.style.display = "none"; }
    opener.addEventListener("click", show);
    $("dbxSupBack").onclick = function(){ hide(); grid.style.display = ""; };
    $("dbxSupReload").onclick = function(){ load(true); };
    $("dbxSupQ").addEventListener("input", drawRows);
    $("dbxSupOnly").addEventListener("change", drawRows);
    $("dbxSupCountries").onclick = function(e){ var b = e.target.closest("[data-cc]"); if(!b) return; country = b.getAttribute("data-cc"); draw(); };
    $("dbxSupRows").addEventListener("click", function(e){
      var c = cur(); if(!c) return;
      var cp = e.target.closest(".sup-copy");
      if(cp){
        var s0 = c.sups.find(function(x){ return x.sup === cp.getAttribute("data-copy"); });
        var a = s0 && s0.read && s0.read.areas[+cp.getAttribute("data-i")]; if(!a) return;
        var txt = a.name + "\n" + a.ring.map(function(p){ return p[0].toFixed(6) + ", " + p[1].toFixed(6); }).join("\n");
        var done = function(){ var o = cp.textContent; cp.textContent = "✓ Đã copy"; setTimeout(function(){ cp.textContent = o; }, 1400); };
        if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, done); else done();
        return;
      }
      var b = e.target.closest("[data-act]"); if(!b) return;
      var sup = b.getAttribute("data-sup"), id = c.cc + ":" + sup;
      if(b.getAttribute("data-act") === "show"){ open[id] = !open[id]; drawRows(); return; }
      b.disabled = true; b.textContent = "Đang đọc…";
      var s = c.sups.find(function(x){ return x.sup === sup; });
      readOne(c.cc, sup, !!(s && s.read)).then(function(){ open[id] = true; draw(); }, function(){ b.disabled = false; b.textContent = "Lỗi — thử lại"; });
    });
    $("dbxSupReadAll").onclick = function(){
      var c = cur(); if(!c || busy) { stopAll = true; return; }
      var todo = c.sups.filter(function(s){ return !s.read; });
      if(!todo.length){ alert("Mọi SUP của " + c.name + " đã được đọc."); return; }
      busy = true; stopAll = false; var btn = this, i = 0;
      var step = function(){
        if(stopAll || i >= todo.length || pane.style.display === "none"){ busy = false; btn.textContent = "Đọc vùng tất cả SUP chưa đọc"; draw(); return; }
        btn.textContent = "Đang đọc " + (i + 1) + "/" + todo.length + " — bấm để dừng";
        readOne(c.cc, todo[i].sup, false).catch(function(){}).then(function(){ i++; if(i % 3 === 0) draw(); step(); });
      };
      step();
    };
    wrap.addEventListener("click", function(e){ var card = e.target.closest(".dbx-card"); if(card && card.getAttribute("data-btn") !== "dbxAipSup") hide(); });
    var tab = document.getElementById("mDatabase"); if(tab) tab.addEventListener("click", hide);
    return true;
  }
  function boot(){ if(init()) return; var n = 0, t = setInterval(function(){ if(init() || ++n > 60) clearInterval(t); }, 500); }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
