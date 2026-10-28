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
      + '<div style="overflow:auto;flex:1;min-height:0;border:1px solid var(--line,#ccc);border-radius:10px"><table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<thead><tr style="position:sticky;top:0;background:var(--panel,#fff)"><th style="width:28px"><input type="checkbox" id="dbxFileAll"></th><th style="text-align:left;padding:6px">File</th><th style="text-align:right;padding:6px">Dung lượng</th><th style="text-align:left;padding:6px">Cập nhật</th><th></th></tr></thead>'
      + '<tbody id="dbxFileBody"></tbody></table></div></div>'
      + '<div id="dbxDefPane" style="display:none;flex-direction:column;gap:8px;min-height:0;flex:1">'
      + '<div><button type="button" class="btn small" id="dbxDefBack">← Danh mục</button></div></div>';
    ref.parentNode.insertBefore(wrap, ref.nextSibling);
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
      wrap.querySelector("#dbxFileBody").innerHTML = list.slice(0, 1500).map(function(f){
        var d = f.updated ? new Date(f.updated).toLocaleString("vi-VN") : "";
        return '<tr style="border-top:1px solid var(--line,#eee)"><td style="text-align:center"><input type="checkbox" class="dbxFileCk" data-p="'+esc(f.path)+'"></td>'
          + '<td style="padding:5px 6px;word-break:break-all">'+esc(f.name)+'</td><td style="text-align:right;padding:5px 6px;white-space:nowrap">'+fmtSize(f.size)+'</td>'
          + '<td style="padding:5px 6px;white-space:nowrap">'+d+'</td><td><a class="btn small" href="/api/files/get?p='+encodeURIComponent(f.path)+'" target="_blank">⬇ Tải</a></td></tr>';
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
