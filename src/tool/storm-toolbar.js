(function(){
  const head = document.querySelector('.nm-track-head');
  const btn = document.getElementById('nmStorm');
  if(!head || !btn) return;
  const slider = document.createElement('input');
  slider.type = 'range'; slider.id = 'nmToolbarScroll';
  slider.min = '0'; slider.max = '0'; slider.value = '0'; slider.step = '1';
  slider.setAttribute('aria-label', 'Kéo thanh công cụ qua trái hoặc phải');
  head.insertAdjacentElement('afterend', slider);
  function sync(){
    const max = Math.max(0, head.scrollWidth - head.clientWidth);
    slider.max = String(max); slider.value = String(head.scrollLeft);
    slider.disabled = max < 1;
  }
  slider.addEventListener('input', function(){ head.scrollLeft = Number(slider.value); });
  head.addEventListener('scroll', sync, {passive:true});
  window.addEventListener('resize', sync);
  new ResizeObserver(sync).observe(head);
  new MutationObserver(sync).observe(head, {childList:true,subtree:true,characterData:true,attributes:true});
  sync();

  // JTWC-style track: colour by intensity, past track solid, forecast dashed, labelled points.
  function ktColor(k){ return !k ? '#e5e7eb' : k < 34 ? '#38bdf8' : k < 64 ? '#facc15' : k < 130 ? '#ef4444' : '#d946ef'; }
  nmDrawStorms = function(pack){
    if(!nmStormGroup) return;
    nmStormGroup.clearLayers();
    const feats = (pack && pack.features) || [];
    feats.forEach(function(f){
      const p = f.properties || {}, g = f.geometry || {};
      if(g.type === 'Point'){
        if(p.radiusM) return;
        const ll = [g.coordinates[1], g.coordinates[0]];
        const past = p.track === 'past';
        const m = L.circleMarker(ll, {radius: past ? 4 : 7, color: '#111827', weight: 1.5, fillColor: past ? '#9ca3af' : ktColor(p.kts), fillOpacity: 1});
        if(p.label && !past) m.bindTooltip(p.label, {permanent: true, direction: 'right', className: 'nm-storm-lbl', offset: [8,0]});
        else m.bindTooltip(p.name || p.label || '');
        m.addTo(nmStormGroup);
        return;
      }
      L.geoJSON(f, {style: function(){
        const poly = /Polygon/.test(g.type);
        if(poly) return {color: p.stroke || '#f59e0b', weight: 1.5, opacity: .9, fillColor: p.fill || '#f59e0b', fillOpacity: p.fillOpacity == null ? .15 : Math.min(.25, p.fillOpacity)};
        const past = p.track === 'past';
        return {color: past ? '#6b7280' : '#ef4444', weight: past ? 2.5 : 3, opacity: .95, dashArray: past ? null : '8 6'};
      }, onEachFeature: function(_, l){ if(p.name) l.bindTooltip(p.name); }}).addTo(nmStormGroup);
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