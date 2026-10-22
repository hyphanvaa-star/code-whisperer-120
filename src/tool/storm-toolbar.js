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