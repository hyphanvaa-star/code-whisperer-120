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
    ["ftOfpRulesBtn","OFP check data","Điều kiện nút OFP kiểm tra (vd giờ tới KAPLI)","✅","#dc2626"]
  ];
  function init(){
    var aftn = document.getElementById("mAftn"), ref = document.getElementById("wrapAftn");
    if(!aftn || !ref || document.getElementById("mDatabase")) return;
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
    wrap.innerHTML = h + '</div>';
    ref.parentNode.insertBefore(wrap, ref.nextSibling);
    wrap.addEventListener("click", function(e){
      var c = e.target.closest(".dbx-card"); if(!c) return;
      var b = document.getElementById(c.getAttribute("data-btn")); if(b) b.click();
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
    });
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
