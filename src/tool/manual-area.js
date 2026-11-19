// Manual airspace paste: draw pasted coordinates on the NOTAM map and measure vs. the current track.
// Uses window.__ma {parse, band, check} injected by the tool-page shim.
(function(){
  var KEY = "nm.manualAreas.v1", group = null, panel = null;
  function load(){ try{ return JSON.parse(sessionStorage.getItem(KEY) || "[]"); }catch(e){ return []; } }
  function save(list){ try{ sessionStorage.setItem(KEY, JSON.stringify(list)); }catch(e){} }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function map(){ try{ return typeof nmMap !== "undefined" ? nmMap : null; }catch(e){ return null; } }
  function track(){ try{ return (typeof nmTrackData !== "undefined" && nmTrackData && !nmTrackData.fleet_src && nmTrackData.track) || []; }catch(e){ return []; } }
  function corridor(){ try{ var c = (typeof nmAssessCfg === "function" ? nmAssessCfg() : {}) || {}; return +c.corridor_nm || 20; }catch(e){ return 20; } }
  function noun(area){ return area.shape === "point" ? "điểm" : area.shape === "line" ? "đoạn" : "vùng"; }
  function desc(area){
    if(area.shape === "circle") return "vòng tròn " + area.radius_nm.toFixed(1) + " NM" + (area.from === "qline" ? " (theo Q-line)" : "");
    if(area.shape === "point") return "1 điểm ghim " + area.lat.toFixed(4) + ", " + area.lon.toFixed(4);
    if(area.shape === "line") return "đoạn thẳng 2 điểm";
    return "vùng " + area.ring.length + " điểm";
  }
  function verdict(a){
    var tr = track();
    if(!tr.length) return {cls:"mu", txt:"Chưa có đường bay — chọn chuyến ở Lọc notam tracking để đo."};
    var pad = 0; try{ pad = Math.round(((typeof nmAssessCfg === "function" ? nmAssessCfg() : {}) || {}).alt_buffer_ft / 100) || 0; }catch(e){}
    var band = a.band && a.band[1] < 900 ? [Math.max(0, a.band[0] - pad), a.band[1] + pad] : a.band;
    var r = window.__ma.check(a.area, tr.map(function(p){ return {lat:+p.lat, lon:+p.lon, fl_ft:+p.fl_ft || 0, name:p.name}; }), band);
    if(r.dist_nm === null) return {cls:"mu", txt:"Không đo được."};
    var cor = corridor(), near = r.dist_nm <= cor;
    var where = r.name ? " (gần " + esc(r.name) + (r.fl ? " FL" + r.fl : "") + ")" : "", n = noun(a.area);
    if(near && r.flHit === false) return {cls:"br", txt:(r.inside ? "Đường bay CẮT QUA " + n : "Cách " + n + " " + r.dist_nm.toFixed(1) + " NM") + where + " nhưng ngoài dải độ cao — BRIEFING."};
    if(near) return {cls:"cr", txt:(r.inside ? "⛔ Đường bay CẮT QUA " + n : "⚠ Cách " + n + " " + r.dist_nm.toFixed(1) + " NM ≤ " + cor + " NM") + where + (r.flHit === null ? " — chưa nhập độ cao, kiểm tra tay." : " — trong dải độ cao.") };
    return {cls:"ok", txt:"Cách " + n + " " + r.dist_nm.toFixed(1) + " NM > " + cor + " NM — không ảnh hưởng" + where + "."};
  }
  function draw(){
    var m = map(); if(!m || !window.L){ list(); return; }
    if(!group) group = L.layerGroup().addTo(m);
    group.clearLayers();
    load().forEach(function(a){
      var o = {color:"#d84315", weight:3, dashArray:"8 4", fillColor:"#ff7043", fillOpacity:.22}, sh = a.area.shape, lay;
      if(sh === "circle") lay = L.circle([a.area.lat, a.area.lon], Object.assign({radius:a.area.radius_nm * 1852}, o));
      else if(sh === "point"){
        // Pin + the corridor ring it is measured against.
        lay = L.featureGroup([
          L.circle([a.area.lat, a.area.lon], {radius:corridor() * 1852, color:"#d84315", weight:1.5, dashArray:"4 6", fill:false, opacity:.75, interactive:false}),
          L.circleMarker([a.area.lat, a.area.lon], {radius:8, color:"#ffffff", weight:3, fillColor:"#d84315", fillOpacity:1}),
          L.circleMarker([a.area.lat, a.area.lon], {radius:13, color:"#d84315", weight:2, fill:false})
        ]);
      }
      else if(sh === "line") lay = L.featureGroup([
        L.polyline(a.area.ring, {color:"#d84315", weight:4, dashArray:"10 5"}),
        L.circleMarker(a.area.ring[0], {radius:5, color:"#ffffff", weight:2, fillColor:"#d84315", fillOpacity:1}),
        L.circleMarker(a.area.ring[1], {radius:5, color:"#ffffff", weight:2, fillColor:"#d84315", fillOpacity:1})
      ]);
      else lay = L.polygon(a.area.ring, o);
      lay.bindTooltip("📍 " + esc(a.name || "Vùng dán tay") + (a.band ? " · FL" + a.band[0] + "–" + (a.band[1] >= 999 ? "UNL" : "FL" + a.band[1]) : ""), {sticky:true});
      lay.addTo(group);
    });
    list();
  }
  function list(){
    if(!panel) return;
    var box = panel.querySelector(".ma-list"), items = load();
    box.innerHTML = items.length ? "" : '<div class="ma-mu">Chưa có vùng nào.</div>';
    items.forEach(function(a, i){
      var v = verdict(a), row = document.createElement("div");
      row.className = "ma-row ma-" + v.cls;
      row.innerHTML = '<div class="ma-rh"><b>' + esc(a.name || "Vùng " + (i + 1)) + '</b><span>' + ({circle:"Tròn " + (a.area.radius_nm || 0).toFixed(1) + " NM", point:"📍 1 điểm", line:"↔ 2 điểm"}[a.area.shape] || a.area.ring.length + " điểm") + (a.band ? " · FL" + a.band[0] + "–" + (a.band[1] >= 999 ? "UNL" : a.band[1]) : "") + '</span>'
        + '<button type="button" data-z="' + i + '" title="Xem trên bản đồ">🔍</button><button type="button" data-x="' + i + '" title="Xoá">✕</button></div><div class="ma-v">' + v.txt + '</div>';
      box.appendChild(row);
    });
    box.querySelectorAll("[data-x]").forEach(function(b){ b.onclick = function(){ var l = load(); l.splice(+b.dataset.x, 1); save(l); draw(); }; });
    box.querySelectorAll("[data-z]").forEach(function(b){ b.onclick = function(){ zoom(load()[+b.dataset.z]); }; });
  }
  function zoom(a){
    var m = map(); if(!m || !a) return;
    if(a.area.shape === "circle") m.fitBounds(L.latLng(a.area.lat, a.area.lon).toBounds(a.area.radius_nm * 1852 * 2.4));
    else if(a.area.shape === "point") m.fitBounds(L.latLng(a.area.lat, a.area.lon).toBounds(Math.max(corridor(), 10) * 1852 * 4));
    else m.fitBounds(L.latLngBounds(a.area.ring), {padding:[30, 30]});
  }
  function open(name, text){
    if(!panel){
      panel = document.createElement("div");
      panel.className = "ma-panel"; panel.hidden = true;
      panel.innerHTML = '<div class="ma-hd"><b>📍 Dán toạ độ vùng</b><button type="button" class="ma-close" aria-label="Đóng">✕</button></div>'
        + '<label>Tên vùng / NOTAM<input class="ma-name" placeholder="VD: C2490/26 TRA"></label>'
        + '<label>Toạ độ (copy từ NOTAM, AIP SUP, bản đồ…)<textarea class="ma-txt" spellcheck="false" placeholder="210030N 1053045E - 2130N10530E - 2110N10600E&#10;1 điểm: 210030N 1053045E · 2 điểm: đoạn thẳng&#10;RADIUS 10NM CENTERED 2100N10530E"></textarea></label><div class="ma-hint">Hiểu được: 210030N1053045E · N210030 E1053045 · 21°00&#39;30&quot;N 105°30&#39;45&quot;E · 21 15.5N 105 42.3E · 21.0285, 105.8542 · Q-line …/2102N10548E010. Dán cả NOTAM cũng được.</div>'
        + '<label>Độ cao (tuỳ chọn)<input class="ma-band" placeholder="SFC-FL240"></label>'
        + '<div class="ma-msg" role="status"></div>'
        + '<div class="ma-act"><button type="button" class="ma-draw">Vẽ & kiểm tra</button><button type="button" class="ma-clear">Xoá hết</button></div>'
        + '<div class="ma-list"></div>';
      document.body.appendChild(panel);
      // Live read-back while typing so the dispatcher sees what was understood before drawing.
      panel.querySelector(".ma-txt").addEventListener("input", function(){
        var msg = panel.querySelector(".ma-msg"), v = this.value.trim();
        if(!v){ msg.textContent = ""; msg.className = "ma-msg"; return; }
        var ar = window.__ma.parse(v);
        msg.textContent = ar ? "Đọc được: " + desc(ar) + "." : "Chưa thấy toạ độ nào.";
        msg.className = ar ? "ma-msg" : "ma-msg bad";
      });
      panel.querySelector(".ma-close").onclick = function(){ panel.hidden = true; };
      panel.querySelector(".ma-clear").onclick = function(){ save([]); draw(); };
      panel.querySelector(".ma-draw").onclick = function(){
        var msg = panel.querySelector(".ma-msg"), txt = panel.querySelector(".ma-txt").value;
        var area = window.__ma.parse(txt), bt = panel.querySelector(".ma-band").value, band = window.__ma.band(bt);
        if(!area){ msg.textContent = "Không tìm thấy toạ độ nào trong nội dung dán. Xem các kiểu viết được hỗ trợ ở trên."; msg.className = "ma-msg bad"; return; }
        if(bt.trim() && !band){ msg.textContent = "Độ cao chưa đúng dạng (VD: SFC-FL240, FL100-FL300)."; msg.className = "ma-msg bad"; return; }
        var a = {name: panel.querySelector(".ma-name").value.trim(), area: area, band: band};
        var l = load(); l.push(a); save(l);
        msg.textContent = "Đã vẽ " + desc(area) + "."; msg.className = "ma-msg";
        draw(); zoom(a);
      };
    }
    if(name != null) panel.querySelector(".ma-name").value = name;
    if(text != null){
      panel.querySelector(".ma-txt").value = text;
      var bm = /\b(SFC|GND|FL\s?\d{2,3}|\d{3,5}\s?FT)\s*(?:-|TO)\s*(FL\s?\d{2,3}|UNL|\d{3,5}\s?FT)/i.exec(text);
      panel.querySelector(".ma-band").value = bm ? bm[0] : "";
      panel.querySelector(".ma-txt").dispatchEvent(new Event("input"));
    }
    panel.hidden = false; list();
    var ta = panel.querySelector(".ma-txt"); ta.focus();
  }
  window.nmManualAreaOpen = open;
  function addCtl(){
    var m = map(); if(!m || !window.L){ return false; }
    if(m._maCtl) return true;
    var Ctl = L.Control.extend({options:{position:"topright"}, onAdd:function(){
      var d = L.DomUtil.create("div", "leaflet-bar ma-ctl");
      d.innerHTML = '<button type="button" title="Dán toạ độ vùng cấm/hạn chế để vẽ và kiểm tra đường bay">📍 Dán toạ độ</button>';
      L.DomEvent.disableClickPropagation(d);
      d.firstChild.onclick = function(){ open(); };
      return d;
    }});
    m._maCtl = new Ctl().addTo(m);
    draw();
    return true;
  }
  setInterval(function(){
    addCtl();
    var sig = track().length + ":" + ((track()[0] || {}).name || "");
    if(sig !== addCtl._sig){ addCtl._sig = sig; draw(); }
  }, 1500);
  // Clicking a blinking UNIDENTIFIED AREA label opens the panel prefilled with that NOTAM.
  document.addEventListener("click", function(ev){
    var t = ev.target && ev.target.closest && ev.target.closest(".nm-unid");
    if(!t) return;
    ev.preventDefault(); ev.stopPropagation();
    var card = t.closest(".nm-item, [data-ident]");
    var text = card ? card.innerText : "";
    var id = (card && card.dataset.ident) || (/\b[A-Z]\d{3,4}\/\d{2}\b/.exec(text) || [""])[0];
    open(id, text.replace(/⚠ UNIDENTIFIED AREA/g, "").trim());
  }, true);
})();
