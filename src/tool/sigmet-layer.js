// SIGMET + Volcanic Ash overlays on the NOTAM map (NOAA AWC international SIGMETs).
// Uses window.__ma.check (manual-area) to measure each area against the current OFP track.
(function(){
  var stormAge = document.getElementById("nmStormAge");
  if(!stormAge) return;
  var HZ = {
    TS:   {c:"#dc2626", f:"#ef4444", t:"Dông (TS)"},
    TURB: {c:"#d97706", f:"#f59e0b", t:"Nhiễu động (TURB)"},
    ICE:  {c:"#0284c7", f:"#38bdf8", t:"Đóng băng (ICE)"},
    MTW:  {c:"#7c3aed", f:"#a78bfa", t:"Sóng núi (MTW)"},
    TC:   {c:"#be185d", f:"#ec4899", t:"Bão nhiệt đới (TC)"},
    VA:   {c:"#57250b", f:"#78716c", t:"Tro bụi núi lửa (VA)"}
  };
  var hz = function(h){ return HZ[h] || {c:"#475569", f:"#94a3b8", t:h || "SIGMET"}; };
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function map(){ try{ if(typeof nmEnsureMap === "function") nmEnsureMap(); return typeof nmMap !== "undefined" ? nmMap : null; }catch(e){ return null; } }
  function track(){ try{ return (typeof nmTrackData !== "undefined" && nmTrackData && !nmTrackData.fleet_src && nmTrackData.track) || []; }catch(e){ return []; } }
  function cfg(){ try{ return (typeof nmAssessCfg === "function" ? nmAssessCfg() : {}) || {}; }catch(e){ return {}; } }
  function z(t){ var d = new Date(t * 1000), p = function(n){ return String(n).padStart(2, "0"); }; return p(d.getUTCDate()) + "/" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + "Z"; }
  function flTxt(it){
    var b = it.base_fl, t = it.top_fl;
    var f = function(v){ return v === 0 ? "SFC" : "FL" + String(v).padStart(3, "0"); };
    if(b == null && t == null) return "—";
    if(b == null) return "đến " + f(t);
    if(t == null) return "từ " + f(b);
    return f(b) + " – " + f(t);
  }

  var css = document.createElement("style");
  css.textContent = ".nm-sg-pop{font:13px/1.45 system-ui;min-width:260px;max-width:380px}"
    + ".nm-sg-pop .h{display:flex;align-items:center;gap:8px;margin-bottom:6px}"
    + ".nm-sg-pop .tag{padding:2px 9px;border-radius:999px;color:#fff;font:800 11px/1.5 system-ui}"
    + ".nm-sg-pop .fir{font-weight:800;color:#0f172a}"
    + ".nm-sg-pop table{border-collapse:collapse;width:100%;margin:4px 0 6px}"
    + ".nm-sg-pop td{padding:2px 4px;border-bottom:1px solid #eef2f7;vertical-align:top}"
    + ".nm-sg-pop td:first-child{color:#64748b;width:86px;white-space:nowrap}"
    + ".nm-sg-pop .hit{margin:4px 0;padding:5px 8px;border-radius:8px;background:#fef2f2;color:#b91c1c;font-weight:700}"
    + ".nm-sg-pop .near{margin:4px 0;padding:5px 8px;border-radius:8px;background:#f1f5f9;color:#334155}"
    + ".nm-sg-pop pre{margin:0;max-height:180px;overflow:auto;white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:8px;border-radius:8px;font:11.5px/1.45 ui-monospace,monospace}"
    + ".nm-sg-hit{animation:nmSgBlink 1.1s ease-in-out infinite}"
    + "@keyframes nmSgBlink{0%,100%{stroke-opacity:1;fill-opacity:.38}50%{stroke-opacity:.35;fill-opacity:.12}}"
    + ".nm-sg-volc{font-size:22px;line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.45))}"
    + ".leaflet-tooltip.nm-sg-lab{background:#fff;border:1px solid #57250b;color:#57250b;font:800 11px/1.3 system-ui;padding:2px 6px}";
  document.head.appendChild(css);

  function mkBtn(id, label, title){
    var b = document.createElement("button");
    b.type = "button"; b.className = "nm-sky"; b.id = id; b.textContent = label; b.title = title;
    b.setAttribute("aria-pressed", "false"); b.style.cursor = "pointer";
    var a = document.createElement("span");
    a.id = id + "Age"; a.className = "nm-radar-age mid"; a.hidden = true;
    return [b, a];
  }
  var sg = mkBtn("nmSigmet", "SIGMET", "SIGMET quốc tế đang hiệu lực (NOAA AWC): dông, nhiễu động, đóng băng, sóng núi, bão");
  var va = mkBtn("nmVa", "Tro bụi", "Tro bụi núi lửa: SIGMET VA theo khuyến cáo VAAC Darwin/Tokyo, kèm vị trí núi lửa");
  stormAge.after(sg[0], sg[1], va[0], va[1]);

  var data = null, loading = null, at = 0, timer = 0;
  var on = {sg:false, va:false}, groups = {sg:null, va:null};
  var isVa = function(it){ return it.hazard === "VA"; };

  function measure(it){
    var tr = track();
    if(!tr.length || !window.__ma || !window.__ma.check) return null;
    var c = cfg(), pad = Math.round((+c.alt_buffer_ft || 0) / 100);
    var band = [Math.max(0, (it.base_fl == null ? 0 : it.base_fl) - pad), (it.top_fl == null ? 999 : it.top_fl + pad)];
    var pts = tr.map(function(p){ return {lat:+p.lat, lon:+p.lon, fl_ft:+p.fl_ft || 0, name:p.name}; });
    var best = null;
    it.rings.forEach(function(ring){
      var r = window.__ma.check({shape:"polygon", ring:ring}, pts, band);
      if(r && r.dist_nm != null && (!best || r.dist_nm < best.dist_nm)) best = r;
    });
    if(!best) return null;
    var cor = +c.corridor_nm || 20;
    best.hit = best.dist_nm <= cor && best.flHit !== false;
    best.cor = cor;
    return best;
  }

  function popup(it, m){
    var h = hz(it.hazard);
    var mv = it.dir ? it.dir + (it.spd ? " " + it.spd + "KT" : "") : (/\bSTNR\b/.test(it.raw) ? "Đứng yên" : "—");
    var chg = {NC:"Không đổi", INTSF:"Mạnh lên", WKN:"Yếu đi"}[it.chng] || it.chng || "—";
    var meas = "";
    if(m){
      var where = m.name ? " gần " + esc(m.name) + (m.fl ? " FL" + m.fl : "") : "";
      if(m.hit) meas = '<div class="hit">⛔ ' + (m.inside ? "Đường bay CẮT QUA vùng" : "Cách vùng " + m.dist_nm.toFixed(1) + " NM") + where + (m.flHit === null ? " — kiểm tra độ cao tay" : " — trong dải độ cao") + "</div>";
      else meas = '<div class="near">' + (m.dist_nm <= m.cor ? "Gần route" + where + " nhưng ngoài dải độ cao" : "Cách route " + m.dist_nm.toFixed(0) + " NM") + "</div>";
    }
    return '<div class="nm-sg-pop"><div class="h"><span class="tag" style="background:' + h.c + '">' + esc(h.t) + '</span><span class="fir">' + esc(it.fir_name || it.fir) + "</span></div>" + meas
      + "<table><tr><td>Hiện tượng</td><td>" + esc((it.qualifier ? it.qualifier + " " : "") + it.hazard) + (it.kind === "fcst" ? " · <b>VỊ TRÍ DỰ BÁO</b>" : "") + "</td></tr>"
      + "<tr><td>Độ cao</td><td><b>" + flTxt(it) + "</b></td></tr>"
      + "<tr><td>Hiệu lực</td><td>" + z(it.from) + " → " + z(it.to) + "</td></tr>"
      + "<tr><td>Di chuyển</td><td>" + esc(mv) + "</td></tr>"
      + "<tr><td>Cường độ</td><td>" + esc(chg) + "</td></tr></table>"
      + "<pre>" + esc(it.raw) + "</pre></div>";
  }

  function draw(which){
    var g = groups[which];
    if(!g) return {n:0, hit:0};
    g.clearLayers();
    var list = ((data && data.items) || []).filter(function(it){ return which === "va" ? isVa(it) : !isVa(it); });
    var hits = 0, volc = {};
    list.forEach(function(it){
      var h = hz(it.hazard), m = measure(it), fc = it.kind === "fcst";
      if(m && m.hit) hits++;
      it.rings.forEach(function(ring){
        var poly = L.polygon(ring, {
          color: h.c, weight: m && m.hit ? 3.5 : 2, opacity: .95,
          fillColor: h.f, fillOpacity: fc ? .08 : (which === "va" ? .32 : .2),
          dashArray: fc ? "8 6" : null, className: m && m.hit ? "nm-sg-hit" : ""
        });
        poly.bindPopup(function(){ return popup(it, measure(it)); }, {maxWidth: 400});
        poly.bindTooltip(h.t + " · " + flTxt(it) + (fc ? " · dự báo" : ""), {sticky: true, direction: "top"});
        poly.addTo(g);
      });
      if(it.volcano && !volc[it.volcano.name]){
        volc[it.volcano.name] = 1;
        L.marker([it.volcano.lat, it.volcano.lon], {
          icon: L.divIcon({className: "nm-sg-volc", html: "🌋", iconSize: [24, 24], iconAnchor: [12, 12]})
        }).bindTooltip(it.volcano.name, {permanent: true, direction: "right", offset: [10, 0], className: "nm-sg-lab"})
          .bindPopup(function(){ return popup(it, measure(it)); }, {maxWidth: 400}).addTo(g);
      }
    });
    return {n: list.length, hit: hits};
  }

  function paint(which, res){
    var btn = which === "va" ? va[0] : sg[0], age = which === "va" ? va[1] : sg[1];
    var base = which === "va" ? "Tro bụi" : "SIGMET";
    var n = res ? res.n : 0;
    btn.textContent = base + (data && !data.error ? " (" + n + ")" : "");
    age.hidden = !on[which];
    if(!on[which]) return;
    if(!data){ age.className = "nm-radar-age mid"; age.textContent = "đang tải…"; return; }
    if(data.error){ age.className = "nm-radar-age bad"; age.textContent = "lỗi SIGMET"; age.title = data.error; return; }
    var mins = Math.max(0, Math.round((Date.now() - Date.parse(data.at || "")) / 60000)) || 0;
    if(res && res.hit){ age.className = "nm-radar-age bad"; age.textContent = res.hit + " vùng dính route"; }
    else if(n){ age.className = "nm-radar-age fresh"; age.textContent = track().length ? "không dính route" : n + " vùng · " + mins + "p trước"; }
    else { age.className = "nm-radar-age fresh"; age.textContent = which === "va" ? "không có tro bụi" : "không có SIGMET"; }
    age.title = (data.source || "NOAA AWC") + " · cập nhật " + mins + " phút trước" + (data.warning ? " — " + data.warning : "");
  }

  function repaint(){
    ["sg", "va"].forEach(function(w){ paint(w, on[w] ? draw(w) : {n: ((data && data.items) || []).filter(function(it){ return w === "va" ? isVa(it) : !isVa(it); }).length}); });
  }

  function load(force){
    if(loading) return loading;
    loading = fetch("/api/wx/sigmet" + (force ? "?refresh=1" : ""), {cache: "no-store"})
      .then(function(r){ return r.json(); })
      .then(function(j){ if(!j.error || !data) data = j; at = Date.now(); })
      .catch(function(e){ if(!data) data = {items: [], error: String(e && e.message || e)}; })
      .then(function(){ loading = null; repaint(); });
    return loading;
  }

  function fit(which){
    var m = map(), g = groups[which];
    if(!m || !g || track().length) return;
    try{ var b = g.getBounds(); if(b && b.isValid() && !m.getBounds().intersects(b)) m.fitBounds(b.pad(0.2)); }catch(e){}
  }

  function toggle(which){
    var m = map();
    if(!m || typeof L === "undefined"){ (which === "va" ? va[1] : sg[1]).hidden = false; (which === "va" ? va[1] : sg[1]).textContent = "chưa có bản đồ"; return; }
    on[which] = !on[which];
    var btn = which === "va" ? va[0] : sg[0];
    btn.classList.toggle("on", on[which]);
    btn.setAttribute("aria-pressed", on[which] ? "true" : "false");
    if(!groups[which]) groups[which] = L.layerGroup();
    if(on[which]){
      groups[which].addTo(m);
      paint(which, null);
      var fresh = data && Date.now() - at < 120000;
      (fresh ? Promise.resolve() : load()).then(function(){ repaint(); fit(which); });
    }else m.removeLayer(groups[which]);
    if((on.sg || on.va) && !timer) timer = setInterval(function(){ load(); }, 300000);
    if(!on.sg && !on.va && timer){ clearInterval(timer); timer = 0; }
  }
  sg[0].addEventListener("click", function(){ toggle("sg"); });
  va[0].addEventListener("click", function(){ toggle("va"); });

  // Re-measure when the selected flight's track changes.
  var sig = "";
  setInterval(function(){
    if(!on.sg && !on.va) return;
    var t = track(), s = t.length ? t.length + ":" + t[0].lat + ":" + t[t.length - 1].lon : "";
    if(s !== sig){ sig = s; repaint(); }
  }, 3000);

  load();
})();
