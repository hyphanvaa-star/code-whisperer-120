(function(){
  const head = document.querySelector('.nm-track-head');
  const btn = document.getElementById('nmStorm');
  if(!head || !btn) return;
  function arrow(dir){
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'nm-th-arrow nm-th-' + (dir < 0 ? 'l' : 'r');
    b.textContent = dir < 0 ? '◀' : '▶';
    b.setAttribute('aria-label', dir < 0 ? 'Cuộn thanh công cụ sang trái' : 'Cuộn thanh công cụ sang phải');
    b.addEventListener('click', function(e){ e.stopPropagation(); head.scrollBy({left: dir * Math.max(160, head.clientWidth * 0.6), behavior:'smooth'}); });
    return b;
  }
  const left = arrow(-1), right = arrow(1);
  head.insertBefore(left, head.firstChild); head.appendChild(right);
  function sync(){
    const max = head.scrollWidth - head.clientWidth;
    left.hidden = head.scrollLeft < 2;
    right.hidden = max < 2 || head.scrollLeft >= max - 2;
  }
  head.addEventListener('wheel', function(e){
    if(head.scrollWidth <= head.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    head.scrollLeft += e.deltaY; e.preventDefault();
  }, {passive:false});
  head.addEventListener('scroll', sync, {passive:true});
  window.addEventListener('resize', sync);
  new ResizeObserver(sync).observe(head);
  sync();

  // Kiểu JTWC/Google Earth: vòng bán kính gió tô hồng trong mờ, vùng nguy hiểm viền đỏ đậm,
  // tâm bão biểu tượng xoáy đỏ, đường đã qua vàng chấm xám, nhãn "22/06Z - 105 knots".
  const CYC = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#e11d1d" stroke="#7f1d1d" stroke-width=".6" d="M12 7.2a4.8 4.8 0 1 0 0 9.6a4.8 4.8 0 1 0 0-9.6zm0 2.6a2.2 2.2 0 1 1 0 4.4a2.2 2.2 0 1 1 0-4.4zM15.6 8.6C15 4.6 11.4 2.6 7.6 3.4c2.6.6 4.6 2.2 5.2 4.6zM8.4 15.4c.6 4 4.2 6 8 5.2c-2.6-.6-4.6-2.2-5.2-4.6z"/></svg>';
  const cycIcon = (L && L.divIcon) ? L.divIcon({html: CYC, className: 'nm-cyc', iconSize: [22,22], iconAnchor: [11,11]}) : null;
  function lbl(p){
    const t = String(p.when || p.name || '').split(' ·')[0].split(',')[0].trim();
    const k = p.kts ? p.kts + 'KTS' : '';
    return [t, k].filter(Boolean).join(', ');
  }
  nmDrawStorms = function(pack){
    if(!nmStormGroup) return;
    nmStormGroup.clearLayers();
    const feats = ((pack && pack.features) || []).slice();
    const rank = f => { const p = f.properties||{}, t = (f.geometry||{}).type||''; return p.swath ? 0 : /Polygon/.test(t) ? (p.radii ? 10 - p.radii/10 : 1) : t === 'LineString' ? 20 : 30; };
    feats.sort((a,b) => rank(a) - rank(b));
    feats.forEach(function(f){
      const p = f.properties || {}, g = f.geometry || {};
      if(g.type === 'Point'){
        if(p.radiusM) return;
        const ll = [g.coordinates[1], g.coordinates[0]];
        const past = p.track === 'past';
        let m;
        if(past) m = L.circleMarker(ll, {radius: 4, color: '#4b5563', weight: 1, fillColor: '#9ca3af', fillOpacity: 1});
        else if(cycIcon) m = L.marker(ll, {icon: cycIcon, interactive: true});
        else m = L.circleMarker(ll, {radius: 6, color: '#7f1d1d', weight: 1.5, fillColor: '#e11d1d', fillOpacity: 1});
        const text = lbl(p);
        if(text && !past) m.bindTooltip(text, {permanent: true, direction: 'top', className: 'nm-storm-lab', offset: [0,-10]});
        else m.bindTooltip(text || p.name || '');
        m.addTo(nmStormGroup);
        return;
      }
      L.geoJSON(f, {style: function(){
        const poly = /Polygon/.test(g.type);
        if(poly && p.swath) return {color: '#3f6666', weight: 2, opacity: .9, fillColor: '#7faaaa', fillOpacity: .45};
        if(poly && p.radii){
          const c = p.radii >= 64 ? '#9d174d' : p.radii >= 50 ? '#be185d' : '#d63384';
          return {color: c, weight: 1.2, opacity: .9, fillColor: p.radii >= 64 ? '#f9a8d4' : '#fbcfe8', fillOpacity: p.radii >= 64 ? .3 : p.radii >= 50 ? .22 : .15};
        }
        if(poly) return {color: p.stroke || '#d63384', weight: 1.2, opacity: .9, fillColor: '#fbcfe8', fillOpacity: .15};
        const past = p.track === 'past';
        return {color: past ? '#eab308' : '#dc2626', weight: past ? 3 : 2, opacity: .95};
      }, onEachFeature: function(_, l){
        const tip = p.radii ? (String(p.when || '').trim() + ' · Bán kính gió ' + p.radii + ' knots').replace(/^ · /, '') : p.swath ? 'Vùng nguy hiểm gió 34 knots' : p.name;
        if(tip) l.bindTooltip(tip, {sticky: true});
      }}).addTo(nmStormGroup);
    });
  };
  let last = null, loading = false;
  nmPaintStormAge = function(pack){
    const age = document.getElementById('nmStormAge');
    const storms = (pack && pack.storms) || [];
    const names = storms.map(s => s.label || s.name).filter(Boolean);
    const hasMap = !!(pack && pack.features && pack.features.length);
    const error = pack && pack.error;
    btn.textContent = 'Bão' + (names.length ? ' ' + names.join(' · ') : '');
    btn.title = names.join(' · ') + (pack && pack.source ? ' — ' + pack.source : '') + (pack && pack.warning ? ' — ' + pack.warning : '');
    if(!age) return;
    age.hidden = !nmStormOn;
    age.className = 'nm-radar-age ' + (error ? 'bad' : hasMap ? 'fresh' : 'mid');
    age.textContent = error ? 'lỗi dữ liệu bão' : hasMap ? pack.source || 'đã cập nhật' : names.length ? 'chưa có bản đồ' : 'không có bão';
    age.title = error || (pack && pack.warning) || btn.title;
    sync();
  };
  nmLoadStorms = async function(opt){
    if(loading) return;
    if(last && nmStormOn){ nmDrawStorms(last); nmPaintStormAge(last); }
    loading = true;
    try{
      const r = await fetch('/api/wx/storms' + (opt && opt.refresh ? '?refresh=1' : ''));
      if(!r.ok) throw new Error('Không tải được dữ liệu bão');
      const pack = await r.json();
      if(!pack.error) last = pack;
      nmPaintStormAge(pack);
      if(nmStormOn){ nmDrawStorms(pack); if(opt && opt.fit) nmRevealStorms(); }
    }catch(e){
      if(last) nmPaintStormAge(Object.assign({}, last, {warning:'Chưa làm mới được dữ liệu bão'}));
      else nmPaintStormAge({error:String(e && e.message || e)});
    }finally{ loading = false; }
  };
  // Name updates are independent of the map visibility toggle.
  nmLoadStorms();
  setInterval(function(){ nmLoadStorms(); }, 300000);
})();