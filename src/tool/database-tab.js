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
    ["dbxFiles","Quản lí file","Các file đang lưu trên máy chủ: xem, tìm, tải về, xoá (admin)","🗂️","#4f46e5"],
    ["dbxAirports","Airport","Sân bay theo quốc gia · giờ Local time hiện tại","🛫","#0369a1"],
    ["dbxAirspace","Named Airspace","Danh mục vùng theo quốc gia · AIP ENR","🌐","var(--x-red)"]
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
    /* Database luôn nằm ngay trước "Quản lí tài khoản" (nếu đã có), không thì sau AFTN. */
    var acctMg = document.getElementById("opsAcctManage");
    if(acctMg && acctMg.parentNode === aftn.parentNode) aftn.parentNode.insertBefore(tab, acctMg);
    else aftn.parentNode.insertBefore(tab, aftn.nextSibling);
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
      #dbxAirspacePane thead th,.dbx-air-scroll thead th{color:var(--x-ink2)!important;-webkit-text-fill-color:var(--x-ink2)!important;background:var(--x-bg)!important;font-weight:700}
      .dbx-air-copy{margin-left:8px;padding:2px 8px;border:1px solid var(--x-line);border-radius:6px;background:var(--x-bg);color:var(--x-ink2);font-size:12px;cursor:pointer}
      .dbx-air-copy:hover{border-color:var(--x-red);color:var(--x-red)}
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
      if(defHead && (defHead.textContent || "").indexOf("DEFAULT ADDRESS") >= 0){ defHead.insertAdjacentHTML("beforeend", ' <span style="color:#7c2d12;font-weight:600">🔒 cố định — luôn gửi kèm, không sửa/xoá</span>'); pane.insertBefore(defHead, bookCol || null); }
      pane.insertBefore(def, bookCol || null);
      def.readOnly = true;
      def.style.height = "150px"; def.style.opacity = ".85"; def.style.cursor = "not-allowed";
    }
    var filePane = wrap.querySelector("#dbxFilePane"), files = [];
    var airPane = document.createElement("section");
    airPane.id = "dbxAirPane";
    airPane.style.display = "none";
    airPane.innerHTML = '<div class="dbx-air-toolbar"><button class="btn small" type="button" id="dbxAirBack">← Danh mục</button><h3>Named Airspace</h3><span id="dbxAirTotal"></span><input type="search" id="dbxAirQ" aria-label="Tìm vùng" placeholder="Tìm mã vùng / tên / FIR…"></div><div class="dbx-air-layout"><nav id="dbxAirCountries" aria-label="Quốc gia"></nav><div class="dbx-air-content"><div class="dbx-air-heading"><h3 id="dbxAirCountry"></h3><span id="dbxAirCount"></span></div><div class="dbx-air-scroll"><table aria-label="Danh mục vùng có tên"><thead><tr><th>Mã vùng / Tên</th><th>FIR</th><th>Giới hạn cao</th><th>Ranh giới</th><th>AIP</th></tr></thead><tbody id="dbxAirRows"></tbody></table></div><div id="dbxAirDetail" hidden></div></div></div>';
    wrap.appendChild(airPane);
    var airStyle = document.createElement("style");
    airStyle.textContent = `
      #dbxAirPane{color:var(--x-ink);font-size:16px;min-height:0;flex:1;flex-direction:column;gap:18px}
      .dbx-air-toolbar{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
      .dbx-air-toolbar h3,.dbx-air-heading h3{margin:0;font-size:22px;letter-spacing:0}
      #dbxAirTotal,#dbxAirCount{color:var(--x-ink2);font-size:15px}
      #dbxAirQ{margin-left:auto;min-width:220px;flex:0 1 340px;background:var(--x-card);color:var(--x-ink);border:1px solid var(--x-line);border-radius:6px;padding:10px 12px;font-size:16px}
      .dbx-air-layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:24px;min-height:0;flex:1}
      #dbxAirCountries{display:flex;flex-direction:column;gap:5px;overflow:auto;align-self:start;max-height:600px}
      #dbxAirCountries .btn{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:16px;text-align:left;border-radius:6px;padding:12px;background:var(--x-card);color:var(--x-ink);border:1px solid var(--x-line)}
      #dbxAirCountries .btn[aria-pressed=true]{background:var(--x-red);color:var(--x-card);border-color:var(--x-red);font-weight:750}
      .dbx-air-content{min-width:0;display:flex;flex-direction:column;min-height:0}
      .dbx-air-heading{display:flex;align-items:center;justify-content:space-between;padding:4px 0 16px;gap:10px;border-bottom:2px solid var(--x-red)}
      .dbx-air-scroll{overflow:auto;max-height:600px;min-height:220px}
      #dbxAirPane table{width:100%;border-collapse:collapse;font-size:16px}
      #dbxAirPane th{position:sticky;top:0;background:var(--x-bg)!important;color:var(--x-ink2)!important;text-align:left;padding:12px!important;font-size:13px!important;white-space:nowrap;z-index:1}
      #dbxAirPane td{padding:12px!important;border-bottom:1px solid var(--x-line2);background:var(--x-card)!important;color:var(--x-ink)!important;-webkit-text-fill-color:var(--x-ink)!important;font-size:16px!important;vertical-align:top}
      #dbxAirPane .dbx-air-name{display:block;color:var(--x-ink2);font-size:14px;margin-top:4px}
      #dbxAirPane .dbx-air-id{border:0;padding:0;background:transparent;color:var(--x-red);font:750 16px var(--x-mono);cursor:pointer;text-align:left}
      #dbxAirPane a{color:var(--x-red);text-decoration:underline}
      #dbxAirDetail{border-top:2px solid var(--x-red);padding:16px 0;overflow-wrap:anywhere}
      #dbxAirDetail h4{font-size:19px;margin:0 0 10px}
      #dbxAirDetail pre{max-height:160px;overflow:auto;background:var(--x-bg);padding:12px;font-size:14px}
      @media(max-width:760px){.dbx-air-layout{grid-template-columns:minmax(0,1fr)}#dbxAirCountries{flex-direction:row;max-width:100%;align-self:stretch}#dbxAirCountries .btn{flex-shrink:0}#dbxAirQ{flex:1;min-width:180px}.dbx-air-scroll{max-height:500px}}
    `;
    document.head.appendChild(airStyle);
    var airRows = window.__namedAirspaceCatalogue || [], airCountry = "ALL";
    var groups = {};
    airRows.forEach(function(a){if(!groups[a.countryCode])groups[a.countryCode]={name:a.country,n:0};groups[a.countryCode].n++;});
    wrap.querySelector("#dbxAirTotal").textContent = airRows.length + " vùng · " + Object.keys(groups).length + " quốc gia / vùng lãnh thổ";
    wrap.querySelector("#dbxAirCountries").innerHTML = '<button class="btn" type="button" data-country="ALL" aria-pressed="true">Tất cả <span>'+airRows.length+'</span></button>' + Object.keys(groups).sort(function(a,b){return groups[a].name.localeCompare(groups[b].name,"vi");}).map(function(k){return '<button class="btn" type="button" data-country="'+k+'" aria-pressed="false">'+esc(groups[k].name)+' <span>'+groups[k].n+'</span></button>';}).join("");
    function drawAir(){
      var q = wrap.querySelector("#dbxAirQ").value.trim().toLowerCase();
      var list = airRows.filter(function(a){return (airCountry === "ALL" || a.countryCode === airCountry) && [a.id,a.name,a.fir,a.country].join(" ").toLowerCase().indexOf(q)>=0;});
      wrap.querySelector("#dbxAirCountry").textContent = airCountry === "ALL" ? "Tất cả quốc gia" : groups[airCountry].name;
      wrap.querySelector("#dbxAirCount").textContent = list.length + " vùng";
      wrap.querySelector("#dbxAirDetail").hidden = true;
      wrap.querySelector("#dbxAirRows").innerHTML = list.length ? list.map(function(a){
        return '<tr><td><button type="button" class="dbx-air-id" data-area="'+esc(a.id)+'">'+esc(a.id)+'</button>'+(a.name!==a.id?'<span class="dbx-air-name">'+esc(a.name)+'</span>':'')+'</td><td>'+esc(a.fir||'—')+'</td><td>'+esc(a.lower||'—')+' / '+(a.upperFt===null?'—':esc(a.upperFt)+' FT')+'</td><td>'+(a.geometry.shape==='circle'?'Vòng tròn · '+a.geometry.radius_nm.toFixed(2)+' NM':'Đa giác · '+a.geometry.ring.length+' điểm')+' <button type="button" class="dbx-air-copy" data-copy="'+esc(a.id)+'" title="Copy toạ độ">⧉ Copy</button></td><td>'+(a.source?'<a target="_blank" rel="noopener noreferrer" href="'+esc(a.source)+'">Nguồn AIP ↗</a>':'Kho ENR gốc')+(a.effective?'<span class="dbx-air-name">'+esc(a.effective)+'</span>':'')+'</td></tr>';
      }).join("") : '<tr><td colspan="5">Không tìm thấy vùng.</td></tr>';
      wrap.querySelectorAll("[data-country]").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.country===airCountry));});
    }
    wrap.querySelector("#dbxAirCountries").onclick = function(e){var b=e.target.closest("[data-country]");if(!b)return;airCountry=b.dataset.country;drawAir();};
    wrap.querySelector("#dbxAirQ").addEventListener("input",drawAir);
    wrap.querySelector("#dbxAirRows").onclick = function(e){
      var cp=e.target.closest("[data-copy]");
      if(cp){var ca=airRows.find(function(r){return r.id===cp.dataset.copy;});if(!ca)return;var cg=ca.geometry;var txt=ca.name+'\n'+(cg.shape==='circle'?'Tâm: '+cg.lat.toFixed(6)+', '+cg.lon.toFixed(6)+' · Bán kính: '+cg.radius_nm.toFixed(4)+' NM':cg.ring.map(function(p){return p[0].toFixed(6)+', '+p[1].toFixed(6);}).join('\n'));var done=function(){var o=cp.textContent;cp.textContent='✓ Đã copy';setTimeout(function(){cp.textContent=o;},1400);};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done,function(){fb();});}else fb();function fb(){var t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();try{document.execCommand('copy');}catch(_){}t.remove();done();}return;}
      var b=e.target.closest("[data-area]");if(!b)return;
      var a=airRows.find(function(r){return r.id===b.dataset.area;});if(!a)return;
      var detail=wrap.querySelector("#dbxAirDetail"), g=a.geometry;
      var coords=g.shape==='circle'?'Tâm: '+g.lat.toFixed(6)+', '+g.lon.toFixed(6)+' · Bán kính: '+g.radius_nm.toFixed(4)+' NM':g.ring.map(function(p){return p[0].toFixed(6)+', '+p[1].toFixed(6);}).join('\n');
      detail.innerHTML='<h4>'+esc(a.name)+'</h4><div>'+esc(a.country)+' · '+esc(a.fir||'FIR chưa có thông tin')+'</div>'+(a.document?'<p>'+esc(a.document)+'</p>':'')+(a.activation?'<p>'+esc(a.activation)+'</p>':'')+'<button type="button" class="dbx-air-copy" data-copy="'+esc(a.id)+'">⧉ Copy toạ độ</button><pre style="user-select:text">'+esc(coords)+'</pre>';
      detail.hidden=false;detail.scrollIntoView({block:'nearest'});
    };
    wrap.querySelector("#dbxAirDetail").onclick = function(e){ if(e.target.closest("[data-copy]")) wrap.querySelector("#dbxAirRows").onclick(e); };
    wrap.querySelector("#dbxAirBack").onclick=function(){closePanes();};
    /* ---- Airport: theo quốc gia + Local time ---- */
    var aptRows = window.__airportCatalogue || [], aptCc = "VN", aptTimer = null;
    var ccName = (function(){ var dn=null; try{ dn=new Intl.DisplayNames(["vi"],{type:"region"}); }catch(e){} return function(c){ try{ return (dn&&dn.of(c))||c; }catch(e){ return c; } }; })();
    var aptGroups = {}; aptRows.forEach(function(r){ aptGroups[r[1]]=(aptGroups[r[1]]||0)+1; });
    var aptPane = document.createElement("section");
    aptPane.id = "dbxAptPane"; aptPane.style.display = "none";
    aptPane.innerHTML = '<div class="dbx-air-toolbar"><button class="btn small" type="button" id="dbxAptBack">← Danh mục</button><h3>Airport</h3><span id="dbxAptTotal"></span><span id="dbxAptUtc" class="dbx-apt-utc"></span><input type="search" id="dbxAptQ" aria-label="Tìm sân bay" placeholder="Tìm ICAO / quốc gia…"><input type="search" id="dbxAptCcQ" aria-label="Tìm quốc gia" placeholder="Lọc quốc gia…"></div><div class="dbx-air-layout"><nav id="dbxAptCountries" aria-label="Quốc gia"></nav><div class="dbx-air-content"><div class="dbx-air-heading"><h3 id="dbxAptCountry"></h3><span id="dbxAptCount"></span></div><div class="dbx-air-scroll"><table aria-label="Danh mục sân bay"><thead><tr><th>ICAO</th><th>Quốc gia</th><th>UTC</th><th>Local time</th></tr></thead><tbody id="dbxAptRows"></tbody></table></div></div></div>';
    wrap.appendChild(aptPane);
    var aptStyle = document.createElement("style");
    aptStyle.textContent = '#dbxAptPane{color:var(--x-ink);font-size:16px;min-height:0;flex:1;flex-direction:column;gap:18px}'
      + '#dbxAptQ{margin-left:auto}#dbxAptQ,#dbxAptCcQ{min-width:180px;background:var(--x-card);color:var(--x-ink);border:1px solid var(--x-line);border-radius:6px;padding:10px 12px;font-size:16px}'
      + '#dbxAptCountries{display:flex;flex-direction:column;gap:5px;overflow:auto;align-self:start;max-height:600px}'
      + '#dbxAptCountries .btn{display:flex;justify-content:space-between;gap:12px;font-size:15px;text-align:left;border-radius:6px;padding:10px 12px;background:var(--x-card);color:var(--x-ink);border:1px solid var(--x-line)}'
      + '#dbxAptCountries .btn[aria-pressed=true]{background:var(--x-red);color:var(--x-card);border-color:var(--x-red);font-weight:750}'
      + '#dbxAptPane table{width:100%;border-collapse:collapse}#dbxAptPane th{position:sticky;top:0;background:var(--x-bg)!important;color:var(--x-ink2)!important;-webkit-text-fill-color:var(--x-ink2)!important;text-align:left;padding:12px!important;font-size:13px!important;z-index:1}'
      + '#dbxAptPane td{padding:10px 12px!important;border-bottom:1px solid var(--x-line2);background:var(--x-card)!important;color:var(--x-ink)!important;-webkit-text-fill-color:var(--x-ink)!important;font-size:16px!important}'
      + '#dbxAptPane .dbx-apt-icao{font:750 16px var(--x-mono);color:var(--x-red)!important;-webkit-text-fill-color:var(--x-red)!important}'
      + '#dbxAptPane .dbx-apt-lt{font:700 17px var(--x-mono);font-variant-numeric:tabular-nums}#dbxAptPane .dbx-apt-day{font-size:12px;color:var(--x-ink2);margin-left:6px}'
      + '.dbx-apt-utc{font:700 15px var(--x-mono);color:var(--x-ink2)}'
      + '@media(max-width:760px){#dbxAptCountries{flex-direction:row;max-width:100%;align-self:stretch}#dbxAptCountries .btn{flex-shrink:0}}';
    document.head.appendChild(aptStyle);
    wrap.querySelector("#dbxAptTotal").textContent = aptRows.length + " sân · " + Object.keys(aptGroups).length + " quốc gia";
    function aptOffMin(s){ var m=/^([+-]?)(\d{1,2}):(\d{2})$/.exec(s||""); if(!m) return 0; var v=(+m[2])*60+(+m[3]); return m[1]==="-"?-v:v; }
    function aptLocal(off){ var now=new Date(), d=new Date(now.getTime()+aptOffMin(off)*60000); var hh=("0"+d.getUTCHours()).slice(-2), mm=("0"+d.getUTCMinutes()).slice(-2); var dd=("0"+d.getUTCDate()).slice(-2)+"/"+("0"+(d.getUTCMonth()+1)).slice(-2); return hh+":"+mm+'<span class="dbx-apt-day">'+dd+'</span>'; }
    function aptUtcLabel(off){ return "UTC" + (/^-/.test(off)?"":"+") + off; }
    function drawAptCountries(){
      var q = wrap.querySelector("#dbxAptCcQ").value.trim().toLowerCase();
      var keys = Object.keys(aptGroups).sort(function(a,b){ if(a==="VN") return -1; if(b==="VN") return 1; return ccName(a).localeCompare(ccName(b),"vi"); })
        .filter(function(k){ return !q || (ccName(k)+" "+k).toLowerCase().indexOf(q)>=0; });
      wrap.querySelector("#dbxAptCountries").innerHTML = '<button class="btn" type="button" data-apt-cc="ALL" aria-pressed="'+(aptCc==="ALL")+'">Tất cả <span>'+aptRows.length+'</span></button>'
        + keys.map(function(k){ return '<button class="btn" type="button" data-apt-cc="'+k+'" aria-pressed="'+(aptCc===k)+'">'+esc(ccName(k))+' <span>'+aptGroups[k]+'</span></button>'; }).join("");
    }
    function drawApt(){
      var q = wrap.querySelector("#dbxAptQ").value.trim().toUpperCase();
      var list = aptRows.filter(function(r){ return (aptCc==="ALL"||r[1]===aptCc) && (!q || r[0].indexOf(q)>=0 || ccName(r[1]).toUpperCase().indexOf(q)>=0); });
      wrap.querySelector("#dbxAptCountry").textContent = aptCc==="ALL" ? "Tất cả quốc gia" : ccName(aptCc);
      wrap.querySelector("#dbxAptCount").textContent = list.length + " sân bay";
      wrap.querySelector("#dbxAptRows").innerHTML = list.length ? list.slice(0,1500).map(function(r){
        return '<tr><td class="dbx-apt-icao">'+r[0]+'</td><td>'+esc(ccName(r[1]))+'</td><td>'+aptUtcLabel(r[2])+'</td><td class="dbx-apt-lt" data-off="'+r[2]+'">'+aptLocal(r[2])+'</td></tr>';
      }).join("") : '<tr><td colspan="4">Không tìm thấy sân bay.</td></tr>';
      wrap.querySelectorAll("[data-apt-cc]").forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.aptCc===aptCc)); });
      tickApt();
    }
    function tickApt(){
      var n=new Date(); wrap.querySelector("#dbxAptUtc").textContent = "UTC " + ("0"+n.getUTCHours()).slice(-2)+":"+("0"+n.getUTCMinutes()).slice(-2);
      wrap.querySelectorAll("#dbxAptRows .dbx-apt-lt").forEach(function(td){ td.innerHTML = aptLocal(td.dataset.off); });
    }
    wrap.querySelector("#dbxAptCountries").onclick = function(e){ var b=e.target.closest("[data-apt-cc]"); if(!b) return; aptCc=b.dataset.aptCc; drawApt(); };
    wrap.querySelector("#dbxAptQ").addEventListener("input", drawApt);
    wrap.querySelector("#dbxAptCcQ").addEventListener("input", drawAptCountries);
    wrap.querySelector("#dbxAptBack").onclick = function(){ closePanes(); };
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
    function closePanes(){ pane.style.display = "none"; defPane.style.display = "none"; filePane.style.display = "none"; airPane.style.display = "none"; aptPane.style.display = "none"; if(aptTimer){ clearInterval(aptTimer); aptTimer = null; } grid.style.display = ""; }
    wrap.querySelector("#dbxBookBack").onclick = closePanes;
    wrap.querySelector("#dbxDefBack").onclick = closePanes;
    wrap.addEventListener("click", function(e){
      var c = e.target.closest(".dbx-card"); if(!c) return;
      var id = c.getAttribute("data-btn");
      if(id === "dbxAirports"){ closePanes(); grid.style.display="none"; aptPane.style.display="flex"; drawAptCountries(); drawApt(); aptTimer = setInterval(tickApt, 15000); return; }
      if(id === "dbxAirspace"){ closePanes(); grid.style.display="none"; airPane.style.display="flex"; drawAir(); return; }
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
