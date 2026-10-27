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
    ["dbxAftnDef","DEFAULT ADDRESS","Địa chỉ AFTN gửi mặc định cho mọi chuyến (dùng khi xuất TPL)","📮","#b45309"]
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
    function closePanes(){ pane.style.display = "none"; defPane.style.display = "none"; grid.style.display = ""; }
    wrap.querySelector("#dbxBookBack").onclick = closePanes;
    wrap.querySelector("#dbxDefBack").onclick = closePanes;
    wrap.addEventListener("click", function(e){
      var c = e.target.closest(".dbx-card"); if(!c) return;
      var id = c.getAttribute("data-btn");
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
