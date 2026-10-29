/* Tab "Database": gom các bảng dữ liệu KHB thành danh mục; bấm thẻ mở đúng bảng. */
(function(){
  var ITEMS = [
    ["ftCostBtn","Cost Index","Chỉ số CI theo sân đi và loại tàu","💹","#2563eb"],
    ["ftTaxiBtn","Taxi fuel","Nhiên liệu taxi theo sân bay / tháng","⛽","#d97706"],
    ["ftRouteBtn","Route","ETP / hold theo giờ KAPLI – ENVAR","🧭","#059669"],
    ["ftAltBtn","ALT route","Enroute ALT, ETP POA, FL, TALT, ALT1, ALT2","🛬","#7c3aed"],
    ["ftEraBtn","ERA","Sân dự bị ERA theo chặng","📍","#db2777"],
    ["ftPcrBtn","PCR","Giới hạn PCR cất cánh theo sân","🛤️","#0891b2"],
    ["ftConvBtn","Data Convert","FL, SID đặc biệt, không convert STAR","🔁","#ea580c"],
    ["ftOfpRulesBtn","OFP check data","Điều kiện nút OFP kiểm tra (vd giờ tới KAPLI)","✅","#dc2626"],
    ["dbxAftnBook","AFTN Address","Danh bạ CODE → địa chỉ AFTN","📡","#0f766e"],
    ["dbxAftnDef","DEFAULT ADDRESS","Địa chỉ AFTN gửi mặc định cho mọi chuyến (dùng khi xuất TPL)","📮","#b45309"],
    ["dbxFiles","Quản lí file","Các file đang lưu trên máy chủ: xem, tìm, tải về, xoá (admin)","🗂️","#4f46e5"]
  ];
  function init(){
    var aftn = document.getElementById("mAftn"), ref = document.getElementById("wrapAftn");
    if(!aftn || !ref || document.getElementById("mDatabase")) return;
    /* Tab AFTN filling đã ẩn: mọi việc TPL làm ở KHB, danh bạ + địa chỉ mặc định ở Database. */
    aftn.style.display = "none";
    aftn.setAttribute("aria-hidden", "true");
    aftn.tabIndex = -1;
    var tab = document.createElement("button");
    tab.className = "mode"; tab.id = "mDatabase"; tab.type = "button";
    tab.setAttribute("role","tab"); tab.setAttribute("aria-selected","false");
    tab.title = "Các bảng dữ liệu: Cost Index, Taxi fuel, Route, ALT, ERA, PCR, Convert, OFP check";
    tab.textContent = "Database";
    aftn.parentNode.insertBefore(tab, aftn.nextSibling);
    var wrap = document.createElement("div");
    wrap.id = "wrapDatabase"; wrap.className = "dbx-wrap"; wrap.style.display = "none";
    var h = '<div class="dbx-head"><div><h2>Database</h2><p>Chọn một danh mục để xem và chỉnh bảng dữ liệu.</p></div>'
      + '<input type="search" id="dbxFind" placeholder="Tìm danh mục…"></div><div class="dbx-grid">';
    ITEMS.forEach(function(it){
      h += '<button type="button" class="dbx-card" data-btn="'+it[0]+'" style="--c:'+it[4]+'">'
        + '<span class="dbx-ic">'+it[3]+'</span><span class="dbx-t">'+it[1]+'</span>'
        + '<span class="dbx-d">'+it[2]+'</span><span class="dbx-go">Mở bảng →</span></button>';
      var b = document.getElementById(it[0]); if(b) b.style.display = "none";
    });
    wrap.innerHTML = h + '</div>'
      + '<div id="dbxBookPane" style="display:none;flex-direction:column;gap:8px;min-height:0;flex:1">'
      + '<div><button type="button" class="btn small" id="dbxBookBack">← Danh mục</button></div></div>'
      + '<div id="dbxFilePane" style="display:none;flex-direction:column;gap:8px;min-height:0;flex:1">'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="btn small" id="dbxFileBack">← Danh mục</button>'
      + '<input type="search" id="dbxFileQ" placeholder="Tìm tên file / thư mục…" style="flex:1;min-width:180px;padding:6px 10px">'
      + '<button type="button" class="btn small" id="dbxFileReload">↻ Tải lại</button><button type="button" class="btn small" id="dbxFileDel">🗑 Xoá đã chọn</button>'
      + '<span id="dbxFileInfo" style="font-size:12px;opacity:.75"></span></div>'
      + '<div class="dbx-file-columns">'
      + '<section class="dbx-file-section"><div class="dbx-file-heading"><span class="dbx-file-symbol">▤</span><h3>File khai thác</h3><span id="dbxFileBodyXN" class="dbx-file-count"></span></div><div class="dbx-file-scroll"><table aria-label="File khai thác"><thead><tr><th class="dbx-check-col"><input type="checkbox" id="dbxFileAll" aria-label="Chọn tất cả file"></th><th>Tên file</th><th>Dung lượng</th><th>Cập nhật</th><th></th></tr></thead><tbody id="dbxFileBodyX"></tbody></table></div></section>'
      + '<section class="dbx-file-section"><div class="dbx-file-heading"><span class="dbx-file-symbol">▧</span><h3>Thư viện tài liệu</h3><span id="dbxFileBodySN" class="dbx-file-count"></span></div><div class="dbx-file-scroll"><table aria-label="Thư viện tài liệu"><thead><tr><th class="dbx-check-col"></th><th>Tên file</th><th>Dung lượng</th><th>Cập nhật</th><th></th></tr></thead><tbody id="dbxFileBodyS"></tbody></table></div></section>'
      + '</div></div>'
      + '<div id="dbxDefPane" style="display:none;flex-direction:column;gap:8px;min-height:0;flex:1">'
      + '<div><button type="button" class="btn small" id="dbxDefBack">← Danh mục</button></div></div>';
    ref.parentNode.insertBefore(wrap, ref.nextSibling);
    var fileStyle = document.createElement("style");
    fileStyle.textContent = `
      #dbxFilePane{font-size:16px;gap:14px!important;color:var(--x-ink)}
      #dbxFilePane .btn{font-size:15px!important;min-height:36px;padding:7px 12px;border-radius:6px}
      #dbxFileQ{font-size:16px!important;min-height:40px;border:1px solid var(--x-line);border-radius:6px;background:var(--x-card);color:var(--x-ink)}
      #dbxFileInfo{font-size:14px!important;color:var(--x-ink2)}
      .dbx-file-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;flex:1;min-height:0}
      .dbx-file-section{display:flex;flex-direction:column;min-width:0;min-height:0;border-top:3px solid var(--x-red);background:var(--x-card)}
      .dbx-file-heading{display:flex;align-items:center;gap:10px;padding:16px 10px;border-bottom:1px solid var(--x-line)}
      .dbx-file-heading h3{margin:0;font-size:19px;font-weight:750;letter-spacing:0;color:var(--x-ink)}
      .dbx-file-symbol{font-size:24px;color:var(--x-red)}
      .dbx-file-count{font-size:14px;font-weight:600;color:var(--x-ink2);margin-left:auto}
      .dbx-file-scroll{overflow:auto;flex:1;min-height:0}
      #dbxFilePane table{width:100%;border-collapse:collapse;font-size:16px!important;line-height:1.45}
      #dbxFilePane thead th{position:sticky;top:0;z-index:1;text-align:left;padding:12px 10px!important;background:var(--x-bg)!important;color:var(--x-ink2)!important;-webkit-text-fill-color:var(--x-ink2)!important;border-bottom:1px solid var(--x-line);font-size:13px!important;letter-spacing:0;font-weight:700;white-space:nowrap}
      #dbxFilePane tbody td{padding:12px 10px!important;font-size:16px!important;border-bottom:1px solid var(--x-line2);background:var(--x-card)!important;color:var(--x-ink)!important;-webkit-text-fill-color:var(--x-ink)!important;vertical-align:middle}
      #dbxFilePane tbody tr:nth-child(even) td{background:var(--x-bg)!important}
      #dbxFilePane tbody tr:hover td,#dbxFilePane tbody tr:has(input:checked) td{background:color-mix(in srgb,var(--x-red) 7%,var(--x-card))!important}
      #dbxFilePane .dbx-file-name{min-width:170px;overflow-wrap:anywhere;font-weight:550}
      #dbxFilePane .dbx-file-size,#dbxFilePane .dbx-file-date{white-space:nowrap;font-variant-numeric:tabular-nums;font-size:14px!important}
      #dbxFilePane .dbx-file-size{text-align:right}
      #dbxFilePane .dbx-check-col{width:34px;text-align:center}
      #dbxFilePane input[type=checkbox]{width:16px;height:16px;accent-color:var(--x-red);cursor:pointer}
      #dbxFilePane .dbx-file-action{text-align:right;white-space:nowrap}
      #dbxFilePane .dbx-file-action a{background:transparent!important;color:var(--x-red)!important;-webkit-text-fill-color:var(--x-red)!important;border:1px solid var(--x-line);text-decoration:none;font-weight:700}
      #dbxFilePane .dbx-file-action a:hover{border-color:var(--x-red)}
      @media(max-width:1000px){.dbx-file-columns{grid-template-columns:minmax(0,1fr);flex:none}.dbx-file-scroll{max-height:560px}}
    `;
    document.head.appendChild(fileStyle);
    var pane = wrap.querySelector("#dbxBookPane"), grid = wrap.querySelector(".dbx-grid");
    var defPane = wrap.querySelector("#dbxDefPane");
    var bookCol = document.getElementById("afBook"); bookCol = bookCol && bookCol.parentNode;
    if(bookCol){
      var g = bookCol.parentNode; pane.appendChild(bookCol);
      if(g) g.style.gridTemplateColumns = "1fr";
    }
    var def = document.getElementById("afDef");
    if(def){
      var defHead = def.previousElementSibling;
      if(defHead && (defHead.textContent || "").indexOf("DEFAULT ADDRESS") >= 0) defPane.appendChild(defHead);
      defPane.appendChild(def);
      def.style.height = "220px";
    }
    var filePane = wrap.querySelector("#dbxFilePane"), files = [];
    function fmtSize(n){ return n > 1048576 ? (n/1048576).toFixed(1)+" MB" : n > 1024 ? Math.round(n/1024)+" KB" : n+" B"; }
    function esc(t){ return String(t).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
    function drawFiles(){
      var q = wrap.querySelector("#dbxFileQ").value.toLowerCase();
      var list = files.filter(function(f){ return f.name.toLowerCase().indexOf(q) >= 0; });
      wrap.querySelector("#dbxFileInfo").textContent = list.length + " / " + files.length + " file";
      function isX(f){ return !/^notices\//i.test(f.path); }
      var lx = list.filter(isX), ls = list.filter(function(f){ return !isX(f); });
      wrap.querySelector("#dbxFileBodyXN").textContent = "(" + lx.length + ")";
      wrap.querySelector("#dbxFileBodySN").textContent = "(" + ls.length + ")";
      wrap.querySelector("#dbxFileBodyX").innerHTML = rows(lx);
      wrap.querySelector("#dbxFileBodyS").innerHTML = rows(ls);
    }
    function rows(list){
      return list.slice(0, 1500).map(function(f){
        var d = f.updated ? new Date(f.updated).toLocaleString("vi-VN") : "";
        var name = /^notices\//i.test(f.path) ? String(f.name).replace(/^notices\//i, '') : f.name;
        return '<tr><td class="dbx-check-col"><input type="checkbox" class="dbxFileCk" aria-label="Chọn '+esc(name)+'" data-p="'+esc(f.path)+'"></td>'
          + '<td class="dbx-file-name">'+esc(name)+'</td><td class="dbx-file-size">'+fmtSize(f.size)+'</td>'
          + '<td class="dbx-file-date">'+d+'</td><td class="dbx-file-action"><a class="btn small" aria-label="Tải '+esc(name)+'" href="/api/files/get?p='+encodeURIComponent(f.path)+'" target="_blank">↓ Tải</a></td></tr>';
      }).join("");
    }
    function loadFiles(){
      wrap.querySelector("#dbxFileInfo").textContent = "Đang tải danh sách…";
      fetch("/api/files/list", {cache:"no-store"}).then(function(r){ return r.json(); }).then(function(d){
        if(d && d.error){ wrap.querySelector("#dbxFileInfo").textContent = "Lỗi: " + d.error; return; }
        files = (d && d.files) || []; drawFiles();
      }).catch(function(){ wrap.querySelector("#dbxFileInfo").textContent = "Không tải được danh sách"; });
    }
    wrap.querySelector("#dbxFileQ").addEventListener("input", drawFiles);
    wrap.querySelector("#dbxFileReload").onclick = loadFiles;
    wrap.querySelector("#dbxFileAll").onchange = function(){ var v = this.checked; wrap.querySelectorAll(".dbxFileCk").forEach(function(c){ c.checked = v; }); };
    wrap.querySelector("#dbxFileDel").onclick = function(){
      var ps = Array.prototype.map.call(wrap.querySelectorAll(".dbxFileCk:checked"), function(c){ return c.getAttribute("data-p"); });
      if(!ps.length){ alert("Chưa chọn file nào"); return; }
      if(!confirm("Xoá " + ps.length + " file khỏi máy chủ?")) return;
      fetch("/api/files/delete", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({paths: ps})})
        .then(function(r){ return r.json(); }).then(function(d){ if(d && d.error) alert(d.error); loadFiles(); });
    };
    wrap.querySelector("#dbxFileBack").onclick = function(){ closePanes(); };
    function closePanes(){ pane.style.display = "none"; defPane.style.display = "none"; filePane.style.display = "none"; grid.style.display = ""; }
    wrap.querySelector("#dbxBookBack").onclick = closePanes;
    wrap.querySelector("#dbxDefBack").onclick = closePanes;
    wrap.addEventListener("click", function(e){
      var c = e.target.closest(".dbx-card"); if(!c) return;
      var id = c.getAttribute("data-btn");
      if(id === "dbxFiles"){ grid.style.display = "none"; pane.style.display = "none"; defPane.style.display = "none"; filePane.style.display = "flex"; loadFiles(); return; }
      if(id === "dbxAftnBook"){ grid.style.display = "none"; defPane.style.display = "none"; pane.style.display = "flex"; return; }
      if(id === "dbxAftnDef"){ grid.style.display = "none"; pane.style.display = "none"; defPane.style.display = "flex"; return; }
      var b = document.getElementById(id); if(b) b.click();
    });
    wrap.querySelector("#dbxFind").addEventListener("input", function(){
      var q = this.value.toLowerCase();
      wrap.querySelectorAll(".dbx-card").forEach(function(c){ c.style.display = c.textContent.toLowerCase().indexOf(q) >= 0 ? "" : "none"; });
    });
    function off(){ wrap.style.display = "none"; tab.classList.remove("on"); tab.setAttribute("aria-selected","false"); }
    document.querySelectorAll(".modes .mode").forEach(function(m){ if(m !== tab) m.addEventListener("click", off, true); });
    tab.addEventListener("click", function(){
      try{ if(typeof setMode === "function") setMode("aftn"); }catch(e){}
      var a = document.getElementById("wrapAftn"); if(a) a.style.display = "none";
      aftn.classList.remove("on"); aftn.setAttribute("aria-selected","false");
      tab.classList.add("on"); tab.setAttribute("aria-selected","true");
      wrap.style.display = "flex";
      closePanes();
    });
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

;(function(){ try{ var K="filesAlive", last=+localStorage.getItem(K)||0, beat=function(){localStorage.setItem(K,String(Date.now()));};
  beat(); setInterval(beat,30000); if(last && Date.now()-last<3600000)return;
  setTimeout(function(){ fetch("/api/files/session-cleanup",{method:"POST",cache:"no-store"}).catch(function(){}); },3000); }catch(e){} })();
