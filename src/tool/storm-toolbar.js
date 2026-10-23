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