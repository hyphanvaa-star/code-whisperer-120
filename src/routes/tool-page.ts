import { createFileRoute } from "@tanstack/react-router";
import icaoCountries from "@/lib/tool/data/icao-countries.json";
import dispatchSkyHeader from "@/assets/dispatch-sky-header.jpg";
import dispatchAirportClean from "@/assets/vietjet-starlink-header-web.jpg?inline";
import vietjetLogo from "@/assets/vj-logo.png";
import notamGeometryFixes from '@/tool/notam-geometry.js?raw';
import checklistScript from '@/tool/checklist.js?raw';
import checklistEdtoAsset from '@/assets/checklist-edto.asset.json';
import formMnlScript from '@/tool/formmnl.js?raw';
import formMnlAsset from '@/assets/form-mnl.asset.json';
import mnlSigAsset from '@/assets/mnl-signature.asset.json';
import aftnAddresses from '@/tool/aftn-addresses.txt?raw';
import aftnBookScript from '@/tool/aftn-book.js?raw';
import khbEzfwScript from '@/tool/khb-ezfw.js?raw';
import khbPilotNameScript from '@/lib/khb-pilot-name.js?raw';
import specialRulesScript from '@/lib/special-rules.js?raw';
import stormToolbarScript from '@/tool/storm-toolbar.js?raw';
import databaseTabScript from '@/tool/database-tab.js?raw';
import manualAreaScript from '@/tool/manual-area.js?raw';
import aimsCrewlistScript from '@/tool/aims-crewlist.js?raw';
import ofpCheckModalScript from '@/tool/ofp-check-modal.js?raw';
import { maParse, maBand, maCheck } from '@/lib/tool/port/manual_area';
import { enrCatalogue } from '@/lib/tool/port/aip_enr_catalog';
import { auDahCatalogue } from '@/lib/tool/port/au_dah_catalog';
import { airportCatalogue } from '@/lib/tool/port/airport_catalogue';
import { notamCounts } from '@/lib/tool/port/notam_counts';
import { bpParsePack, bpWebIds, bpCompare, bpNewIds, bpDueRescan } from '@/lib/tool/port/briefing_pack';
import { patchFlightRefreshPage } from '@/lib/tool/port/flight_refresh';
import { patchAccountMemoryPage } from '@/lib/tool/port/account_memory';
import { patchFlightIdentityPage } from '@/lib/tool/port/flight_identity_page';
import { patchKhbPayloadPage } from '@/lib/tool/port/khb_payload';
import { patchKhbCrewSyncPage } from '@/lib/tool/port/khb_crew_sync';
import { patchCmpValidationPage } from '@/lib/tool/port/cmp_validation';
import { patchCmpBatchPage } from '@/lib/tool/port/cmp_batch';
import { patchCmpDspFastPage } from '@/lib/tool/port/cmp_dsp_fast';
import { patchKhbAirportHoverPage } from '@/lib/tool/port/khb_airport_hover';
import { patchCmpCrewHoverPage } from '@/lib/tool/port/cmp_crew_hover';
import { patchNotamChangePopupPage } from '@/lib/tool/port/notam_change_popup';
import { patchDefectSourcePage } from '@/lib/tool/port/defect_source_page';
import { assessedVerdict } from '@/lib/tool/port/notam_summary';

// Serves the original Dispatch Board screen (web.py PAGE) unchanged, plus a tiny
// shim that attaches the signed-in user's token to every /api/ call. The old
// local passcode popup was removed — the web app's own login is the only gate.
const SHIM = `<script>
(function(){
  window.__WEB_AUTH = true;
  // Tự co giao diện theo độ rộng màn hình (màn hình nhỏ / Windows scale 125–150%).
  (function(){
    var BASE = 1800;
    function fit(){
      var w = window.innerWidth || BASE;
      var z = Math.max(0.67, Math.min(1, w / BASE));
      document.documentElement.style.zoom = z < 0.99 ? String(z) : "";
      document.documentElement.style.setProperty('--taf-read-scale', String(z < 0.99 ? 1 / z : 1));
    }
    fit();
    window.addEventListener("resize", fit);
  })();
  if (window.parent === window) { location.replace('/tool'); return; }
  function tok(){ try { return window.parent.__fbToken ? window.parent.__fbToken() : null; } catch(e){ return null; } }
  function isApi(u){ return typeof u === 'string' && (u.indexOf('/api/') === 0 || u.indexOf(location.origin + '/api/') === 0); }
  var of = window.fetch.bind(window);
  // Token hết hạn (tab để lâu, máy ngủ) -> xin parent làm mới phiên rồi gửi lại,
  // chỉ khi làm mới thất bại mới về trang đăng nhập (không reload cứng trang).
  var refreshing = null;
  function refreshTok(){
    if (!refreshing) {
      refreshing = Promise.resolve().then(function(){
        try { return window.parent.__fbRefresh ? window.parent.__fbRefresh() : null; } catch(e){ return null; }
      }).catch(function(){ return null; }).finally(function(){ setTimeout(function(){ refreshing = null; }, 3000); });
    }
    return refreshing;
  }
  function withTok(input, init, t){
    init = Object.assign({}, init || {});
    var h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
    if (t) h.set('Authorization', 'Bearer ' + t);
    init.headers = h;
    return init;
  }
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var api = isApi(url);
    var canRetry = api && (!init || !init.body || typeof init.body === 'string' || init.body instanceof FormData || init.body instanceof Blob || init.body instanceof URLSearchParams);
    var first = api ? withTok(input, init, tok()) : init;
    return of(input, first).then(async function(r){
      if (r.status === 401 && api) {
        var nt = await refreshTok();
        if (nt) {
          setCookie();
          if (canRetry) {
            var r2 = await of(input, withTok(input, init, nt));
            if (r2.status !== 401) { r = r2; }
            else { try { window.parent.__fbExpired && window.parent.__fbExpired(); } catch(e){} return r2; }
          }
        } else {
          try { window.parent.__fbExpired && window.parent.__fbExpired(); } catch(e){}
        }
      }
      if(r.ok && (url.endsWith('/api/excel/upload') || url.endsWith('/api/excel/select')) && String((init && init.method) || '').toUpperCase() === 'POST'){
        try {
          var changed = await r.clone().json();
          if(!changed.error && typeof ftCrewChanged === 'function') ftCrewChanged();
        } catch(e){}
      }
      return r;
    });
  };
  function setCookie(){ var t = tok(); if (t) document.cookie = 'fbt=' + t + '; path=/api; SameSite=Strict; Secure'; }
  setCookie(); setInterval(setCookie, 20000);
  if (navigator.sendBeacon) { navigator.sendBeacon = function(){ return true; }; }
  // Fit-to-screen: the original layout is designed for ~1440px desktops.
  // On smaller screens, scale the whole page down proportionally so nothing
  // overflows or breaks apart; on larger screens keep 100%. The needed width
  // is measured from the real content (not assumed), so late-loading fonts
  // or images cannot push buttons off-screen.
  var BASE_W = 1440;
  function fit(){
    var de = document.documentElement, b = document.body;
    if (!b) return;
    b.style.zoom = ''; b.style.transform = ''; b.style.width = '';
    var need = Math.max(de.scrollWidth, b.scrollWidth, BASE_W);
    // Fixed/absolute rows (header buttons, switches) may not expand
    // scrollWidth — measure the real right edge of every element instead.
    var els = b.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width > 0 && r.width < 4000 && r.right > need) need = r.right;
    }
    var z = Math.min(1, window.innerWidth / need);
    // Điện thoại: không thu nhỏ quá mức đọc được — giữ sàn zoom và cho
    // vuốt ngang phần còn lại. Máy tính/bảng lớn giữ nguyên hành vi cũ.
    var isPhone = window.innerWidth < 820;
    if (isPhone) z = Math.max(z, 0.5);
    de.style.setProperty('--account-body-scale', String(z < 0.999 ? 1 / z : 1));
    // Narrow-screen CSS keys off viewport width; while zoom-fit is active the
    // real layout width is innerWidth/z, so mark <html> and disable those rules.
    de.classList.toggle('fit-scaled', z < 0.999);
    if (z >= 0.999) { de.style.overflowX = ''; return; }
    if ('zoom' in b.style) {
      // zoom already reflows the layout viewport; do NOT also set width.
      b.style.zoom = z;
    } else {
      b.style.transformOrigin = '0 0';
      b.style.transform = 'scale(' + z + ')';
      b.style.width = (100 / z) + '%';
    }
    de.style.overflowX = isPhone ? 'auto' : 'hidden';
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  window.addEventListener('load', function(){
    // Keep the review above hover panels, including on zoom-fitted desktops.
    // Observe only its open state; never replace existing Send/Copy handlers.
    var atcReview=document.getElementById('ftAtcModal');
    if(atcReview){
      var syncAtcReview=function(){
        document.documentElement.classList.toggle('atc-review-open',atcReview.classList.contains('open'));
      };
      syncAtcReview();
      new MutationObserver(syncAtcReview).observe(atcReview,{attributes:true,attributeFilter:['class']});
    }
    var room=document.getElementById('mdRoom'), actions=document.querySelector('.filt-actions');
    if(room && actions && actions.parentElement!==room) room.appendChild(actions);
    // EFB field lives in the Tạo KHB tab, right next to the Dispatcher box.
    if(!document.getElementById('fEfb')){
      var ftDsp=document.getElementById('ftDspBox');
      if(ftDsp){
        var efbField=document.createElement('label');
        efbField.className='ftdsp ftefb';
        efbField.innerHTML='EFB : <input type="text" id="fEfb" placeholder="EFB-01" autocomplete="off" spellcheck="false">';
        ftDsp.closest('label').insertAdjacentElement('afterend', efbField);
        var efbInput=efbField.querySelector('#fEfb');
        try{ efbInput.value=localStorage.getItem('fb_efb')||''; }catch(e){}
        efbInput.addEventListener('input', function(){ try{ localStorage.setItem('fb_efb', this.value); }catch(e){} });
        // Nút ↻: lấy mã EFB qua trợ lý PC (mở Outlook trên máy công ty) —
        // chỉ chạy khi người dùng bấm, không tự chạy khi mở trang.
        var efbBtn=document.createElement('button');
        efbBtn.type='button';
        efbBtn.className='efb-refresh';
        efbBtn.title='Lấy mã EFB mới nhất từ mail hộp thư chung (qua trợ lý PC)';
        efbBtn.textContent='↻';
        efbBtn.addEventListener('click', function(){
          efbBtn.disabled=true;
          fetch('/api/efb/latest?pc=1').then(function(r){return r.json();}).then(function(d){
            efbBtn.disabled=false;
            if(d && d.value){
              efbInput.value=d.value;
              try{ localStorage.setItem('fb_efb', d.value); }catch(e){}
            }else{
              alert((d && d.error) || 'Không đọc được mail EFB từ hộp thư chung.');
            }
          }).catch(function(){ efbBtn.disabled=false; });
        });
        efbField.appendChild(efbBtn);
        // Hook cho page.html gọi sau khi đăng nhập OWA thành công:
        // tự lấy mã EFB qua trợ lý PC nếu ô còn trống.
        // Luôn lấy mã EFB mới nhất (qua phiên Outlook Web của trợ lý) và điền đè khi khác mã đang có.
        var efbApply=function(d){
          if(d && d.value && d.value!==efbInput.value){
            efbInput.value=d.value;
            try{ localStorage.setItem('fb_efb', d.value); }catch(e){}
          }
        };
        window.__efbAutoFill=function(){
          fetch('/api/efb/latest?pc=1').then(function(r){return r.json();}).then(efbApply).catch(function(){});
        };
        window.__efbAutoFill();
        setInterval(window.__efbAutoFill, 30*60*1000);
      }
    }
    // Cảnh báo thiếu mã EFB giống cảnh báo thiếu tên DSP khi Tạo KHB.
    if(typeof window.ftBuild==='function' && !window.ftBuild.__efbWrapped){
      var origFtBuild=window.ftBuild;
      var wrappedFtBuild=function(write){
        var eb=document.getElementById('fEfb');
        if(eb && !(eb.value||'').trim()){
          alert('Chưa có mã EFB — không đọc được từ mail EFB hộp thư chung, hãy điền tay vào ô EFB.');
          var st=document.getElementById('ftStat');
          if(st) st.textContent='Chưa có mã EFB.';
          eb.focus();
          return;
        }
        return origFtBuild(write);
      };
      wrappedFtBuild.__efbWrapped=true;
      window.ftBuild=wrappedFtBuild;
    }
    if(room && !room.querySelector('.ops-field-icon')){
      var iconSvg=function(paths){return '<span class="ops-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg></span>';};
      var fieldIcons={
        fDispatcher:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
        fCallsign:'<path d="M4 14.5v-3a8 8 0 0 1 16 0v3"/><path d="M18 19h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v3a4 4 0 0 1-4 4h-1"/><path d="M6 19H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h2v5a2 2 0 0 1-2 2"/>',
        fDep:'<path d="M10.5 21 14 11l7-7-10 3.5L4 4l2.5 7L3 14l7.5-3Z"/>',
        fDest:'<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
        fReg:'<path d="M2 16h20L13 9V4l-2-1-1 6-4-2-2 1 3 4-5 2Z"/>',
        fWindow:'<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
        fEfb:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>'
      };
      Object.keys(fieldIcons).forEach(function(id){var el=document.getElementById(id),lab=el&&document.querySelector('label[for="'+id+'"]');if(lab)lab.insertAdjacentHTML('afterbegin',iconSvg(fieldIcons[id]));});
      var buttonIcons={
        btnReload:'<path d="M20 6v6h-6M4 18v-6h6"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"/>',
        btnTaf:'<path d="M17.5 19H9a7 7 0 1 1 6.7-9H17a4.5 4.5 0 1 1 .5 9Z"/><path d="M12 12v4M10 14h4"/>',
        btnPickXls:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M16 11h6"/>',
        btnAims:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
        btnAcc:'<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M18 5l2 2M15 8l2 2"/>',
        btnOfpCheck:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 15l2 2 4-4"/>',
        aiFab:'<path d="M12 3 9.5 8.5 4 11l5.5 2.5L12 19l2.5-5.5L20 11l-5.5-2.5Z"/>'
      };
      Object.keys(buttonIcons).forEach(function(id){var el=document.getElementById(id);if(el)el.insertAdjacentHTML('afterbegin',iconSvg(buttonIcons[id]));});
      var board=room.querySelector('.hdr-switch'),theme=room.querySelector('.theme-switch');
      if(board){
        board.insertAdjacentHTML('afterbegin',iconSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'));
        var blab=board.querySelector('.hdr-switch-lab.r'); if(blab)blab.textContent='AGENT';
        var llab=board.querySelector('.hdr-switch-lab.l'); if(llab)llab.style.display='none';
        var sui=board.querySelector('.hdr-switch-ui'); if(sui)sui.style.display='none';
        var hsw=document.getElementById('hdrSwitch'); if(hsw)hsw.style.display='none';
        board.title='Trợ lý 6.6 — tải về, giải nén, bấm cai-tro-ly một lần; sau đó tự chạy khi mở máy';
        board.style.position='relative';
        var dot=document.createElement('span'); dot.className='agent-dot';
        dot.style.cssText='position:absolute;top:4px;right:5px;width:10px;height:10px;border-radius:50%;background:#9ca3af;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.15);pointer-events:none';
        board.appendChild(dot);
        var agentOn=false,pairTok='',pairAt=0,LOCAL='http://127.0.0.1:47321';
        var agentPair=function(){
          var send=function(){ if(pairTok) fetch(LOCAL+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:pairTok})}).catch(function(){}); };
          if(pairTok && Date.now()-pairAt<3600000){ send(); return; }
          fetch('/api/pc/pair-token',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){ if(d&&d.token){pairTok=d.token;pairAt=Date.now();send();} }).catch(function(){});
        };
        var agentPoll=function(){
          agentPair();
          fetch('/api/pc/status',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
            var on=!!(d&&d.online); agentOn=on;
            dot.style.background=on?'#16a34a':'#9ca3af';
            dot.style.boxShadow=on?'0 0 0 1px rgba(0,0,0,.15),0 0 6px #16a34a':'0 0 0 1px rgba(0,0,0,.15)';
            board.title=on?('Trợ lý PC đã kết nối'+(d.version?' (bản '+d.version+')':'')+((d.printers||[]).length?' — máy in: '+d.printers.join(', '):'')+'. Bấm để tắt trợ lý.'):'Trợ lý PC chưa kết nối — bấm để tải bộ cài, giải nén và bấm cai-tro-ly một lần (sau đó tự chạy khi mở máy).';
          }).catch(function(){});
        };
        agentPoll(); setInterval(agentPoll,20000);
        board.addEventListener('click',function(e){
          e.preventDefault(); e.stopPropagation();
          if(agentOn){
            if(confirm('Tắt trợ lý PC trên máy này?\\n(Bấm Cancel để tải bộ cài mới)')){
              fetch(LOCAL+'/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(function(){}).then(function(){ setTimeout(agentPoll,2500); });
              return;
            }
          }
          var a=document.createElement('a'); a.href='/agent/tro-ly-pc.zip?v=6.6'; a.download='tro-ly-pc-6.6.zip';
          document.body.appendChild(a); a.click(); a.remove();
        },true);
      }
      // Giao ca: chỉ cho tick xanh các dòng có dữ liệu chuyến bay —
      // dòng trống bị khoá tick (kể cả tick cả cột hay shift-click).
      if(!window.__hoBlankGuard){
        window.__hoBlankGuard=true;
        var hoGuardBlanks=function(){
          var tb=document.getElementById('hoBody'); if(!tb)return;
          tb.querySelectorAll('tr').forEach(function(tr){
            var cs=tr.querySelector('input[data-ho="callsign"]');
            var empty=!cs||!String(cs.value||'').trim();
            tr.querySelectorAll('input[type="checkbox"][data-ho]').forEach(function(inp){
              if(empty){ if(inp.checked)inp.checked=false; inp.disabled=true; }
              else if(inp.disabled) inp.disabled=false;
            });
          });
        };
        document.addEventListener('click',function(e){
          var t=e.target;
          if(t&&t.matches&&t.matches('#hoBody input[type="checkbox"][data-ho]')){
            var tr=t.closest('tr'); var cs=tr&&tr.querySelector('input[data-ho="callsign"]');
            if(!cs||!String(cs.value||'').trim()){ e.preventDefault(); e.stopPropagation(); t.checked=false; }
          }
        },true);
        ['hoAllAtc','hoAllEzfw','hoAllAtfm','hoAllEdto'].forEach(function(id){
          var el=document.getElementById(id);
          if(el)el.addEventListener('click',function(){ setTimeout(hoGuardBlanks,0); });
        });
        var hoTb=document.getElementById('hoBody');
        if(hoTb)new MutationObserver(function(){ hoGuardBlanks(); }).observe(hoTb,{childList:true});
        setInterval(hoGuardBlanks,5000);
      }
      if(theme)theme.insertAdjacentHTML('afterbegin',iconSvg('<path d="M12 3a9 9 0 1 0 9 9c0-1.1-.2-2.1-.5-3A7 7 0 0 1 12 3Z"/>'));
    }
    // Share semantic global tokens with the embedded document, without touching
    // operational values. Empty-state marks are CSS-only, never saved as data.
    try {
      var parentTheme=window.parent.getComputedStyle(window.parent.document.documentElement);
      var acTokens=document.createElement('style');
      var acDeclarations=[];
      ['paper','stripe','hover','ink','line','header','on-color','success','danger','warning','warning-ink','neutral','missing','night-paper','night-stripe','night-hover','night-ink','night-line','night-missing'].forEach(function(key){
        var name='--atc-'+key;
        acDeclarations.push(name+':'+parentTheme.getPropertyValue(name));
      });
      ['panel','panel-ink','panel-muted','panel-line','panel-accent','panel-on-accent','panel-shadow'].forEach(function(key){
        var name='--ops-'+key;
        acDeclarations.push(name+':'+parentTheme.getPropertyValue(name));
      });
      acTokens.textContent=':root{'+acDeclarations.join(';')+'}';
      var validationDeclarations=[];
      ['paper','ink','line','shadow','fuel','tow','lwt','zfw','era','etp','good','on-good','warn','warn-ink','bad'].forEach(function(key){
        var name='--validation-'+key;
        validationDeclarations.push(name+':'+parentTheme.getPropertyValue(name));
      });
      acTokens.textContent+=':root{'+validationDeclarations.join(';')+'}';
      var handoverDeclarations=[];
      ['pink','on-pink','flower','halo'].forEach(function(key){
        var name='--handover-'+key;
        handoverDeclarations.push(name+':'+parentTheme.getPropertyValue(name));
      });
      acTokens.textContent+=':root{'+handoverDeclarations.join(';')+'}';
      document.head.prepend(acTokens);
    } catch(e){}
    var acBody=document.getElementById('acBody');
    if(acBody){
      var acMarkRows=function(){
        acBody.querySelectorAll('tr').forEach(function(tr){
          var inp=tr.querySelector('input[data-col="0"]');
          var filled=!!(inp&&String(inp.value||'').trim());
          if(tr.classList.contains('ac-has-flight')!==filled)tr.classList.toggle('ac-has-flight',filled);
        });
      };
      acMarkRows();
      acBody.addEventListener('input',acMarkRows);
      new MutationObserver(acMarkRows).observe(acBody,{childList:true,subtree:true});
      setInterval(acMarkRows,4000);
    }
    if(room && !document.getElementById('opsHeaderBrand')){
      var brand=document.createElement('div');
      brand.id='opsHeaderBrand'; brand.className='ops-header-brand';
      var _v=(document.getElementById('appVersion')||{}).textContent||'';
      brand.innerHTML='<div class="ops-vj-mark"><span class="ops-vj-logo" aria-label="Vietjet Air"></span><span>OPERATION<br>CONTROL</span></div><div class="ops-sohee"><strong>Sohee</strong><span>— Dispatch Board</span>'+(_v?'<b title="Phiên bản tool" style="margin-left:8px;font:700 12px/1.4 monospace;padding:2px 8px;border-radius:10px;background:#fff;color:#E31937;vertical-align:middle">'+_v+'</b>':'')+'</div>';
      var live=document.createElement('div');
      live.className='ops-header-live';
      live.innerHTML='<div class="ops-weather" title="Thời tiết hiện tại tại TP. Hồ Chí Minh"><span class="ops-weather-icon">☀</span><strong id="opsWeatherTemp">--°C</strong><span><b>HO CHI MINH</b><small id="opsWeatherText">Đang cập nhật…</small></span></div><div class="ops-clock-wrap"><span class="ops-clock-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span><div class="ops-clock" title="Giờ địa phương TP. Hồ Chí Minh"><strong id="opsClockTime">--:--</strong><span id="opsClockDate">-- --- ----</span></div></div><div class="ops-account"><button type="button" class="ops-account-btn" id="opsAccountBtn" aria-haspopup="true" aria-expanded="false" title="Tài khoản đang đăng nhập"><span class="ops-avatar" id="opsAvatar">••</span><span class="ops-account-chevron" aria-hidden="true"></span></button></div>';
      room.appendChild(brand); room.appendChild(live);
      var acctMenu=document.createElement('div');
      acctMenu.id='opsAcctMenu'; acctMenu.className='ops-acct-menu'; acctMenu.hidden=true;
      acctMenu.innerHTML='<div class="ops-acct-who"><small>Đang đăng nhập</small><strong id="opsAcctMail">…</strong></div><button type="button" class="btn ops-acct-action" id="opsAcctEdit"><span class="ops-acct-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg></span><span><b>Tài khoản</b><small>Mật khẩu &amp; ảnh đại diện</small></span><span class="ops-acct-arrow" aria-hidden="true">›</span></button><button type="button" class="btn ops-acct-action ops-acct-logout" id="opsSignOut"><span class="ops-acct-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h12"/></svg></span><span><b>Đăng xuất</b></span></button>';
      // Outside the clipped header: keep both account actions above all panels.
      document.body.appendChild(acctMenu);
      var acctBtn=document.getElementById('opsAccountBtn'),acctMail=document.getElementById('opsAcctMail'),acctAvatar=document.getElementById('opsAvatar'),acctOut=document.getElementById('opsSignOut');
      var setAcctMail=function(mail,avatarUrl,displayName){ if(!acctMail||!mail)return; acctMail.textContent=displayName?displayName+' · '+mail:mail; if(acctAvatar){var nm=String(displayName||mail).split('@')[0].replace(/[^a-z0-9]/gi,''); acctAvatar.textContent=nm.slice(0,2).toUpperCase()||'••'; if(avatarUrl){var img=document.createElement('img');img.src=avatarUrl;img.alt='Ảnh đại diện';img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%';img.onerror=function(){acctAvatar.textContent=nm.slice(0,2).toUpperCase()||'••';};acctAvatar.replaceChildren(img);} } };
      var placeAcctMenu=function(){
        if(acctMenu.hidden||!acctBtn)return;
        var anchor=acctBtn.getBoundingClientRect();
        var scale=acctMenu.getBoundingClientRect().width/acctMenu.offsetWidth||1;
        var viewport=window.innerWidth/scale;
        acctMenu.style.left=Math.max(8,Math.min((anchor.right+window.scrollX)/scale-acctMenu.offsetWidth,viewport-acctMenu.offsetWidth-8))+'px';
        acctMenu.style.top=((anchor.bottom+window.scrollY)/scale+10)+'px';
        acctMenu.style.maxHeight=Math.max(120,(window.innerHeight-anchor.bottom)/scale-18)+'px';
      };
      var setAcctOpen=function(on){ if(!acctMenu||!acctBtn)return; acctMenu.hidden=!on; acctBtn.setAttribute('aria-expanded',on?'true':'false'); if(on)placeAcctMenu(); };
      if(acctBtn)acctBtn.addEventListener('click',function(e){ e.stopPropagation(); setAcctOpen(acctMenu.hidden); });
      if(acctMenu)acctMenu.addEventListener('click',function(e){ e.stopPropagation(); });
      document.addEventListener('click',function(){ setAcctOpen(false); });
      document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!acctMenu.hidden){setAcctOpen(false);acctBtn.focus();}});
      window.addEventListener('resize',placeAcctMenu);
      window.addEventListener('scroll',placeAcctMenu);
      var acctEd=document.getElementById('opsAcctEdit'); if(acctEd)acctEd.addEventListener('click',function(){ setAcctOpen(false); try{ window.parent.postMessage({type:'sohee-account-edit'},window.location.origin); }catch(e){} });
      var aftnTab=document.getElementById('mAftn');
      if(aftnTab&&!document.getElementById('opsAcctManage')){ var acctMg=document.createElement('button'); acctMg.type='button'; acctMg.className='mode'; acctMg.id='opsAcctManage'; acctMg.hidden=true; acctMg.title='Chỉ hyphan thấy mục này'; acctMg.textContent='Account Management'; var dbTab=document.getElementById('mDatabase'); (dbTab||aftnTab).insertAdjacentElement('afterend',acctMg); acctMg.addEventListener('click',function(e){ e.preventDefault(); e.stopImmediatePropagation(); try{ window.parent.postMessage({type:'sohee-accounts-manage'},window.location.origin); }catch(err){} },true); }
      if(acctOut)acctOut.addEventListener('click',function(){ try{ window.parent.postMessage({type:'sohee-signout'},window.location.origin); }catch(e){} });
      window.addEventListener('message',function(ev){ if(ev.origin!==window.location.origin||ev.source!==window.parent)return; var d=ev.data||{}; if(d.type==='sohee-account'){setAcctMail(d.email,d.avatarUrl,d.displayName); var mg=document.getElementById('opsAcctManage'); if(mg)mg.hidden=!d.canManage;} if(d.type==='sohee-live-count'){ var mg2=document.getElementById('opsAcctManage'); if(!mg2)return; var lb=document.getElementById('opsLiveCount'); if(!lb){ lb=document.createElement('span'); lb.id='opsLiveCount'; lb.className='ops-live'; mg2.appendChild(lb);} var n=Number(d.count)||0; lb.title=n+' người đang online'; lb.classList.toggle('off',n<=0); lb.innerHTML='<i class="ops-live-d"></i><b class="ops-live-n">'+n+'</b><span class="ops-live-t">online</span>'; } });
      try{ window.parent.postMessage({type:'sohee-account-request'},window.location.origin); }catch(e){}
      var tick=function(){
        var now=new Date();
        var parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
        var date=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'short',year:'numeric'}).format(now).toUpperCase();
        var t=document.getElementById('opsClockTime'),d=document.getElementById('opsClockDate'); if(t)t.textContent=parts;if(d)d.textContent=date;
      };
      tick(); setInterval(tick,1000);
      fetch('https://api.open-meteo.com/v1/forecast?latitude=10.8231&longitude=106.6297&current=temperature_2m,weather_code&timezone=Asia%2FBangkok').then(function(r){return r.json()}).then(function(w){
        var cur=w&&w.current;if(!cur)return;var code=Number(cur.weather_code),label=code===0?'Trời quang':code<4?'Có mây':code<50?'Sương mù':code<70?'Có mưa':code<80?'Mưa rào':code<90?'Mưa lớn':'Dông';
        var icon=code===0?'☀':code<4?'⛅':code<50?'☁':code<90?'🌧':'⛈';
        var temp=document.getElementById('opsWeatherTemp'),text=document.getElementById('opsWeatherText'),ico=room.querySelector('.ops-weather-icon');
        if(temp)temp.textContent=Math.round(Number(cur.temperature_2m))+'°C';if(text)text.textContent=label;if(ico)ico.textContent=icon;
      }).catch(function(){var text=document.getElementById('opsWeatherText');if(text)text.textContent='Chưa có dữ liệu';});
    }
    fit(); setTimeout(fit, 800); setTimeout(fit, 2500);
  });
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fit); } else { fit(); }
})();
</script>`;


// Lớp "skin" hiện đại: CHỈ đánh bóng hình thức (màu sắc, bo góc, đổ bóng,
// khoảng thở, hiệu ứng hover/focus, thanh cuộn). Không đổi bố cục, icon,
// tên tab, thứ tự nút hay bất kỳ logic nào — mọi selector đều bám theo class
// sẵn có của giao diện gốc.
const SKIN = `<style id="modern-skin">
/* ===== VIETJET OPS IDENTITY — thiết kế lại toàn bộ theo nhận diện hãng =====
   Đỏ VietJet #E31937 + vàng #FFC900, nền sáng phẳng, bề mặt trắng,
   header đỏ đậm kiểu bảng điều hành sân bay. Chỉ CSS — dữ liệu/logic nguyên vẹn. */
:root{
  --vj-red:#E31937; --vj-red-dark:#B01028; --vj-red-deep:#8E0C1F;
  --vj-yellow:#FFC900; --vj-yellow-soft:rgba(255,201,0,.14);
  --vj-bg:#F2F3F6; --vj-surface:#FFFFFF;
  --vj-ink:#1A1D24; --vj-ink-soft:#5C6472;
  --vj-dark:#14161C; --vj-dark-2:#1E2129; --vj-dark-ink:#E9ECF2;
  --vj-line:rgba(26,29,36,.10);
  --vj-green:#0E9F4E; --vj-amber:#C77800;
  --klein:#E31937; --klein-soft:rgba(227,25,55,.08);
  --radius:10px;
}
/* Nền tổng thể: xám sáng phẳng, bỏ ảnh nền loang */
body{
  background:var(--vj-bg) !important;
  background-image:none !important;
  letter-spacing:0;
}
body::before{content:none !important}
/* Khung .app của giao diện gốc mang ảnh nền + màu tối -> phủ nền sáng phẳng */
.app{
  background:var(--vj-bg) !important;
  background-image:none !important;
  color:var(--vj-ink);
}
/* ===== HEADER: dải đỏ VietJet đậm, chữ trắng, gạch vàng ===== */
header{
  background:linear-gradient(180deg,var(--vj-red) 0%,var(--vj-red-dark) 100%) !important;
  border-bottom:3px solid var(--vj-yellow) !important;
  box-shadow:0 4px 18px rgba(142,12,31,.35);
  backdrop-filter:none !important;
  -webkit-backdrop-filter:none !important;
}
/* Tắt lớp phủ trắng mờ + lớp trang trí "bầu trời" hồng của giao diện gốc */
header::after{content:none !important;display:none !important}
.hdr-sky,.hdr-sky *,.hdr-sky::before,.hdr-sky::after{display:none !important}
/* ===== HEADER GỌN & SANG: bỏ mèo Hello Kitty, nén chiều cao, tinh giản ===== */
.brand-peek,.brand-peek *{display:none !important}
header{
  min-height:0 !important;
  padding:8px 18px !important;
  display:flex !important;
  align-items:center !important;
  gap:14px !important;
}
/* Dẹp các lớp bọc trang trí của giao diện gốc để bố cục thành 1 hàng: lọc | brand | nút */
header .md-fit,header .md-stage,header .head-right{display:contents !important}
header .md-denpyo{
  display:flex !important;align-items:center !important;gap:10px !important;
  order:1 !important;background:none !important;border:none !important;box-shadow:none !important;
  padding:0 !important;
}
header .md-denpyo .head,header .md-denpyo .stamp,header .md-denpyo .md-cmd{display:none !important}
header .md-denpyo .md-row{display:flex !important;align-items:flex-end !important;gap:8px !important;margin:0 !important}
header .filt-actions{display:flex !important;align-items:center !important;gap:6px !important;margin:0 !important}
/* Brand: gọn một cụm, chữ trắng, nhấn vàng — đứng giữa */
header .brand{position:static !important;transform:none !important;margin:0 auto !important;order:2 !important}
/* Cụm nút phải — giao diện gốc dàn phẳng mọi nút thành flex item của header,
   nên gán thứ tự trực tiếp cho từng nút */
header .hstat,header .head-ops,header .md-hang,header .crew-jobs,header .quit-sohee{
  display:contents !important;
}
header .hstat > button,header .md-chochin{order:3 !important}
header .xls-name{order:3 !important}
header .live-ops{order:3 !important}
header #btnOfpCheck#btnOfpCheck{order:4 !important}
header #ofpCheckStat{order:5 !important}
header #btnQuit{display:none !important}
header #aiFab#aiFab{order:6 !important}
header .hdr-switch{order:7 !important;margin:0 !important}
header .theme-switch{order:8 !important;margin:0 !important}
header .brand h1{
  font-size:21px !important;letter-spacing:.06em !important;
  line-height:1.05 !important;margin:0 !important;
}
header .brand .brand-board{color:var(--vj-yellow) !important;-webkit-text-fill-color:var(--vj-yellow) !important}
header .brand .sig{
  font-size:9px !important;letter-spacing:.18em !important;text-transform:uppercase;
  opacity:.6 !important;margin-top:1px !important;
}
header .brand .brand-vj{
  display:inline-flex;align-items:center;gap:5px;
  font-size:10px !important;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  color:var(--vj-yellow) !important;-webkit-text-fill-color:var(--vj-yellow) !important;
  border:1px solid rgba(255,201,0,.55);border-radius:999px;padding:2px 10px;margin-top:4px;
  background:rgba(0,0,0,.12);
}
/* Bộ lọc: nhãn nhỏ thanh mảnh, ô trắng gọn */
.filters{gap:8px !important}
.field label{font-size:8.5px !important;letter-spacing:.14em !important;opacity:.75}
header input,header select{
  height:30px !important;padding:3px 10px !important;font-size:12.5px !important;
  border:none !important;border-radius:8px !important;
  box-shadow:0 1px 3px rgba(0,0,0,.18) !important;
}
.filt-rail{
  background:rgba(255,255,255,.10) !important;
  border:1px solid rgba(255,255,255,.22) !important;
  box-shadow:none !important;border-radius:10px !important;padding:5px 6px !important;
}
.filt-rail:focus-within{border-color:rgba(255,201,0,.6) !important;box-shadow:0 0 0 3px rgba(255,201,0,.15) !important}
/* Cụm nút phải: đồng bộ kính trắng mờ, gọn hàng */
.head-ops{gap:6px !important}
.head-ops .btn,.head-ops .ai-fab,.head-ops label.hdr-switch,.head-ops label.theme-switch{
  height:34px !important;border-radius:9px !important;
  box-shadow:0 1px 3px rgba(0,0,0,.20) !important;
}
.hdr-switch,.theme-switch{transform:scale(.88);transform-origin:right center}
/* Nút Acc/TAF/Crew/Refresh/OFP: đồng bộ kính trắng mờ trên nền đỏ — gọn & sang */
.filt-actions .btn,.head-ops .btn.act,.head-ops .btn.acbtn,.head-ops .ai-fab,
header:not(.md) #btnAcc,header:not(.md) #btnTaf,header:not(.md) #btnPickXls,header:not(.md) #btnReload,header:not(.md) #btnOfpCheck{
  background:rgba(255,255,255,.12) !important;
  background-image:none !important;
  color:#fff !important;-webkit-text-fill-color:#fff !important;
  border:1px solid rgba(255,255,255,.30) !important;
  border-radius:9px !important;font-size:12px !important;font-weight:600;
  padding:0 13px !important;box-shadow:none !important;
  height:34px !important;min-height:0 !important;
  width:auto !important;flex:0 0 auto !important;
  overflow:visible !important;white-space:nowrap !important;
  order:0 !important;margin:0 !important;
  display:inline-flex !important;align-items:center !important;gap:7px !important;
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
}
.filt-actions .btn *,.head-ops .ai-fab *,header:not(.md) #btnAcc *{color:#fff !important;-webkit-text-fill-color:#fff !important}
.filt-actions .btn:hover,.head-ops .btn.act:hover,.head-ops .ai-fab:hover,
header:not(.md) #btnAcc:hover,header:not(.md) #btnTaf:hover,header:not(.md) #btnPickXls:hover,header:not(.md) #btnReload:hover,header:not(.md) #btnOfpCheck:hover{
  background:rgba(255,255,255,.22) !important;
  border-color:rgba(255,201,0,.65) !important;
  transform:translateY(-1px);
}
.filt-actions .btn::before,header:not(.md) #btnAcc::before,header:not(.md) #btnTaf::before,
header:not(.md) #btnPickXls::before,header:not(.md) #btnReload::before,header:not(.md) #btnOfpCheck::before{
  width:15px !important;height:15px !important;border-radius:0 !important;
  background:currentColor !important;border:0 !important;box-shadow:none !important;
  font-size:0 !important;line-height:0 !important;
}
header .brand h1,header .brand .sub,header .brand *{color:#fff !important;text-shadow:0 1px 2px rgba(0,0,0,.25);-webkit-text-fill-color:#fff !important}
header .brand .sub{opacity:.85}
/* Ô lọc trên header: nền trắng trong dải đỏ */
header input,header select{
  background:#fff !important;
  border:1px solid rgba(0,0,0,.15) !important;
  color:var(--vj-ink) !important;
  border-radius:8px !important;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.06);
}
header label,header .flt label,header .flt span{color:rgba(255,255,255,.85) !important}
/* Chip thống kê / tên file trên header: kính trắng mờ trên nền đỏ */
.hstat > span,.head-ops .xls-name{
  background:rgba(255,255,255,.14) !important;
  border:1px solid rgba(255,255,255,.28) !important;
  color:#fff !important;
  border-radius:999px;
  box-shadow:none;
}
/* Nút hành động header: tile trắng, chữ đỏ, nổi khối */
.btn.act{
  background:#fff !important;
  color:var(--vj-red-dark) !important;
  border:none !important;
  border-radius:10px;
  box-shadow:0 2px 6px rgba(0,0,0,.22);
  font-weight:700;
}
.btn.act:hover:not(:disabled){box-shadow:0 5px 14px rgba(0,0,0,.30);transform:translateY(-1px)}
.btn.act:disabled{opacity:.55}
/* ===== Ô NHẬP / NÚT BẤM chung ===== */
input,select,textarea{
  border-radius:8px !important;
  border:1px solid var(--vj-line) !important;
  background:#fff;
  transition:border-color .15s ease,box-shadow .15s ease;
}
input:focus,select:focus,textarea:focus{
  outline:none;
  border-color:var(--vj-red) !important;
  box-shadow:0 0 0 3px rgba(227,25,55,.14) !important;
}
button{
  transition:transform .12s ease,box-shadow .15s ease,background .15s ease,
             border-color .15s ease,color .15s ease,filter .15s ease;
}
button:hover{filter:brightness(1.03)}
button:active{transform:translateY(1px) scale(.99)}
/* Nút chính: đỏ VietJet phẳng, gạch vàng dưới khi hover */
.btn.primary,.toolbars .btn.t-go{
  background:var(--vj-red) !important;
  color:#fff !important;
  box-shadow:0 2px 8px rgba(227,25,55,.30);
  border-radius:8px !important;
}
.btn.primary:hover,.toolbars .btn.t-go:hover{
  background:var(--vj-red-dark) !important;
  box-shadow:0 4px 14px rgba(227,25,55,.38);
}
/* ===== THANH TAB CHẾ ĐỘ: thanh trắng, tab chọn = đỏ đặc ===== */
.modes{
  background:var(--vj-surface) !important;
  border:1px solid var(--vj-line) !important;
  border-radius:12px !important;
  box-shadow:0 1px 3px rgba(26,29,36,.08);
  backdrop-filter:none !important;
  -webkit-backdrop-filter:none !important;
  padding:4px !important;
}
.mode{
  color:var(--vj-ink-soft) !important;
  background:transparent !important;
  border:none !important;
  border-radius:8px !important;
  font-weight:600;
}
.mode:hover{background:rgba(26,29,36,.05) !important;color:var(--vj-ink) !important}
.mode.on{
  color:#fff !important;
  background:var(--vj-red) !important;
  box-shadow:0 2px 8px rgba(227,25,55,.32);
}
/* Thanh tab phụ / toolbar: bề mặt trắng sạch */
.toolbars,nav.tabs,.subtabs{
  background:var(--vj-surface);
  border:1px solid var(--vj-line);
  border-radius:12px;
  backdrop-filter:none !important;
  -webkit-backdrop-filter:none !important;
  box-shadow:0 1px 3px rgba(26,29,36,.06);
}
.tabs button,.tab,[class*="tab"] button{border-radius:8px}
/* ===== BẢNG DỮ LIỆU: đầu bảng đỏ đậm VietJet, dòng hover vàng nhạt ===== */
table{border-collapse:separate;border-spacing:0}
thead th{
  position:sticky;top:0;z-index:3;
  background:var(--vj-red-deep) !important;
  color:#fff !important;
  font-size:10px;letter-spacing:.09em;text-transform:uppercase;
  border-bottom:2px solid var(--vj-yellow) !important;
  text-shadow:0 1px 1px rgba(0,0,0,.2);
}
#wrapGeneral .gtable thead th,
.xlstbl thead th,
#wrapCompare .cmptbl thead th,
#wrapVer .tooltbl thead th,
#wrapAtcCheck #acTbl thead th,
#wrapTool .tooltbl thead th,
#wrapLimits .limtbl thead th{
  background:var(--vj-red-deep) !important;
  color:#fff !important;
  border-color:var(--vj-red-deep) !important;
  border-bottom:2px solid var(--vj-yellow) !important;
}
#wrapGeneral .gtable thead th:first-child::before{
  background:rgba(255,255,255,.14);
  border-color:rgba(255,255,255,.25);
}
/* Giữ tiêu đề cột Callsign dính khi cuộn (CSS gốc ép position:relative) */
#wrapGeneral .gtable thead th:first-child{
  position:sticky !important;top:0;z-index:4;
}
tbody tr{transition:background .12s ease}
tbody tr:hover{background:var(--vj-yellow-soft)}
tbody tr:nth-child(even){background:rgba(26,29,36,.02)}
tbody tr:hover:nth-child(even){background:var(--vj-yellow-soft)}
td{border-bottom:1px solid rgba(26,29,36,.05)}
#wrapGeneral .gtable td{font-variant-numeric:tabular-nums}
/* Hàng được chọn: nền đỏ nhạt + gạch trái vàng */
#wrapGeneral .gtable tbody tr.sel td,
#wrapGeneral .gtable tbody tr.on td{
  background:rgba(227,25,55,.07) !important;
  box-shadow:inset 3px 0 0 var(--vj-yellow);
}
/* ===== THẺ / PANEL ===== */
.card,.panel,.box,[class*="card"],[class*="panel"]{border-radius:12px}
/* Khung chi tiết chuyến bên phải */
#detailWrap{
  border-radius:14px;
  overflow:hidden;
  box-shadow:0 8px 28px rgba(26,29,36,.16);
  border:1px solid var(--vj-line);
}
.detail-tabs{
  background:var(--vj-surface);
  border-bottom:1px solid var(--vj-line);
  backdrop-filter:none !important;
}
.dtab.on{color:var(--vj-red);box-shadow:inset 0 -2px 0 var(--vj-red);font-weight:700}
/* ===== ĐIỂM NHẤN PHỤ: đồng bộ về đỏ VietJet ===== */
.cmp-pick .hd,.nm-place .uses,.nm-tune-pop h5,.nm-place-head,#ftAtcMiss{color:var(--vj-red) !important}
.nm-find > button{background:var(--vj-red) !important}
.ftci input:focus,.fttx input:focus{border-color:var(--vj-red) !important}
.ftcrew-menu button.on{background:rgba(227,25,55,.12) !important}
/* ===== POPUP / HỘP THOẠI ===== */
.modal,.popup,.dialog,[class*="modal"],[class*="popup"]{
  border-radius:14px !important;
  box-shadow:0 16px 52px rgba(26,29,36,.28),0 2px 8px rgba(26,29,36,.12) !important;
}
/* ===== THANH CUỘN ===== */
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{
  background:rgba(26,29,36,.20);border-radius:99px;
  border:2px solid transparent;background-clip:padding-box;
}
::-webkit-scrollbar-thumb:hover{background:rgba(227,25,55,.45);background-clip:padding-box}
::selection{background:rgba(255,201,0,.45)}
</style>`;

// Font pop-art (Archivo Black + Inter) — nạp qua <link> trong head của trang tool.
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;600;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap" rel="stylesheet">`;

// Lớp POP-ART: áp dụng phong cách comic-print của mẫu BLARE người dùng cung cấp
// (vàng #FFC900 làm nền, viền mực, bóng đổ cứng 0-blur, đỏ #E31937 làm nhấn,
// halftone dot, font display Archivo Black). Nạp SAU SKIN để đè màu sắc;
// bố cục, thứ tự nút và mọi logic giữ nguyên theo SKIN phía trên.
const POPART = `<style id="popart-skin">
:root{
  --pp-red:#E31937; --pp-red-deep:#B01026; --pp-yellow:#FFC900;
  --pp-ink:#141210; --pp-paper:#F7F6F2; --pp-line:rgba(20,18,16,.14);
}
/* Nền sáng sạch — tuyệt đối không nền tối */
body,.app{
  background:var(--pp-paper) !important;
  background-image:none !important;
  font-family:'Inter',system-ui,sans-serif !important;
}
/* ===== HEADER: dải đỏ poster kiểu properprompts ===== */
header{
  background:#fff !important;
  background-image:none !important;
  border-bottom:3px solid var(--pp-red) !important;
  box-shadow:0 2px 0 rgba(20,18,16,.06) !important;
}
/* Brand: display khổng lồ chữ đỏ — điểm nhấn poster */
header .brand h1{
  font-family:'Archivo Black',sans-serif !important;
  color:var(--pp-red) !important;-webkit-text-fill-color:var(--pp-red) !important;
  letter-spacing:-.01em !important;
  font-size:24px !important;
  line-height:1.05 !important;
  text-transform:uppercase !important;
  text-shadow:none !important;
}
header .brand .sub,header .brand .sig,header .brand *{
  color:var(--pp-ink) !important;-webkit-text-fill-color:var(--pp-ink) !important;text-shadow:none !important;
}
header .brand .brand-board{color:var(--pp-ink) !important;-webkit-text-fill-color:var(--pp-ink) !important}
/* Dòng chữ ký: tắt animation gốc (gây đè chữ khi đứng ở keyframe đầu) */
header .brand .sig{
  animation:none !important;transform:none !important;
  opacity:.65 !important;margin-top:3px !important;
}
header .brand .brand-vj{
  margin-top:4px !important;
  background:var(--pp-red) !important;
  color:#fff !important;-webkit-text-fill-color:#fff !important;
  border:none !important;border-radius:6px !important;
  box-shadow:none !important;font-weight:800 !important;letter-spacing:.06em !important;
}
header label,header .flt label,header .flt span{
  color:var(--pp-ink) !important;opacity:.85 !important;font-weight:800 !important;
}
/* Ô lọc: khối trắng gọn, viền mảnh */
.filt-rail{
  background:#fff !important;border:1px solid var(--pp-line) !important;
  border-radius:10px !important;box-shadow:0 1px 0 rgba(20,18,16,.05) !important;
}
.filt-rail:focus-within{border-color:var(--pp-red) !important}
header input,header select{
  background:#fff !important;
  border:1px solid var(--pp-line) !important;
  color:var(--pp-ink) !important;
  border-radius:8px !important;
  box-shadow:none !important;
  font-weight:700 !important;
}
header input:focus,header select:focus{border-color:var(--pp-red) !important;box-shadow:0 0 0 2px rgba(227,25,55,.15) !important}
/* Nút header: nền đỏ đặc, chữ trắng — theo yêu cầu của người dùng */
.filt-actions .btn,.head-ops .btn.act,.head-ops .btn.acbtn,.head-ops .ai-fab,
header:not(.md) #btnAcc,header:not(.md) #btnTaf,header:not(.md) #btnPickXls,header:not(.md) #btnReload,header:not(.md) #btnOfpCheck{
  background:var(--pp-red) !important;background-image:none !important;
  color:#fff !important;-webkit-text-fill-color:#fff !important;
  border:1.5px solid var(--pp-red) !important;border-radius:8px !important;
  box-shadow:0 2px 6px rgba(227,25,55,.28) !important;
  font-weight:800 !important;
}
.filt-actions .btn *,.head-ops .btn.act *,.head-ops .btn.acbtn *,.head-ops .ai-fab *,
header:not(.md) #btnAcc *,header:not(.md) #btnTaf *,header:not(.md) #btnPickXls *,
header:not(.md) #btnReload *,header:not(.md) #btnOfpCheck *{
  color:#fff !important;-webkit-text-fill-color:#fff !important;
}
.filt-actions .btn:hover,.head-ops .btn.act:hover,.head-ops .btn.acbtn:hover,.head-ops .ai-fab:hover,
header:not(.md) #btnAcc:hover,header:not(.md) #btnTaf:hover,header:not(.md) #btnPickXls:hover,header:not(.md) #btnReload:hover,header:not(.md) #btnOfpCheck:hover{
  background:var(--pp-red-deep) !important;border-color:var(--pp-red-deep) !important;
  box-shadow:0 4px 12px rgba(227,25,55,.36) !important;
}
.filt-actions .btn:hover *,.head-ops .btn.act:hover *,.head-ops .btn.acbtn:hover *,
header:not(.md) #btnAcc:hover *,header:not(.md) #btnTaf:hover *,
header:not(.md) #btnPickXls:hover *,header:not(.md) #btnReload:hover *,header:not(.md) #btnOfpCheck:hover *{
  color:#fff !important;-webkit-text-fill-color:#fff !important;
}
/* Nút hành động chính & sohee AI: đỏ đặc chữ trắng */
.head-ops .btn.act,.head-ops .btn.acbtn,header #aiFab#aiFab{
  background:var(--pp-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;
  border:1.5px solid var(--pp-red) !important;box-shadow:none !important;
}
.head-ops .btn.act *,.head-ops .btn.acbtn *,header #aiFab *{color:#fff !important;-webkit-text-fill-color:#fff !important}
/* Chip thống kê / tên file: pill trắng viền mảnh */
header .hstat > span,.head-ops .xls-name{
  background:#fff !important;border:1px solid var(--pp-line) !important;
  color:var(--pp-ink) !important;-webkit-text-fill-color:var(--pp-ink) !important;
  border-radius:999px !important;box-shadow:none !important;
}
header .hstat > span *,.head-ops .xls-name *{color:var(--pp-ink) !important;-webkit-text-fill-color:var(--pp-ink) !important}
/* ===== THANH TAB CHẾ ĐỘ: trắng sạch, tab chọn đỏ ===== */
/* Chừa 28px phía trên cho badge số (.mode-bang nằm top:-22px) — thiếu là mất số */
.modes{
  background:#fff !important;border:1px solid var(--pp-line) !important;
  border-radius:10px !important;box-shadow:0 1px 0 rgba(20,18,16,.05) !important;
  padding:28px 12px 4px !important;
}
.aside-head .modes{overflow-y:visible !important}
/* Tất cả tab: nền đỏ chữ trắng; tab đang chọn đỏ đậm + gạch vàng */
.mode,.aside-head .mode{
  background:var(--pp-red) !important;background-image:none !important;
  color:#fff !important;-webkit-text-fill-color:#fff !important;
  font-weight:700 !important;border-radius:7px !important;overflow:visible !important;
  border:none !important;box-shadow:none !important;margin:0 3px !important;
}
.mode *:not(.mode-bang):not(.mode-bang *){color:#fff !important;-webkit-text-fill-color:#fff !important}
.mode svg,.mode svg *{stroke:currentColor !important}
.mode:hover,.aside-head .mode:hover{background:var(--pp-red-deep) !important;color:#fff !important}
.mode.on,.aside-head .mode.on{
  background:var(--pp-red-deep) !important;color:#fff !important;
  box-shadow:inset 0 -3px 0 #FFC900 !important;
}
.mode.on::after{display:none !important}
/* Badge số: nổi hẳn phía trên góc phải tab, nền vàng chữ đen để không lẫn vào nút đỏ */
@keyframes pp-bang-blink{0%,100%{background:#FFC900;color:#1a1d24}50%{background:#fff;color:#c0362c}}
.mode-bang,.mode .mode-bang{
  top:-15px !important;left:auto !important;right:-8px !important;z-index:20 !important;
  min-width:22px !important;height:20px !important;padding:0 6px !important;
  background:#FFC900 !important;color:#1a1d24 !important;-webkit-text-fill-color:currentColor !important;
  border:2px solid #fff !important;border-radius:10px !important;
  font-size:11.5px !important;font-weight:800 !important;
  box-shadow:0 2px 6px rgba(20,18,16,.25) !important;
  animation:none !important;
}
#estBang.on,#genBang.att-wrong{animation:pp-bang-blink 1s ease-in-out infinite !important}
.aside-head,.modes,.aside-head .modes{overflow:visible !important}
/* Nút Board / Đêm cùng kiểu đỏ chữ trắng */
header .theme-toggle,header #btnBoard,header #btnNight,header .board-btn,header .night-btn{
  background:var(--pp-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;
  border:none !important;
}
/* Thanh toolbar phụ */
.toolbars,nav.tabs,.subtabs{
  background:#fff !important;border:1px solid var(--pp-line) !important;
  border-radius:10px !important;box-shadow:0 1px 0 rgba(20,18,16,.05) !important;
}
/* Nút trong thanh công cụ: nền đỏ chữ trắng, đồng bộ nút header */
.toolbars .btn,nav.tabs .btn,.subtabs .btn{
  background:var(--pp-red) !important;background-image:none !important;
  color:#fff !important;-webkit-text-fill-color:#fff !important;
  border:1.5px solid var(--pp-red) !important;border-radius:8px !important;
  box-shadow:0 2px 6px rgba(227,25,55,.24) !important;font-weight:700 !important;
}
.toolbars .btn *,nav.tabs .btn *,.subtabs .btn *{color:#fff !important;-webkit-text-fill-color:#fff !important}
.toolbars .btn:hover,nav.tabs .btn:hover,.subtabs .btn:hover{
  background:var(--pp-red-deep) !important;border-color:var(--pp-red-deep) !important;
}
/* ===== BẢNG: đầu bảng đỏ poster, gạch đỏ đậm dưới ===== */
thead th{
  background:var(--pp-red) !important;
  border-bottom:3px solid var(--pp-red-deep) !important;
  color:#fff !important;text-shadow:none !important;
  letter-spacing:.04em !important;
}
#wrapGeneral .gtable thead th,
.xlstbl thead th,
#wrapCompare .cmptbl thead th,
#wrapVer .tooltbl thead th,
#wrapAtcCheck #acTbl thead th,
#wrapTool .tooltbl thead th,
#wrapLimits .limtbl thead th{
  background:var(--pp-red) !important;color:#fff !important;
  border-color:var(--pp-red-deep) !important;
  border-bottom:3px solid var(--pp-red-deep) !important;
}
tbody tr:hover{background:rgba(255,201,0,.22)}
tbody tr:hover:nth-child(even){background:rgba(255,201,0,.22)}
#wrapGeneral .gtable tbody tr.sel td,
#wrapGeneral .gtable tbody tr.on td{
  background:rgba(255,201,0,.30) !important;
  box-shadow:inset 3px 0 0 var(--pp-red);
}
/* ===== NÚT CHÍNH: đỏ đặc, gọn ===== */
.btn.primary,.toolbars .btn.t-go{
  background:var(--pp-red) !important;color:#fff !important;
  border:none !important;border-radius:8px !important;
  box-shadow:none !important;
}
.btn.primary:hover,.toolbars .btn.t-go:hover{
  background:var(--pp-red-deep) !important;
}
/* ===== PANEL CHI TIẾT & POPUP: thẻ trắng viền mảnh ===== */
#detailWrap{
  border:1px solid var(--pp-line) !important;border-radius:12px !important;
  box-shadow:0 10px 30px -18px rgba(20,18,16,.35) !important;
}
.detail-tabs{background:#fff !important}
.dtab.on{color:var(--pp-red);box-shadow:inset 0 -3px 0 var(--pp-red);font-weight:800}
.modal,.popup,.dialog,[class*="modal"],[class*="popup"]{
  border:1px solid var(--pp-line) !important;border-radius:12px !important;
  box-shadow:0 24px 60px -30px rgba(20,18,16,.45) !important;
}
/* ===== ĐIỂM NHẤN PHỤ ===== */
.cmp-pick .hd,.nm-place .uses,.nm-tune-pop h5,.nm-place-head,#ftAtcMiss{color:var(--pp-red) !important}
.nm-find > button{background:var(--pp-red) !important}
/* ===== THANH CUỘN & CHỌN CHỮ ===== */
::-webkit-scrollbar-thumb{background:rgba(20,18,16,.35);border-radius:99px;border:2px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background:var(--pp-red);background-clip:padding-box}
::selection{background:rgba(255,201,0,.55)}
</style>`;


/* =====================================================================
   PRO — thiết kế lại toàn bộ: đỏ VietJet + trắng, IBM Plex, bảng gọn.
   Chỉ đổi giao diện; dữ liệu & logic giữ nguyên.
   ===================================================================== */
const PRO = `<style id="pro-skin">
:root{
  --x-red:#E31937;--x-red-d:#B8102A;--x-red-50:#FFF1F3;--x-red-100:#FFE1E6;
  --x-yel:#FFC900;--x-ink:#16181D;--x-ink2:#454B57;--x-mute:#7A808C;
  --x-line:#E4E6EA;--x-line2:#EEF0F3;--x-bg:#F4F5F7;--x-card:#FFFFFF;
  --x-ok:#15803D;--x-ok-bg:#E8F6EC;--x-warn:#B45309;--x-warn-bg:#FEF3E2;
  --x-khb-ink:#1E3A8A; /* chữ ô dữ liệu bảng KHB: xanh dương đậm */

  --x-sans:"IBM Plex Sans",system-ui,sans-serif;--x-mono:"IBM Plex Mono",ui-monospace,monospace;
  --x-r:8px;--x-sh:0 1px 2px rgba(16,18,24,.05),0 1px 1px rgba(16,18,24,.03);
}
html,body,.app{background:var(--x-bg) !important;background-image:none !important}
body,button,input,select,textarea,table,.app{font-family:var(--x-sans) !important;color:var(--x-ink)}
[style*="JetBrains"],.mono,code,pre,.fi-spec,.fi-fuel .val,.fi-load .n,.fi-oooi .t,.fi-grid .val,.xt-kg,.xt-min,.stdsta{font-family:var(--x-mono) !important}

/* ---------- HEADER ---------- */
header{background:#fff !important;background-image:none !important;border-bottom:3px solid var(--x-red) !important;box-shadow:0 1px 0 var(--x-line) !important}
header::before,header::after{display:none !important}
header .brand h1,header h1{font-family:var(--x-sans) !important;font-weight:700 !important;letter-spacing:-.01em !important;color:var(--x-ink) !important}
header .brand-board{color:var(--x-red) !important}
header label,header .lab,header .tlbl{font-family:var(--x-sans) !important;font-size:10px !important;font-weight:600 !important;letter-spacing:.08em !important;color:var(--x-mute) !important;text-transform:uppercase}

/* ---------- NÚT ---------- */
.btn,button.btn,a.btn{
  font-family:var(--x-sans) !important;font-weight:600 !important;font-size:12px !important;letter-spacing:.01em !important;
  background:var(--x-red) !important;background-image:none !important;color:#fff !important;-webkit-text-fill-color:#fff !important;
  border:1px solid var(--x-red) !important;border-radius:6px !important;box-shadow:0 1px 2px rgba(227,25,55,.25) !important;
  text-shadow:none !important;transition:background .15s,box-shadow .15s,transform .05s !important;
}
.btn *{color:inherit !important;-webkit-text-fill-color:inherit !important}
.btn svg,.btn svg *{stroke:currentColor !important}
.btn:hover{background:var(--x-red-d) !important;border-color:var(--x-red-d) !important;box-shadow:0 2px 6px rgba(227,25,55,.3) !important}
.btn:active{transform:translateY(1px)}
.btn:focus-visible{outline:2px solid var(--x-yel) !important;outline-offset:2px}
.btn:disabled,.btn[disabled]{background:#F1B3BE !important;border-color:#F1B3BE !important;box-shadow:none !important;cursor:not-allowed}
.btn.small{font-size:11px !important;padding:3px 9px !important}
.btn.ghost,.btn.sec,.btn.secondary,.btn.light{background:#fff !important;color:var(--x-red) !important;-webkit-text-fill-color:var(--x-red) !important;border-color:var(--x-red-100) !important;box-shadow:none !important}
.btn.ghost:hover,.btn.sec:hover,.btn.secondary:hover,.btn.light:hover{background:var(--x-red-50) !important}
/* FPL toolbar2: nút nền trắng chữ đỏ, chữ dày, không viền đỏ */
.toolbar2 .ft-tool-group .btn.small{
  font-size:13px !important;font-weight:800 !important;padding:6px 13px !important;border-radius:8px !important;
  background:#fff !important;background-image:none !important;color:var(--x-red) !important;-webkit-text-fill-color:var(--x-red) !important;
  border:1.5px solid rgba(227,25,55,.12) !important;box-shadow:0 1px 3px rgba(22,24,29,.1) !important;
  letter-spacing:.2px !important;
}
.toolbar2 .ft-tool-group .btn.small:hover{background:var(--x-red-50) !important;border-color:rgba(227,25,55,.2) !important;box-shadow:0 2px 6px rgba(22,24,29,.14) !important}
.toolbar2 .ft-tool-group .btn.small.act,.toolbar2 .ft-tool-group .btn.small[aria-pressed="true"]{background:var(--x-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important}
.toolbar2 .ft-tool-group .btn.small.act *,.toolbar2 .ft-tool-group .btn.small[aria-pressed="true"] *{color:#fff !important;-webkit-text-fill-color:#fff !important}
.toolbar2 .ft-tool-group .btn.small:disabled{background:#f2f2f2 !important;border-color:#d9d9d9 !important;color:#b9b9b9 !important;-webkit-text-fill-color:#b9b9b9 !important;box-shadow:none !important}

/* ---------- Ô NHẬP ---------- */
input[type=text],input[type=search],input[type=number],input[type=password],input[type=date],input[type=time],input:not([type]),select,textarea{
  font-family:var(--x-sans) !important;font-size:12px !important;color:var(--x-ink) !important;
  background:#fff !important;border:1px solid var(--x-line) !important;border-radius:6px !important;box-shadow:none !important;
}
/* Ô nhập trong bảng Briefing: chữ to hơn cỡ chung để dễ đọc */
#wrapFplText .fttbl input[type=text]{font-size:14px !important;height:32px !important;line-height:32px !important}
/* Chữ dữ liệu trong bảng KHB: xanh dương đậm thay cho đen. Đặt TRƯỚC các rule
   cảnh báo bên dưới (ft-lim-crit/warn, ft-extra-auto, ft-ac-a330) để ô alert
   vẫn giữ nguyên màu đỏ/cam/xanh của nó. */
#wrapFplText .fttbl td{color:var(--x-khb-ink) !important}
/* Badge chuyến trùng nổi bên trái, không chiếm chỗ ô FLT NO */
#wrapFplText .fttbl td.ftflt{position:relative !important;overflow:visible !important}
#wrapFplText .fttbl th:nth-child(2),#wrapFplText .fttbl td:nth-child(2){width:78px !important}
#wrapFplText .fttbl td:nth-child(2) .ftflt-in{position:static !important;display:block !important;width:100% !important}
#wrapFplText .fttbl td.ftflt > .ftbadge,#wrapFplText .fttbl td:nth-child(2) .ftflt-in > .ftbadge{position:absolute !important;left:-9px;top:50%;transform:translateY(-50%);z-index:3;border:0;padding:0;cursor:pointer;color:var(--x-card) !important}
#wrapFplText .fttbl td.ftflt > input,#wrapFplText .fttbl td:nth-child(2) .ftflt-in > input{width:100% !important;min-width:0 !important;padding-inline:4px !important;box-sizing:border-box !important}
#wrapFplText .fttbl input[type=text]{color:#1E3A8A !important;-webkit-text-fill-color:#1E3A8A;font-weight:600 !important}
#wrapFplText .fttbl input[type=text].ft-chg,#wrapFplText .fttbl .ft-chg input[type=text]{color:#EA580C !important;-webkit-text-fill-color:#EA580C;font-weight:700 !important;background:#FFF7ED !important;border-color:#FDBA74 !important}
#wrapFplText .fttbl input[type=text].ft-chg-fpl,#wrapFplText .fttbl .ft-chg-fpl input[type=text]{color:#7C3AED !important;-webkit-text-fill-color:#7C3AED !important;font-weight:700 !important;background:#F5F3FF !important;border-color:#C4B5FD !important}
#wrapFplText .fttbl input[type=text].ft-chg-both,#wrapFplText .fttbl .ft-chg-both input[type=text]{color:#DC2626 !important;-webkit-text-fill-color:#DC2626 !important;font-weight:700 !important;background:#FEF2F2 !important;border-color:#FCA5A5 !important}
#wrapFplText .fttbl input[type=text].ft-chg-ok,#wrapFplText .fttbl .ft-chg-ok input[type=text]{color:#16A34A !important;-webkit-text-fill-color:#16A34A !important;font-weight:700 !important;background:#F0FDF4 !important;border-color:#86EFAC !important}
#wrapFplText .fttbl .ft-bolt{font-variant-emoji:text}#wrapFplText .fttbl .ft-bolt.ok{color:#16A34A !important;filter:hue-rotate(75deg) saturate(1.6)}
#wrapFplText .fttbl td.dimcell{color:var(--x-mute) !important}

input:focus,select:focus,textarea:focus{outline:none !important;border-color:var(--x-red) !important;box-shadow:0 0 0 3px rgba(227,25,55,.12) !important}
/* Ô cảnh báo giới hạn trong bảng chuyến bay phải giữ màu (đè lại luật ô nhập chung) */
#wrapFplText .fttbl input.ft-lim-crit{color:#b91c1c !important;-webkit-text-fill-color:#b91c1c !important;background:#fecaca !important;border-color:#ef4444 !important;font-weight:800 !important}
#wrapFplText .fttbl input.ft-lim-warn{color:#92400e !important;-webkit-text-fill-color:#92400e !important;background:#fde68a !important;border-color:#f59e0b !important;font-weight:800 !important}
#wrapFplText .fttbl input.ft-extra-auto{color:#d10000 !important;-webkit-text-fill-color:#d10000 !important;font-weight:700 !important}
#wrapFplText .fttbl input[type=text].ft-ac-a330{color:#166534 !important;-webkit-text-fill-color:#166534 !important;background:#bbf7d0 !important;border-color:#22c55e !important;font-weight:800 !important}
html.night #wrapFplText .fttbl input[type=text].ft-ac-a330{color:#86efac !important;-webkit-text-fill-color:#86efac !important;background:#14532d !important;border-color:#166534 !important}
input::placeholder,textarea::placeholder{color:#A6ABB5 !important}

/* ---------- KHUNG / THẺ ---------- */
.pane,aside,main.split2,#detailWrap,.sheet,.lim-pane,.accard,.fpl-card,.tbl-wrap,.toolbar,.toolbars,.modes{
  background:var(--x-card) !important;background-image:none !important;border:1px solid var(--x-line) !important;
  border-radius:var(--x-r) !important;box-shadow:var(--x-sh) !important;backdrop-filter:none !important;
}
.tbl-wrap .tbl-wrap,.pane .tbl-wrap{box-shadow:none !important}
.sheet-head,.lim-title,.ftconv-h,.fpl-lead{
  font-family:var(--x-sans) !important;font-weight:700 !important;color:var(--x-ink) !important;
  background:#fff !important;border-bottom:1px solid var(--x-line) !important;box-shadow:inset 3px 0 0 var(--x-red) !important;
}
.modal{background:rgba(22,24,29,.35) !important;backdrop-filter:blur(2px)}
.modal > *:not(script){border-radius:12px !important}

/* ---------- BẢNG (mọi bảng) ---------- */
table{border-collapse:separate !important;border-spacing:0 !important;font-variant-numeric:tabular-nums}
table thead th,table > tr:first-child > th,.tooltbl th{
  font-family:var(--x-sans) !important;font-size:10.5px !important;font-weight:600 !important;letter-spacing:.06em !important;text-transform:uppercase;
  background:var(--x-red) !important;background-image:none !important;color:#fff !important;-webkit-text-fill-color:#fff !important;
  border:0 !important;border-bottom:2px solid var(--x-red-d) !important;padding:7px 8px !important;box-shadow:none !important;text-shadow:none !important;
}
table thead th:first-child{border-top-left-radius:6px}
table thead th:last-child{border-top-right-radius:6px}
table thead th *{color:#fff !important;-webkit-text-fill-color:#fff !important}
/* Ô nhập/select trong ô đầu bảng (vd. tên tháng Taxi fuel): nền trắng chữ đen,
   không kế thừa -webkit-text-fill-color trắng từ rule "th *" ở trên (thuộc tính
   này có tính kế thừa và đè lên color trong Chromium). */
table thead th input,table thead th select,table thead th textarea{
  color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;background:#fff !important;
}
table tbody td{
  font-size:12px !important;color:var(--x-ink) !important;
  border:0 !important;border-bottom:1px solid var(--x-line2) !important;background:#fff;padding-top:3px !important;padding-bottom:3px !important;
}
table tbody tr:nth-child(even) > td{background:#FAFAFB}
table tbody tr:hover > td{background:var(--x-red-50) !important}
table tbody tr.sel > td,table tbody tr.on > td,table tbody tr.active > td,table tbody tr.selected > td{background:var(--x-red-100) !important}
table tbody tr.sel > td:first-child,table tbody tr.on > td:first-child,table tbody tr.active > td:first-child,table tbody tr.selected > td:first-child{box-shadow:inset 3px 0 0 var(--x-red) !important}
td .dim,.dim{color:var(--x-mute) !important}

/* ---------- TAB ---------- */
.dtab{font-family:var(--x-sans) !important;font-weight:600 !important;color:var(--x-ink2) !important;background:transparent !important}
.dtab.on{color:var(--x-red) !important;box-shadow:inset 0 -2px 0 var(--x-red) !important}
.mode,.aside-head .mode{font-family:var(--x-sans) !important;font-weight:600 !important;font-size:12px !important;border-radius:6px !important}
.mode.on,.aside-head .mode.on{background:var(--x-red-d) !important;box-shadow:inset 0 -3px 0 var(--x-yel) !important}

/* ---------- THẺ CHI TIẾT CHUYẾN: nền tối như bản gốc ---------- */
#detailWrap{background:#12161d !important;border:1px solid #2a3342 !important}
#detailWrap .pane{background:#12161d !important}
/* High-contrast text on the shared dark hover surface, including Defect/Limit. */
.taf-tip{
  pointer-events:none!important;
  --hover-text:var(--vj-dark-ink);--hover-muted:#c5cddb;
  --hover-danger:#ffb4ac;--hover-success:#9af0bf;--hover-warning:#ffe099;
  color:var(--hover-text) !important;
  box-sizing:border-box;max-width:min(calc(760px * var(--taf-read-scale,1)),calc((100vw - 24px) * var(--taf-read-scale,1))) !important;
  max-height:calc((100vh - 24px) * var(--taf-read-scale,1));overflow:auto;
  padding:calc(16px * var(--taf-read-scale,1)) calc(20px * var(--taf-read-scale,1)) !important;
  font-size:calc(18px * var(--taf-read-scale,1)) !important;line-height:1.65 !important;
  letter-spacing:0;border-radius:8px !important;
}
.taf-tip .meta{font-size:calc(15px * var(--taf-read-scale,1)) !important;margin-bottom:10px !important}
.taf-tip .tip-line,.taf-tip .tip-text,.taf-tip .tip-row{font-size:inherit !important;overflow-wrap:anywhere}
.taf-tip,.taf-tip *{-webkit-text-fill-color:currentColor !important}
.taf-tip .lim-tip-head,.taf-tip .tip-line,.taf-tip .tip-text{color:var(--hover-text) !important}
.taf-tip .meta,.taf-tip .tip-dim{color:var(--hover-muted) !important}
.taf-tip .lim-tip-rule,.taf-tip .tip-bad{color:var(--hover-danger) !important}
.taf-tip .lim-tip-advise,.taf-tip .tip-ok,.taf-tip .tip-hi{color:var(--hover-success) !important}
.taf-tip .tip-warn{color:var(--hover-warning) !important}
.taf-tip .lim-tip-rule,.taf-tip .lim-tip-advise{font-weight:600}
/* Tooltip PCR: ô giới hạn (hit) chữ trắng đậm trên nền đỏ đặc — bản cũ chữ đỏ nhạt trên nền đỏ mờ nên bị nhoè. */
.taf-tip .pcr-tbl th.hit,.taf-tip .pcr-tbl td.hit{color:#fff !important;background:#c3362c !important;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,.45)}
.taf-tip .pcr-tbl th.ok,.taf-tip .pcr-tbl td.ok{color:#fff !important;background:#2e7d32 !important;text-shadow:0 1px 2px rgba(0,0,0,.35)}
.taf-tip .pcr-tbl th{color:#d7dde8 !important}
/* Luật bảng chung "table tbody td{background:#fff}" sơn trắng ô thường của tooltip
   PCR nên chữ sáng bị chìm — ép mọi ô PCR trong suốt, chỉ hit/ok/tow có màu riêng. */
.taf-tip .pcr-tbl th,.taf-tip .pcr-tbl td{background-color:transparent !important}
.taf-tip .pcr-tbl td{color:#f2f5fa !important}
.taf-tip .pcr-tbl td.ac{color:#fff !important}
.taf-tip .pcr-tbl .tow{color:#ffe9a8 !important;background:rgba(255,255,255,.08) !important}
/* Check OFP shares the dark detail surface, not the light table palette. */
#paneLimitCheck{
  --ofp-text:var(--vj-dark-ink);--ofp-muted:#c5cddb;--ofp-evidence:#a9c9ff;
  --ofp-success:#7dff9a;--ofp-danger:#ffaaa3;--ofp-warning:#ffd477;
  --ofp-divider:#3a4558;
  color:var(--ofp-text) !important;-webkit-text-fill-color:currentColor !important;
}
#paneLimitCheck *{-webkit-text-fill-color:currentColor !important}
#paneLimitCheck .ofp-row,#paneLimitCheck .ofp-cs,#paneLimitCheck .ofp-sum,#paneLimitCheck .empty{
  color:var(--ofp-text) !important;
}
#paneLimitCheck .ofp-row{border-color:var(--ofp-divider) !important}
#paneLimitCheck .ofp-head,#paneLimitCheck .ofp-why{color:var(--ofp-muted) !important}
#paneLimitCheck .ofp-ev{color:var(--ofp-evidence) !important}
#paneLimitCheck .ofp-tag{background:transparent !important;border-color:currentColor !important}
#paneLimitCheck .ofp-tag.ok{color:var(--ofp-success) !important}
#paneLimitCheck .ofp-tag.crit{color:var(--ofp-danger) !important}
#paneLimitCheck .ofp-tag.wait{color:var(--ofp-muted) !important}
#paneLimitCheck .ofp-tag.fail,#paneLimitCheck .ofp-tag.warn{color:var(--ofp-warning) !important}
.detail-tabs{background:#12161d !important;border-bottom:1px solid #2a3342 !important}
.detail-tabs .hint{color:#8b93a7 !important}
.dtab{color:#9aa6bb !important;background:transparent !important}
.dtab:hover{color:#e8edf4 !important;background:rgba(255,255,255,.06) !important}
.dtab.on{color:#FFC900 !important;background:rgba(255,255,255,.08) !important}
.fi-pane,#pane.fi-pane{background:#12161d !important}
.fi-board{color:#e8edf4 !important}
.fi-card,.fi-card.fi-acft{background:#1b212c !important;border:1px solid #2a3342 !important;border-radius:10px !important;box-shadow:none !important}
.fi-k,.fi-fuel .lab,.fi-grid .lab,.fi-leg .dir,.fi-oooi .k{color:#8b93a7 !important;font-family:var(--x-sans) !important;font-weight:700 !important;background:transparent !important;-webkit-text-fill-color:#8b93a7 !important;border:0 !important;text-transform:uppercase}
.fi-load th{background:#232b38 !important;color:#c5cddb !important;-webkit-text-fill-color:#c5cddb !important;border:0 !important;border-bottom:1px solid #2a3342 !important;text-transform:uppercase}
.fi-id,.fi-reg,.fi-leg .codes,.fi-type b,.fi-fuel .val,.fi-grid .val,.fi-load tr.tot td,.fi-files li{color:#e8edf4 !important;-webkit-text-fill-color:#e8edf4 !important}
.fi-id .rt,.fi-date,.fi-leg .meta,.fi-fuel .u,.fi-files .who,.fi-files-empty,.fi-spec{color:#8b93a7 !important;-webkit-text-fill-color:#8b93a7 !important}
.fi-leg .nm,.fi-load td,.fi-type{color:#c5cddb !important;-webkit-text-fill-color:#c5cddb !important}
.fi-load td{background:transparent !important;border-top:1px solid #2a3342 !important;border-bottom:0 !important}
.fi-leg + .fi-leg{border-left:1px solid #2a3342 !important}
.fi-files li{border-top:1px solid #2a3342 !important}
.fi-oooi .dot{background:#3a4558 !important;border-color:#3a4558 !important}
.fi-oooi li:not(:last-child)::after{background:#3a4558 !important}
.fi-oooi li.done .dot{background:#39ff6a !important;border-color:#39ff6a !important;box-shadow:0 0 0 4px rgba(57,255,106,.28) !important}
.fi-oooi li.now .dot{box-shadow:0 0 0 4px rgba(57,255,106,.28),0 0 12px #39ff6a !important}
.fi-oooi li.done:not(:last-child)::after{background:#39ff6a !important;box-shadow:none !important}
.fi-oooi .t{color:#e8edf4 !important;text-shadow:none !important;-webkit-text-fill-color:#e8edf4 !important}
.fi-oooi li.done .t{color:#7dff9a !important;text-shadow:0 0 8px rgba(57,255,106,.55) !important}
.fi-board .lim-banner{background:rgba(192,54,44,.16) !important;border:1px solid rgba(192,54,44,.38) !important;color:#f3d4ce !important}
.fi-board .lim-banner *{color:#f3d4ce !important}
.fi-board .vd.air{color:#8fb8ff !important;background:rgba(30,64,201,.22) !important}
.fi-board .vd.taxi{color:#f0b95e !important;background:rgba(180,83,9,.22) !important}
.fi-board .vd.off{color:#ff9d6b !important;background:rgba(194,65,12,.2) !important}
.fi-board .vd.gnd,.fi-board .vd.dim{color:#9aa6bb !important;background:rgba(255,255,255,.07) !important}
.fi-board .vd.done,.fi-board .vd.complete{color:#7dff9a !important;background:rgba(21,128,61,.25) !important}
.fi-board .vd.in{color:#5ee6d8 !important;background:rgba(15,118,110,.25) !important}

/* gọn: dòng thấp, nhiều dòng */
table tbody tr{height:auto !important}
.aside-head{background:#fff !important;background-image:none !important;border:0 !important;box-shadow:none !important;border-bottom:1px solid var(--x-line) !important}
.aside-head .modes{border:0 !important;box-shadow:none !important}

/* ================= BỐ CỤC MỚI ================= */
/* Header 1 hàng gọn */
header#mdRoom{min-height:72px !important;padding:6px 16px !important;align-items:center !important}
header#mdRoom .brand{transform:scale(.82);transform-origin:center}
/* Nút header: ô vuông trắng, icon đỏ, chữ nhỏ — kiểu tile */
header .btn,header .ai-fab{
  background:#fff !important;color:var(--x-ink) !important;-webkit-text-fill-color:var(--x-ink) !important;
  border:1px solid var(--x-line) !important;box-shadow:none !important;border-radius:10px !important;
}
header .btn svg,header .btn svg *{stroke:var(--x-red) !important;color:var(--x-red) !important}
header .btn:hover{background:var(--x-red-50) !important;border-color:var(--x-red) !important;color:var(--x-red) !important;-webkit-text-fill-color:var(--x-red) !important}
header .ai-fab{background:var(--x-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border-color:var(--x-red) !important}

/* Khung chính: menu dọc trái | bảng | chi tiết */
.body{grid-template-columns:minmax(0,1fr) calc(420px + 5cm) !important;padding-left:274px !important;gap:12px !important;padding-top:12px !important;padding-right:12px !important}
/* Check NOTAM: bản đồ bên phải nới rộng sang trái thêm 5cm */
.app > .body:has(#wrapNotam:not([style*="none"])){grid-template-columns:minmax(0,1fr) calc(420px + 10cm) !important}
.aside-head{
  position:fixed !important;left:0 !important;top:var(--x-top,99px) !important;bottom:0 !important;width:262px !important;display:block !important;z-index:30 !important;
  background:#fff !important;border-right:1px solid var(--x-line) !important;border-bottom:0 !important;padding:16px 10px !important;overflow-y:auto !important;
}
.aside-head::before{content:"OPERATIONS";display:block;font:800 11.5px var(--x-sans);letter-spacing:.2em;color:#788494;padding:2px 12px 13px}
.aside-head .modes{flex-direction:column !important;align-items:stretch !important;gap:3px !important;padding:0 !important;background:transparent !important;flex-wrap:nowrap !important;overflow:visible !important}
.aside-head .mode,.mode{
  white-space:nowrap !important;overflow:visible !important;justify-content:flex-start !important;text-align:left !important;flex:0 0 auto !important;width:100% !important;margin:0 !important;
  padding:10px 12px !important;height:auto !important;
  background:transparent !important;color:var(--x-ink2) !important;-webkit-text-fill-color:var(--x-ink2) !important;
  border-radius:10px !important;box-shadow:none !important;font-size:13px !important;font-weight:500 !important;gap:11px !important;
}
.mode *:not(.mode-bang):not(.mode-bang *){color:inherit !important;-webkit-text-fill-color:inherit !important}
.mode svg,.mode svg *{stroke:var(--x-mute) !important}
.aside-head .mode:hover,.mode:hover{background:#E9EDF3 !important;color:#04060A !important;-webkit-text-fill-color:#04060A !important;font-weight:700 !important}
.aside-head .mode.on,.mode.on{
  background:var(--x-red-50) !important;color:var(--x-red) !important;-webkit-text-fill-color:var(--x-red) !important;font-weight:800 !important;
  box-shadow:inset 4px 0 0 var(--x-red) !important;
}
  .mode.on svg,.mode.on svg *{stroke:var(--x-red) !important}
 /* Giữ icon màu đỏ trên dòng đang chọn — không tô trắng phủ mất icon */
 .mode.on::before{background:var(--x-red) !important}
 .mode-bang,.mode .mode-bang{top:50% !important;transform:translateY(-50%);right:10px !important;left:auto !important;border-color:#fff !important}
/* Icon tab: to hơn một tí để dễ nhận ra từng chức năng. */
.aside-head .mode::before,.modes .mode::before{width:19px !important;height:19px !important;-webkit-mask-size:19px !important;mask-size:19px !important}

/* ===== MỖI TAB MỘT HÌNH + MỘT MÀU RIÊNG (theo mẫu thiết kế) =====
   Selector đặc biệt dài (.aside-head .modes .mode#id::before) để chắc chắn thắng
   hình/màu cũ trong page.html bất kể thứ tự nạp kiểu. Màu nền không dùng
   !important, nên dòng đang chọn vẫn đỏ nổi bật. */
.aside-head .modes .mode#mFplText::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Cpath d='M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'/%3E%3Cpath d='M14 3v5h5M9 13h6M9 17h4'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Cpath d='M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'/%3E%3Cpath d='M14 3v5h5M9 13h6M9 17h4'/%3E%3C/svg%3E");background:#D31027}
/* Giao ca: hai người — trước đây chỉ là một khối tím đặc vì thiếu hình. */
.aside-head .modes .mode#mHandover::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='9' cy='7' r='4'/%3E%3Cpath d='M22 21v-2a4 4 0 0 0-3-3.87'/%3E%3Cpath d='M16 3.13a4 4 0 0 1 0 7.75'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='9' cy='7' r='4'/%3E%3Cpath d='M22 21v-2a4 4 0 0 0-3-3.87'/%3E%3Cpath d='M16 3.13a4 4 0 0 1 0 7.75'/%3E%3C/svg%3E");background:#6366F1}
.aside-head .modes .mode#mGeneral::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Crect x='3' y='3' width='7' height='7' rx='1.5'/%3E%3Crect x='14' y='3' width='7' height='7' rx='1.5'/%3E%3Crect x='3' y='14' width='7' height='7' rx='1.5'/%3E%3Crect x='14' y='14' width='7' height='7' rx='1.5'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Crect x='3' y='3' width='7' height='7' rx='1.5'/%3E%3Crect x='14' y='3' width='7' height='7' rx='1.5'/%3E%3Crect x='3' y='14' width='7' height='7' rx='1.5'/%3E%3Crect x='14' y='14' width='7' height='7' rx='1.5'/%3E%3C/svg%3E");background:#E11D48}
/* Dữ liệu so sánh: ba cột biểu đồ. */
.aside-head .modes .mode#mCompare::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Crect x='3' y='12' width='4.5' height='9' rx='1.6'/%3E%3Crect x='9.75' y='3' width='4.5' height='18' rx='1.6'/%3E%3Crect x='16.5' y='8' width='4.5' height='13' rx='1.6'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Crect x='3' y='12' width='4.5' height='9' rx='1.6'/%3E%3Crect x='9.75' y='3' width='4.5' height='18' rx='1.6'/%3E%3Crect x='16.5' y='8' width='4.5' height='13' rx='1.6'/%3E%3C/svg%3E");background:#0D9488}
.aside-head .modes .mode#mTool::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14.7 6.3a4.5 4.5 0 0 0-6.5 6.5L3 18l3 3 5.3-5.3a4.5 4.5 0 0 0 6.5-6.5L16 11l-3-3 1.7-1.7z'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14.7 6.3a4.5 4.5 0 0 0-6.5 6.5L3 18l3 3 5.3-5.3a4.5 4.5 0 0 0 6.5-6.5L16 11l-3-3 1.7-1.7z'/%3E%3C/svg%3E");background:#F97316}
.aside-head .modes .mode#mNotam::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Cpath d='M7 3h7l5 5v13H7z'/%3E%3Cpath d='M14 3v5h5M9 13h6M9 17h4'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Cpath d='M7 3h7l5 5v13H7z'/%3E%3Cpath d='M14 3v5h5M9 13h6M9 17h4'/%3E%3C/svg%3E");background:#EAB308}
.aside-head .modes .mode#mVer::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linejoin='round'%3E%3Cpath d='M12 2 3 7l9 5 9-5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linejoin='round'%3E%3Cpath d='M12 2 3 7l9 5 9-5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5'/%3E%3C/svg%3E");background:#10B981}
/* Tự động tải: mũi tên rơi vào khay. */
.aside-head .modes .mode#mFpl::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3v11'/%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3Cpath d='M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3v11'/%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3Cpath d='M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'/%3E%3C/svg%3E");background:#0284C7}
.aside-head .modes .mode#mAtcCheck::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v.01'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v.01'/%3E%3C/svg%3E");background:#BE123C}
/* Giới hạn tàu: bóng máy bay chếch lên. */
.aside-head .modes .mode#mLimits::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'/%3E%3C/svg%3E");background:#7C3AED}
.aside-head .modes .mode#mNoticeRules::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='4'/%3E%3Cpath d='M12 8v8M8 12h8'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='4'/%3E%3Cpath d='M12 8v8M8 12h8'/%3E%3C/svg%3E");background:#EC4899}
.aside-head .modes .mode#mAftn::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='2' y='4' width='20' height='16' rx='2.5'/%3E%3Cpath d='m6 9 4 4-4 4'/%3E%3Cpath d='M13 17h5'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='2' y='4' width='20' height='16' rx='2.5'/%3E%3Cpath d='m6 9 4 4-4 4'/%3E%3Cpath d='M13 17h5'/%3E%3C/svg%3E");background:#3B82F6}
/* Database: trụ dữ liệu 3 tầng. */
.aside-head .modes .mode#mDatabase::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cellipse cx='12' cy='5' rx='9' ry='3'/%3E%3Cpath d='M3 5v14a9 3 0 0 0 18 0V5'/%3E%3Cpath d='M3 12a9 3 0 0 0 18 0'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cellipse cx='12' cy='5' rx='9' ry='3'/%3E%3Cpath d='M3 5v14a9 3 0 0 0 18 0V5'/%3E%3Cpath d='M3 12a9 3 0 0 0 18 0'/%3E%3C/svg%3E");background:#0D9488}
/* Quản lí tài khoản: một người kèm bánh răng phía sau. */
.aside-head .modes .mode#opsAcctManage::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='9' cy='7' r='4'/%3E%3Cpath d='M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2'/%3E%3Ccircle cx='18' cy='16' r='2.5'/%3E%3Cpath d='M18 11.5V10M18 22v-1.5M22.5 16H21M15 16h-1.5M21.2 12.8l-1 1M15.8 19.2l-1 1M21.2 19.2l-1-1M15.8 12.8l1 1'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='9' cy='7' r='4'/%3E%3Cpath d='M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2'/%3E%3Ccircle cx='18' cy='16' r='2.5'/%3E%3Cpath d='M18 11.5V10M18 22v-1.5M22.5 16H21M15 16h-1.5M21.2 12.8l-1 1M15.8 19.2l-1 1M21.2 19.2l-1-1M15.8 12.8l1 1'/%3E%3C/svg%3E");background:#475569}

/* ===== SỐ NGƯỜI ĐANG ONLINE CẠNH "QUẢN LÍ TÀI KHOẢN" =====
   Số đứng trước, chấm xanh nhấp nháy phía sau — pill xanh lá rõ, chữ to dễ đọc. */
.aside-head .modes .mode#opsAcctManage .ops-live{
  position:static !important;display:inline-flex !important;visibility:visible !important;opacity:1 !important;
  align-items:center;gap:6px;margin-left:auto !important;flex:0 0 auto !important;
  padding:3px 9px 3px 8px;border-radius:999px;background:#fff !important;
  border:1px solid #D1FAE5 !important;box-shadow:0 1px 2px rgba(15,23,42,.08),0 0 0 3px rgba(22,163,74,.06) !important;animation:none !important}
.aside-head .modes .mode#opsAcctManage .ops-live .ops-live-n{font:800 13px/1 var(--x-sans) !important;color:#0F172A !important;-webkit-text-fill-color:#0F172A !important;font-variant-numeric:tabular-nums}
.aside-head .modes .mode#opsAcctManage .ops-live .ops-live-t{font:600 10px/1 var(--x-sans) !important;color:#16A34A !important;-webkit-text-fill-color:#16A34A !important;text-transform:uppercase;letter-spacing:.06em}
.aside-head .modes .mode#opsAcctManage .ops-live .ops-live-d{width:8px;height:8px;border-radius:50%;background:#22C55E !important;animation:ops-live-pulse 1.7s ease-out infinite}
.aside-head .modes .mode#opsAcctManage .ops-live.off{border-color:#E2E8F0 !important;box-shadow:none !important}
.aside-head .modes .mode#opsAcctManage .ops-live.off .ops-live-n,.aside-head .modes .mode#opsAcctManage .ops-live.off .ops-live-t{color:#94A3B8 !important;-webkit-text-fill-color:#94A3B8 !important}
.aside-head .modes .mode#opsAcctManage .ops-live.off .ops-live-d{background:#CBD5E1 !important;animation:none !important}
@keyframes ops-live-pulse{
  0%{box-shadow:0 0 0 2px rgba(22,163,74,.34),0 0 8px rgba(22,163,74,.5)}
  65%{box-shadow:0 0 0 8px rgba(22,163,74,0),0 0 12px rgba(22,163,74,.32)}
  100%{box-shadow:0 0 0 2px rgba(22,163,74,.34),0 0 8px rgba(22,163,74,.5)}
}
/* ===== NHÃN ĐẾM TRÊN TAB: vòng hổ phách cho số, viên xanh đậm cho chữ "Ver" ===== */
.aside-head .modes .mode-bang#genBang,.aside-head .modes .mode-bang#estBang{
  background:#FBBF24 !important;color:#1E293B !important;-webkit-text-fill-color:#1E293B !important;
  border:0 !important;border-radius:999px !important;min-width:24px !important;height:24px !important;
  font-size:12.5px !important;font-weight:800 !important;box-shadow:0 1px 4px rgba(120,90,10,.35) !important;
}
.aside-head .modes .mode-bang#verBang.on{
  background:#15803D !important;color:#fff !important;-webkit-text-fill-color:#fff !important;
  border:0 !important;border-radius:999px !important;min-width:54px !important;height:24px !important;
  padding:0 9px !important;font-size:12.5px !important;font-weight:800 !important;
}
.aside-head .modes .mode-bang#verBang.on{
  top:-7px !important;right:4px !important;transform:none !important;min-width:0 !important;height:18px !important;padding:0 2px 0 6px !important;gap:4px !important;z-index:25 !important;
  background:#fff !important;color:#0F172A !important;-webkit-text-fill-color:#0F172A !important;
  border:1px solid #CBD5E1 !important;box-shadow:0 1px 3px rgba(15,23,42,.12) !important;
  font-size:11px !important;letter-spacing:.3px !important;animation:none !important;opacity:1 !important}
.aside-head .modes .mode-bang#verBang .vb-dot{width:7px;height:7px;border-radius:50%;background:#16a34a;display:inline-block}
.aside-head .modes .mode-bang#verBang .vb-lab{font-weight:700;color:#64748B;-webkit-text-fill-color:#64748B}
.aside-head .modes .mode-bang#verBang .vb-no{background:#16a34a;color:#fff;-webkit-text-fill-color:#fff;border-radius:999px;padding:1px 6px;font-size:10.5px;font-weight:800}
.aside-head .modes .mode-bang#verBang.flash{border-color:#FCA5A5 !important;background:#FEF2F2 !important;animation:vbGlow 1.4s ease-in-out infinite !important}
.aside-head .modes .mode-bang#verBang.flash .vb-dot{background:#DC2626;animation:vbDot 1.4s ease-out infinite}
.aside-head .modes .mode-bang#verBang.flash .vb-no{background:#DC2626}
.aside-head .modes .mode-bang#verBang.flash .vb-lab{color:#B91C1C;-webkit-text-fill-color:#B91C1C}
@keyframes vbGlow{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.35)}50%{box-shadow:0 0 0 4px rgba(220,38,38,.12)}}
@keyframes vbDot{0%{box-shadow:0 0 0 0 rgba(220,38,38,.7)}100%{box-shadow:0 0 0 6px rgba(220,38,38,0)}}

/* Bảng: không khối đỏ — đầu bảng trắng chữ đỏ, gạch đỏ; dòng thoáng phẳng */
aside,main.split2{border-radius:12px !important;overflow:hidden}
table thead th,table > tr:first-child > th,.tooltbl th{
  background:var(--x-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;
  border-bottom:2px solid var(--x-yel) !important;
}
table thead th *{color:#fff !important;-webkit-text-fill-color:#fff !important}
/* Ô nhập/select trong ô đầu bảng: nền trắng chữ đen, không kế thừa fill trắng */
table thead th input,table thead th select,table thead th textarea{
  color:#1a1a1a !important;-webkit-text-fill-color:#1a1a1a !important;background:#fff !important;
}
table tbody tr:nth-child(even) > td{background:#fff}

table tbody td{border-bottom:1px solid var(--x-line2) !important}
table tbody tr:hover > td{background:#FAFBFC !important}
table tbody tr.sel > td,table tbody tr.on > td,table tbody tr.active > td,table tbody tr.selected > td{background:var(--x-red-50) !important}
/* Trạng thái: chấm + chữ thay vì viên thuốc đậm */
.status,td .vd{border-radius:6px !important;font-family:var(--x-sans) !important;font-weight:600 !important}

/* Tab chi tiết: dạng gạch chân */
.detail-tabs{border-bottom:1px solid var(--x-line) !important;padding:0 12px !important;gap:14px !important}
.dtab{padding:10px 2px !important;border-radius:0 !important}
/* Thanh công cụ con: nút viền mảnh */
.toolbar .btn,.toolbars .btn,.subtabs .btn,.sheet .btn,.lim-pane .btn{
  background:#fff !important;color:var(--x-red) !important;-webkit-text-fill-color:var(--x-red) !important;
  border:1px solid var(--x-red) !important;box-shadow:none !important;border-radius:8px !important;
}
.toolbar .btn:hover,.toolbars .btn:hover,.subtabs .btn:hover,.sheet .btn:hover,.lim-pane .btn:hover{background:var(--x-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important}
/* Nút nền đỏ đặc (primary / t-go / act): chữ trắng, không bị che */
.btn.primary,.btn.t-go,.btn.act,.btn[aria-pressed="true"],
.toolbar .btn.primary,.toolbars .btn.primary,.toolbars .btn.t-go,.toolbar .btn.t-go,.subtabs .btn.primary,.sheet .btn.primary,.lim-pane .btn.primary{
  background:var(--x-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border-color:var(--x-red) !important;
}
.btn.primary *,.btn.t-go *,.btn.act *{color:#fff !important;-webkit-text-fill-color:#fff !important}
#wrapAtcCheck .toolbar2 .btn:not(.primary):not(.t-go){background:#fff !important;color:#E31937 !important;-webkit-text-fill-color:#E31937 !important;border:1px solid rgba(227,25,55,.25) !important}
#wrapAtcCheck .toolbar2 .btn:not(.primary):not(.t-go):hover{background:#E31937 !important;color:#fff !important;-webkit-text-fill-color:#fff !important}
.xt-kg{min-width:0 !important}.xt-min{margin-right:3px !important;min-width:30px !important;padding:0 3px !important}td.extra-cell{overflow:hidden !important;white-space:nowrap !important}

/* ================= HEADER OPS — thành phần thật, bố cục theo ảnh tham chiếu ================= */
header#mdRoom{
  position:relative !important;
  min-height:172px !important;height:172px !important;padding:0 !important;box-sizing:border-box !important;
  display:block !important;overflow:hidden !important;
  background-color:#fff !important;background-image:linear-gradient(90deg,rgba(255,255,255,.08),rgba(255,255,255,.01)),var(--airport-clean) !important;
  background-size:cover !important;background-position:center 54% !important;background-repeat:no-repeat !important;
  background-position:center center !important;background-size:cover !important;background-repeat:no-repeat !important;
  border:0 !important;box-shadow:0 8px 22px rgba(20,36,52,.18) !important;
}
header#mdRoom .hdr-sky,header#mdRoom .brand-peek,header#mdRoom .room,header#mdRoom .rays,
header#mdRoom .leaves,header#mdRoom .sakura,header#mdRoom .hotaru,header#mdRoom .tsuki,
header#mdRoom .tsuru,header#mdRoom .furin,header#mdRoom .vignette,header#mdRoom .ranma,
header#mdRoom .hashira,header#mdRoom .sudare,header#mdRoom .toko,header#mdRoom .beam,
header#mdRoom .shoji,header#mdRoom .noren,header#mdRoom .tatami,header#mdRoom .engawa,
header#mdRoom .zabuton,header#mdRoom .menu,header#mdRoom .incense,header#mdRoom .tenugui,
header#mdRoom .kusari,header#mdRoom .tsukubai,header#mdRoom .toro,header#mdRoom .hibachi,
header#mdRoom .hishaku,header#mdRoom .wagashi,header#mdRoom .yunomi,header#mdRoom .byobu,
header#mdRoom .sensu,header#mdRoom .grain,header#mdRoom .md-kanban,header#mdRoom .md-sign,
header#mdRoom .md-set,header#mdRoom .md-open{display:none !important}
header#mdRoom .md-fit{display:block !important;position:static !important;width:100% !important;height:100% !important}
header#mdRoom::before{content:"";display:block !important;position:absolute;left:0;top:0;width:15.2%;height:100%;z-index:10;background:linear-gradient(118deg,var(--x-red) 0 76%,var(--x-yel) 76% 80%,rgba(255,255,255,.92) 80% 84%,transparent 84%);pointer-events:none}
.ops-header-brand{display:block !important;position:absolute;left:1.25%;top:12px;width:12.4%;height:150px;z-index:16;color:#fff;text-transform:uppercase}
.ops-vj-mark{display:flex;align-items:center;gap:9px}.ops-vj-mark .ops-vj-logo{display:block;width:138px;height:41px;background:var(--vj-logo) center/contain no-repeat;filter:brightness(0) invert(1)}.ops-vj-mark>span:last-child{font:800 11px/1.2 var(--x-sans);color:#fff;letter-spacing:.06em}
.ops-sohee{display:flex;align-items:baseline;gap:8px;margin-top:10px;padding-top:8px;border-top:2px solid var(--x-yel);text-transform:none;white-space:nowrap}
.ops-sohee strong{color:#fff;font:900 26px/1 var(--x-sans);letter-spacing:.02em;text-shadow:0 1px 6px rgba(15,23,42,.45)}
.ops-sohee span{color:rgba(255,255,255,.94);font:600 14px/1 var(--x-sans);letter-spacing:.04em;text-shadow:0 1px 5px rgba(15,23,42,.4)}
.ops-header-live{position:absolute;right:0;top:0;height:78px;display:flex;align-items:center;gap:0;z-index:24;color:#fff;padding:0 17px 0 21px;border:0;border-radius:0 0 0 18px;background:linear-gradient(90deg,rgba(20,30,40,.68),rgba(12,22,32,.84));box-shadow:-10px 10px 28px rgba(20,36,52,.18);backdrop-filter:blur(10px) saturate(1.16)}
.ops-weather{height:56px;display:grid;grid-template-columns:36px auto auto;align-items:center;gap:9px;padding-right:20px;border-right:1px solid rgba(255,255,255,.5)}.ops-weather-icon{font-size:30px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.25))}.ops-weather>strong{font:800 22px/1 var(--x-sans);color:#fff}.ops-weather>span:last-child{display:flex;flex-direction:column;gap:6px}.ops-weather b,.ops-weather small{font:900 12px/1.05 var(--x-sans);letter-spacing:.02em;color:#fff}.ops-weather small{font-weight:600;font-size:11px;color:rgba(255,255,255,.85);text-transform:none}
.ops-clock-wrap{height:56px;display:flex;align-items:center;gap:10px;padding:0 20px;border-right:1px solid rgba(255,255,255,.5)}.ops-clock-icon{display:grid;place-items:center;width:28px;height:28px;color:#fff}.ops-clock-icon svg{width:100%;height:100%}.ops-clock{display:flex;flex-direction:column;align-items:center;min-width:96px}.ops-clock strong{font:800 22px/1 var(--x-mono);color:#fff}.ops-clock span{margin-top:6px;font:800 12px/1 var(--x-sans);letter-spacing:.02em;color:#fff}
.ops-account{display:flex;align-items:center;gap:11px;padding-left:20px}.ops-avatar{width:36px;height:36px;display:grid;place-items:center;border:2px solid #fff;border-radius:50%;background:var(--x-red);box-shadow:0 3px 10px rgba(0,0,0,.3);color:#fff;font:800 11px var(--x-sans)}.ops-account-chevron{width:8px;height:8px;border-right:2px solid rgba(255,255,255,.9);border-bottom:2px solid rgba(255,255,255,.9);transform:rotate(45deg) translateY(-2px)}
.ops-account-btn{display:flex;align-items:center;gap:11px;margin:0;padding:0;border:0;background:none;cursor:pointer;font:inherit}.ops-acct-menu{position:absolute;right:17px;top:70px;min-width:246px;z-index:90;display:flex;flex-direction:column;padding:10px;border:1px solid rgba(255,255,255,.28);border-radius:14px;background:linear-gradient(180deg,#16222e,#0d1722);box-shadow:0 18px 42px rgba(10,18,28,.45)}.ops-acct-menu[hidden]{display:none}.ops-acct-who{display:flex;flex-direction:column;gap:5px;padding:2px 4px 10px;border-bottom:1px solid rgba(255,255,255,.18)}.ops-acct-who small{font:700 10px/1 var(--x-sans);letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.7)}.ops-acct-who strong{font:700 13px/1.2 var(--x-mono);color:#fff;word-break:break-all}.ops-acct-out{margin-top:10px;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;border:0;border-radius:10px;background:var(--x-red);color:#fff;font:800 13px var(--x-sans);letter-spacing:.02em;cursor:pointer}.ops-acct-out:hover{filter:brightness(1.1)}
/* Compact ivory-free utility strip; its bottom stays above both action rows. */
header#mdRoom .ops-header-live{top:8px;right:12px;height:62px;padding:0 14px;border:1px solid var(--ops-panel-line);border-top:3px solid var(--ops-panel-accent);border-radius:8px;background:var(--ops-panel);color:var(--ops-panel-ink);box-shadow:var(--ops-panel-shadow);backdrop-filter:blur(12px)}
header#mdRoom .ops-weather,header#mdRoom .ops-clock-wrap{height:40px;border-color:var(--ops-panel-line)}
header#mdRoom .ops-weather{grid-template-columns:30px auto auto;gap:8px;padding-right:16px}
header#mdRoom .ops-weather-icon{font-size:26px;filter:none}
header#mdRoom .ops-weather>strong,header#mdRoom .ops-clock strong{font-size:22px;color:var(--ops-panel-ink)}
header#mdRoom .ops-weather b,header#mdRoom .ops-clock span{color:var(--ops-panel-ink);letter-spacing:0}
header#mdRoom .ops-weather small{color:var(--ops-panel-muted)}
header#mdRoom .ops-clock-wrap{padding:0 16px;gap:8px}
header#mdRoom .ops-clock-icon{width:24px;height:24px;color:var(--ops-panel-accent)}
header#mdRoom .ops-account{padding-left:14px}
header#mdRoom .ops-account-btn{min-height:40px;padding:2px 4px;border-radius:6px}
header#mdRoom .ops-avatar{width:36px;height:36px;border-color:var(--ops-panel-accent);background:var(--ops-panel-accent);color:var(--ops-panel-on-accent);box-shadow:none}
header#mdRoom .ops-account-chevron{border-color:var(--ops-panel-muted)}
header#mdRoom .ops-account-btn:hover{background:var(--ops-panel-line)}
header#mdRoom .ops-account-btn:focus-visible{outline:2px solid var(--ops-panel-accent);outline-offset:3px}
#opsAcctMenu{position:absolute;right:auto;top:0;z-index:10000;width:310px;min-width:0;max-width:calc(100vw - 16px);box-sizing:border-box;padding:8px;border-radius:8px;background:var(--ops-panel);border:1px solid var(--ops-panel-line);box-shadow:var(--ops-panel-shadow);overflow-y:auto;letter-spacing:0;animation:ops-account-in .16s ease-out}
#opsAcctMenu .ops-acct-who{padding:12px 12px 16px;margin-bottom:6px;border-color:var(--ops-panel-line);gap:7px}
#opsAcctMenu .ops-acct-who small{color:var(--ops-panel-muted);font:600 12px/1.3 var(--x-sans);letter-spacing:0}
#opsAcctMenu .ops-acct-who strong{color:var(--ops-panel-ink);font:700 15px/1.5 var(--x-sans);overflow-wrap:anywhere}
#opsAcctMenu .ops-acct-action{display:flex;align-items:center;justify-content:flex-start;width:100%;min-height:58px;gap:12px;margin:0;padding:10px 12px;border:0 !important;border-radius:6px;background:transparent !important;color:var(--ops-panel-ink) !important;-webkit-text-fill-color:currentColor !important;text-align:left;box-shadow:none !important;white-space:normal;letter-spacing:0}
#opsAcctMenu .ops-acct-action *{-webkit-text-fill-color:currentColor !important}
#opsAcctMenu .ops-acct-action:hover{background:color-mix(in oklch,var(--ops-panel-line) 45%,var(--ops-panel)) !important}
#opsAcctMenu .ops-acct-action:focus-visible{outline:2px solid var(--ops-panel-accent);outline-offset:-2px}
#opsAcctMenu .ops-acct-action b{display:block;font:700 15px/1.4 var(--x-sans)}
#opsAcctMenu .ops-acct-action small{display:block;margin-top:2px;color:var(--ops-panel-muted);font:500 13px/1.4 var(--x-sans)}
#opsAcctMenu .ops-acct-icon{display:grid;place-items:center;flex:0 0 36px;height:36px;border-radius:6px;color:var(--ops-panel-accent);background:color-mix(in oklch,var(--ops-panel-accent) 8%,var(--ops-panel))}
#opsAcctMenu .ops-acct-icon svg{width:20px;height:20px}
#opsAcctMenu .ops-acct-arrow{margin-left:auto;font-size:24px;color:var(--ops-panel-muted)}
#opsAcctMenu .ops-acct-logout{margin-top:6px;border-top:1px solid var(--ops-panel-line) !important;border-radius:0 0 6px 6px;color:var(--ops-panel-accent) !important}
@keyframes ops-account-in{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){#opsAcctMenu{animation:none}}
/* Sáu bộ lọc thật, cùng một hàng trên panel trắng. */
header#mdRoom .md-stage{
  display:block !important;position:absolute !important;left:38px !important;top:58% !important;
  width:calc(37% - 41px) !important;height:35.08% !important;padding:0 !important;margin:0 !important;z-index:18 !important;
}
header#mdRoom .md-denpyo{
  display:grid !important;grid-template-columns:1.18fr .92fr .84fr .84fr 1fr 1.4fr !important;
  align-items:stretch !important;gap:0 !important;width:100% !important;height:100% !important;
  padding:6px 4px !important;margin:0 !important;background:rgba(255,255,255,.96) !important;
  border:1px solid rgba(255,255,255,.95) !important;border-radius:10px !important;box-shadow:0 8px 22px rgba(20,36,52,.14) !important;backdrop-filter:blur(12px) !important;position:relative !important;
}
#ftPreviewBtn{display:none !important}
#ftExport{background:var(--x-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;border:1.5px solid var(--x-red) !important;box-shadow:0 2px 6px rgba(227,25,55,.28) !important}
#ftExport:hover{filter:brightness(1.06)}
#wrapFplText .ftdsp.ftefb{padding:4px 8px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;display:flex;align-items:center;gap:6px;font-weight:700;white-space:nowrap;flex:0 0 auto}
#wrapFplText .ftdsp.ftefb input{width:300px;min-width:300px;flex:1 1 auto;background:#fff;border:1px solid var(--line);border-radius:var(--radius)}
#wrapFplText .efb-refresh{border:1px solid rgba(227,25,55,.25);background:#fff;color:#E31937;border-radius:8px;width:26px;height:26px;font-size:14px;font-weight:800;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center}
#wrapFplText .efb-refresh:hover{background:#E31937;color:#fff}
#wrapFplText .efb-refresh:disabled{opacity:.5;cursor:wait}
html.night #wrapFplText .ftdsp.ftefb{background:#1e2430;border-color:#3a4050}
header#mdRoom .md-denpyo .head,header#mdRoom .md-denpyo .stamp,header#mdRoom .md-denpyo .md-cmd{display:none !important}
header#mdRoom .md-denpyo .md-row:not(.line){
  grid-column:1 !important;grid-row:1 !important;display:block !important;width:auto !important;height:100% !important;flex:none !important;
  padding:0 2px !important;margin:0 !important;position:static !important;border-right:1px solid rgba(32,42,56,.1) !important;
}
header#mdRoom .md-denpyo .md-row:not(.line)::after{display:none !important}
header#mdRoom .md-denpyo .filt-rail{
  display:contents !important;flex:none !important;min-width:0 !important;max-width:none !important;
  padding:0 !important;margin:0 !important;border:0 !important;background:transparent !important;box-shadow:none !important;
}
header#mdRoom .md-denpyo .filt-rail > *{position:static !important;min-width:0 !important;width:100% !important;height:100% !important;padding:0 2px !important;margin:0 !important;border-right:1px solid rgba(32,42,56,.1) !important}
header#mdRoom .md-denpyo .filt-rail > *:last-child{border-right:0 !important}
header#mdRoom .md-denpyo .filt-rail > *::after{display:none !important}
header#mdRoom .md-field{min-width:0 !important;width:100% !important;height:100% !important;display:grid !important;grid-template-rows:19px 30px !important;align-content:center !important;gap:2px !important}
header#mdRoom .md-field label,header#mdRoom .field label{
  display:flex !important;align-items:center !important;gap:4px !important;font-size:8px !important;line-height:1 !important;margin:0 !important;
  font-weight:900 !important;letter-spacing:0 !important;color:var(--x-ink) !important;opacity:1 !important;text-transform:uppercase !important;white-space:nowrap !important;overflow:hidden !important;
}
header#mdRoom .md-field label .cl-txt{display:inline !important;font:inherit !important;color:inherit !important;margin:0 !important;overflow:hidden !important;text-overflow:ellipsis !important}
.ops-field-icon{display:inline-grid !important;place-items:center !important;width:13px !important;height:13px !important;flex:0 0 13px !important;color:var(--x-red) !important}.ops-field-icon svg{display:block !important;width:100% !important;height:100% !important}
header#mdRoom .md-field label i.jp,header#mdRoom .field label i.jp{display:none !important}
header#mdRoom input,header#mdRoom select{
  width:100% !important;height:30px !important;border:1px solid rgba(49,61,76,.14) !important;border-radius:7px !important;
  background:#fff !important;box-shadow:0 2px 8px rgba(22,38,53,.07) !important;font:800 10.5px var(--x-sans) !important;
  color:#16181d !important;-webkit-text-fill-color:#16181d !important;padding:0 7px !important;
}
header#mdRoom select{font-size:9.5px !important;padding:0 4px !important;letter-spacing:0 !important}
header#mdRoom #fDispatcher{color:#16181d !important;-webkit-text-fill-color:#16181d !important}
header#mdRoom input::placeholder{color:rgba(22,24,29,.42) !important;-webkit-text-fill-color:rgba(22,24,29,.42) !important}
header#mdRoom input:focus,header#mdRoom select:focus{background:#fff !important;border-color:var(--x-red) !important;box-shadow:0 0 0 3px rgba(227,25,55,.12) !important;outline:none !important}
header#mdRoom .md-denpyo .md-row:not(.line){height:100% !important}
header#mdRoom .md-field label::before,header#mdRoom .md-field label::after{display:none !important}
/* --- Nút Refresh/TAF/Crew/Acc: hàng dưới của panel phải (neo theo header) --- */
header#mdRoom .filt-actions{
  position:absolute !important;top:120px !important;right:.68% !important;bottom:auto !important;left:auto !important;
  display:grid !important;grid-template-columns:repeat(5,1fr) !important;gap:6px !important;align-items:stretch !important;
  width:20.8% !important;height:44px !important;flex:none !important;padding:4px !important;border:1px solid var(--ops-panel-line) !important;border-radius:8px !important;margin:0 !important;z-index:20 !important;background:var(--ops-panel) !important;box-shadow:var(--ops-panel-shadow) !important;backdrop-filter:blur(14px) saturate(1.15) !important;
}
header#mdRoom .filt-actions .btn{
  height:100% !important;min-width:0 !important;padding:3px 2px !important;border:1px solid rgba(255,255,255,.96) !important;border-radius:9px !important;
  background:rgba(255,255,255,.96) !important;color:var(--x-ink) !important;-webkit-text-fill-color:var(--x-ink) !important;
  box-shadow:0 5px 13px rgba(22,38,53,.15),inset 0 1px 0 rgba(255,255,255,.96) !important;font:900 10.5px/1.05 var(--x-sans) !important;
  display:flex !important;flex-direction:column !important;align-items:center !important;justify-content:center !important;gap:3px !important;
  text-transform:uppercase !important;letter-spacing:0 !important;opacity:1 !important;cursor:pointer !important;
}
header#mdRoom .filt-actions .btn::before{display:block !important;content:attr(data-ico) !important;font:700 15px/1 var(--x-sans) !important;color:var(--x-red) !important}
header#mdRoom .filt-actions .btn::before,header#mdRoom #btnOfpCheck::before,header#mdRoom #aiFab::before{display:none !important}
header#mdRoom .filt-actions .ops-field-icon,header#mdRoom #btnOfpCheck .ops-field-icon,header#mdRoom #aiFab .ops-field-icon{width:18px !important;height:18px !important;flex:0 0 18px !important;color:var(--x-red) !important}
header#mdRoom .filt-actions #btnAcc .who{display:block !important;color:var(--x-ink) !important;-webkit-text-fill-color:var(--x-ink) !important;font:900 10.5px/1 var(--x-sans) !important}
header#mdRoom .filt-actions .btn:hover{background:var(--x-red) !important;border-color:var(--x-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;transform:translateY(-2px) !important;box-shadow:0 8px 16px rgba(176,16,40,.28) !important}header#mdRoom .filt-actions .btn:hover .ops-field-icon{color:#fff !important}
header#mdRoom .filt-actions #btnAcc:hover .who{color:#fff !important;-webkit-text-fill-color:#fff !important}
header#mdRoom .filt-actions .btn:active{transform:translateY(1px) !important;box-shadow:0 2px 6px rgba(22,38,53,.16) !important}
/* --- GIỮA: Dispatch Board --- */
header#mdRoom .brand{
  display:none !important;
}
header#mdRoom .brand-txt{display:block !important;padding:0 !important;position:relative !important;text-align:center !important}
header#mdRoom .brand h1{position:relative !important;font-size:26px !important;line-height:1 !important;white-space:nowrap !important;text-transform:uppercase !important;color:#fff !important;-webkit-text-fill-color:#fff !important}
header#mdRoom .brand h1 .brand-board{color:#fff !important;-webkit-text-fill-color:#fff !important}
header#mdRoom .brand h1::before{display:none !important}
header#mdRoom .brand .sig{font-size:8px !important;white-space:nowrap !important;letter-spacing:.14em !important;color:#fff !important;-webkit-text-fill-color:#fff !important;opacity:.9 !important;margin-top:8px !important;text-transform:uppercase !important}
header#mdRoom .brand-vj{display:block !important;margin-top:4px !important;font-size:8px !important;font-weight:800 !important;letter-spacing:.18em !important;color:var(--x-yellow) !important;-webkit-text-fill-color:var(--x-yellow) !important;text-transform:uppercase !important}
/* --- BÊN PHẢI: panel nút trắng, 2 hàng 4 phím đỏ --- */
header#mdRoom .head-right{
  display:block !important;width:100% !important;height:100% !important;padding:0 !important;margin:0 !important;
  border:0 !important;background:transparent !important;box-shadow:none !important;backdrop-filter:none !important;
  position:absolute !important;inset:0 !important;z-index:18 !important;pointer-events:none !important;
}
header#mdRoom .hstat,header#mdRoom .crew-jobs,header#mdRoom .live-ops,header#mdRoom #ofpCheckStat,header#mdRoom #btnQuit{display:none !important}
header#mdRoom .head-ops,header#mdRoom .md-hang,header#mdRoom .quit-sohee{display:contents !important}
header#mdRoom #btnOfpCheck,header#mdRoom #aiFab,header#mdRoom .hdr-switch,header#mdRoom .theme-switch{
  position:absolute !important;top:78px !important;width:3.7% !important;height:36px !important;min-width:0 !important;
  margin:0 !important;padding:3px 2px !important;border-radius:9px !important;box-shadow:0 5px 13px rgba(22,38,53,.15),inset 0 1px 0 rgba(255,255,255,.96) !important;
  display:flex !important;flex-direction:column !important;align-items:center !important;justify-content:center !important;gap:3px !important;
  background:rgba(255,255,255,.96) !important;border:1px solid rgba(255,255,255,.96) !important;color:var(--x-ink) !important;-webkit-text-fill-color:var(--x-ink) !important;font:900 10px/1.05 var(--x-sans) !important;
  opacity:1 !important;pointer-events:auto !important;cursor:pointer !important;
}
header#mdRoom #btnOfpCheck{left:83.14% !important}
header#mdRoom .hdr-switch{left:87.07% !important;right:auto !important;transform:none !important;visibility:visible !important}
header#mdRoom .theme-switch{left:91.02% !important;right:auto !important;transform:none !important;visibility:visible !important}
header#mdRoom #aiFab{left:94.95% !important;right:auto !important}
header#mdRoom #btnOfpCheck{background:var(--x-red) !important;border-color:var(--x-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;box-shadow:0 8px 18px rgba(176,16,40,.3),inset 0 1px 0 rgba(255,255,255,.22) !important}
header#mdRoom #btnOfpCheck .ops-field-icon{color:#fff !important}
header#mdRoom #btnOfpCheck small{display:none !important}
header#mdRoom #aiFab::before{content:"✦" !important;width:auto !important;height:auto !important;border-radius:0 !important;background:none !important;color:var(--x-red) !important;font-size:14px !important}
header#mdRoom #aiFab .n{font-size:10.5px !important;font-weight:900 !important;line-height:1.05 !important;color:var(--x-ink) !important;-webkit-text-fill-color:var(--x-ink) !important;text-transform:uppercase !important}header#mdRoom #aiFab .sub{display:none !important}
header#mdRoom #btnOfpCheck:hover,header#mdRoom #aiFab:hover,header#mdRoom .hdr-switch:hover,header#mdRoom .theme-switch:hover{background:var(--x-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;transform:translateY(-2px) !important;box-shadow:0 6px 12px rgba(176,16,40,.2) !important}
header#mdRoom #btnOfpCheck:active,header#mdRoom #aiFab:active,header#mdRoom .hdr-switch:active,header#mdRoom .theme-switch:active{transform:translateY(2px) !important;box-shadow:0 1px 0 #8f1026 !important}
header#mdRoom .hdr-switch-lab.l,header#mdRoom .hdr-switch-ui,header#mdRoom .theme-switch-lab.l,header#mdRoom .theme-switch-paw{display:none !important}
header#mdRoom .hdr-switch::before,header#mdRoom .theme-switch::before{display:none !important}
header#mdRoom .hdr-switch .ops-field-icon,header#mdRoom .theme-switch .ops-field-icon{width:17px !important;height:17px !important;flex:0 0 17px !important;color:currentColor !important}
header#mdRoom .hdr-switch-lab.r,header#mdRoom .theme-switch-lab.r{display:block !important;position:static !important;width:auto !important;height:auto !important;margin:0 !important;padding:0 !important;clip:auto !important;clip-path:none !important;overflow:visible !important;white-space:nowrap !important;font-size:10.5px !important;font-weight:900 !important;line-height:1.05 !important;color:var(--x-ink) !important;-webkit-text-fill-color:var(--x-ink) !important;opacity:1 !important;text-transform:uppercase !important}
.aside-head{top:180px !important}
/* ---------- PHỤ ---------- */
.tag,.chk{border-radius:999px !important}
.hint,.note{color:var(--x-mute) !important}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#C9CDD4 !important;border-radius:99px;border:2px solid #fff;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background:var(--x-red) !important;background-clip:padding-box}
</style>`;

/* ===== TĂNG CỠ CHỮ: mọi tab trừ tab "Tạo KHB" =====
   Tab Tạo KHB (#wrapFplText + vùng ft*) giữ nguyên như cũ; mọi tab còn lại
   (Hiển thị chung, So sánh, Ver, Tự động tải, Công cụ, Check NOTAM, Check ATC,
   Giới hạn, Giao ca, Thiết lập file add, bản đồ NOTAM) dùng cỡ chữ lớn hơn,
   kể cả tên tab trên menu trái. */
const FONTUP = `<style id="fontup-skin">
.aside-head .mode,.modes .mode{font-size:16.5px !important;line-height:1.4 !important;font-weight:650 !important}
.aside-head .mode#mFplText,.modes .mode#mFplText{font-size:16.5px !important}
/* Menu trái: chữ + icon to hơn, các tab giãn cách thoáng hơn. */
.aside-head .modes{gap:7px !important}
.aside-head{width:282px !important}
.body{padding-left:294px !important}
.aside-head .mode,.modes .mode{padding:12px 12px !important;gap:12px !important}
.aside-head .mode::before,.modes .mode::before{width:22px !important;height:22px !important;-webkit-mask-size:22px !important;mask-size:22px !important;flex:0 0 22px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack){
  font-size:14px !important;
}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) table{font-size:13.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) thead th{font-size:12px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) tbody td{font-size:13.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) td .vd{font-size:12.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .btn{font-size:13px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .btn.small{font-size:13px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) button:not(.btn){font-size:13px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) label{font-size:13.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .chk{font-size:13.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) input,
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) select,
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) textarea{font-size:13.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .dim{font-size:13px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .tag{font-size:13px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) code{font-size:13px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .empty{font-size:13.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .diffhead{font-size:14px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .diffhead .rn,
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .diffhead .tail{font-size:12.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .difftbl{font-size:13px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .maprow{font-size:13.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .maprow code{font-size:12.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .cmpsum{font-size:13.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .nr-hero-copy p{font-size:13px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .nr-slogan{font-size:13.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .vfile-btn,
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .vfile-pick,
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .vfile-empty{font-size:13.5px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .tool-row .tlbl{font-size:13px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .nm-verdict h4{font-size:16px !important}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .nm-verdict .nm-vd-sub,
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .nm-verdict .nm-vd-empty,
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) .nm-verdict li{font-size:13.5px !important}
</style>`;

/* ===== DROPDOWN: danh sách chọn to chữ, dễ đọc =====
   Danh sách gốc do trình duyệt vẽ nên không chỉnh được khoảng cách dòng lẫn
   khung; phần này giữ nguyên <select> (mọi chỗ đọc .value / bắn onchange vẫn
   chạy) nhưng khi bấm thì tự vẽ danh sách riêng: chữ 15px, dòng cao 40px,
   khung bo góc có bóng, có ô tìm khi nhiều lựa chọn. */
const DROPDOWN = `<style id="dropdown-skin">
select:not([hidden]){font-size:14.5px !important;min-height:36px;padding-top:7px;padding-bottom:7px}
:is(#wrapGeneral,#wrapCompare,#wrapVer,#wrapFpl,#wrapTool,#wrapNotam,#wrapAtcCheck,#wrapLimits,#wrapHandover,#wrapNoticeRules,#wrapNmTrack) select:not([hidden]){font-size:14.5px !important}
.f-disp{flex:0 1 250px;min-width:170px;max-width:280px}
.f-disp select{font-size:15px !important}
.filt-rail .field select{font-size:14px !important}
/* Ô chọn ở đầu trang (DISPATCHER, Khung giờ) vốn bị ép 9.5px cho gọn —
   nay để 15px vì danh sách bật ra đã vẽ lại, không lo choáng chỗ. */
header#mdRoom select{font-size:15px !important;padding:0 8px !important;height:34px !important;letter-spacing:0 !important}
.tool-row select{font-size:14px !important;min-width:170px}
#ddPop{position:fixed;z-index:9999;box-sizing:border-box;max-width:min(520px,calc(100vw - 16px));
  background:var(--x-card,#fff);border:1px solid var(--x-line,#d7dbe4);border-radius:14px;
  box-shadow:0 18px 44px rgba(16,18,24,.22),0 2px 6px rgba(16,18,24,.10);
  padding:6px;color:var(--x-ink,#16181d);font-family:var(--x-sans,"IBM Plex Sans"),system-ui,sans-serif;
  overflow:hidden}
#ddPop[hidden]{display:none}
#ddPop .dd-hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
  padding:4px 8px 6px;border-bottom:1px solid var(--x-line2,#eef0f3);margin-bottom:4px}
#ddPop .dd-tt{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
  color:var(--x-mute,#7a808c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ddPop .dd-ct{font-size:12px;font-weight:700;color:var(--x-red,#e31937);white-space:nowrap}
#ddPop .dd-q{display:block;box-sizing:border-box;width:100%;margin:0 0 4px;padding:9px 11px;
  font-size:15px;font-family:inherit;color:var(--x-ink,#16181d);background:var(--x-bg,#f4f5f7);
  border:1px solid var(--x-line,#e4e6ea);border-radius:10px;outline:none}
#ddPop .dd-q:focus{border-color:var(--x-red,#e31937);background:var(--x-card,#fff);
  box-shadow:0 0 0 3px rgba(227,25,55,.12)}
#ddPop .dd-q[hidden]{display:none}
#ddPop .dd-list{max-height:min(58vh,440px);overflow:auto;padding:2px}
#ddPop .dd-grp{padding:9px 10px 5px;font-size:11.5px;font-weight:800;letter-spacing:.09em;
  text-transform:uppercase;color:var(--x-mute,#7a808c)}
#ddPop .dd-row{display:flex;align-items:center;gap:9px;box-sizing:border-box;min-height:40px;
  padding:8px 10px;border-radius:10px;font-size:15px;line-height:1.35;cursor:pointer;
  color:var(--x-ink,#16181d)}
#ddPop .dd-row .dd-tx{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
#ddPop .dd-row .dd-ck{flex:0 0 20px;width:20px;text-align:center;font-size:15px;font-weight:900;
  color:var(--x-red,#e31937)}
#ddPop .dd-row.on{background:var(--x-red-50,#fff1f3);font-weight:800}
#ddPop .dd-row.on .dd-ck::before{content:"\\2713"}
#ddPop .dd-row.hi{background:var(--x-red,#e31937);color:#fff;font-weight:800}
#ddPop .dd-row.hi .dd-ck{color:#fff}
#ddPop .dd-row:hover{background:var(--x-red-100,#ffe1e6)}
#ddPop .dd-row.hi:hover{background:var(--x-red,#e31937)}
#ddPop .dd-none{padding:14px 10px;font-size:14px;color:var(--x-mute,#7a808c);text-align:center}
html.night #ddPop{background:#1c1c20;border-color:#5a3a48;color:#eee}
html.night #ddPop .dd-q{background:#2a1c22;color:#eee;border-color:#5a3a48}
html.night #ddPop .dd-row{color:#eee}
html.night #ddPop .dd-row.on{background:#3a2a30}
html.night #ddPop .dd-row:hover{background:#422f38}
html.night #ddPop .dd-row.hi{background:var(--x-red,#e31937);color:#fff}
/* Danh sách chuyến nâng cao (Check NOTAM): cùng cỡ chữ với dropdown mới */
#wrapNotam .nm-flt-menu button{font-size:14.5px !important;padding:9px 11px !important;min-height:38px !important}
#wrapNotam .toolbar2 #nmFltQ{font-size:14.5px !important;padding:9px 11px !important}
#wrapNotam .toolbar2 #nmFltBtn{font-size:14px !important;padding:8px 22px 8px 10px !important}
#wrapNotam .nm-flt-menu{border-radius:12px !important;box-shadow:0 18px 44px rgba(16,18,24,.22) !important}
</style>`;

const ddScript = `
(function(){
  var pop=null,qEl=null,listEl=null,ttEl=null,ctEl=null,cur=null,rows=[],items=[],act=-1;
  function ok(sel){
    if(!sel||sel.tagName!=='SELECT')return false;
    if(sel.multiple||sel.size>1||sel.disabled||sel.hidden)return false;
    var cs=getComputedStyle(sel);
    if(cs.display==='none'||cs.visibility==='hidden')return false;
    var r=sel.getBoundingClientRect();
    if(r.width<3||r.height<3)return false;
    return sel.options.length>0;
  }
  function build(){
    pop=document.createElement('div');pop.id='ddPop';pop.hidden=true;
    pop.innerHTML='<div class="dd-hd"><span class="dd-tt"></span><span class="dd-ct"></span></div>'
      +'<input class="dd-q" type="text" autocomplete="off" spellcheck="false" placeholder="G\\u1EE9 \\u0111\\u1EC3 t\\u00ECm\\u2026">'
      +'<div class="dd-list"></div>';
    document.body.appendChild(pop);
    qEl=pop.querySelector('.dd-q');listEl=pop.querySelector('.dd-list');
    ttEl=pop.querySelector('.dd-tt');ctEl=pop.querySelector('.dd-ct');
    qEl.addEventListener('input',function(){paint(qEl.value);});
  }
  function flat(sel){
    var out=[];
    (function walk(node){
      var k=node.children||[];
      for(var i=0;i<k.length;i++){
        var n=k[i];
        if(n.tagName==='OPTGROUP'){ if(!n.disabled){ out.push({grp:1,label:n.label}); walk(n); } }
        else if(n.tagName==='OPTION'){ if(!n.disabled) out.push({opt:1,el:n,val:n.value,text:(n.textContent||'').replace(/\\s+/g,' ').trim()}); }
      }
    })(sel);
    return out;
  }
  function low(s){ return String(s||'').toLowerCase().replace(/\\s+/g,''); }
  function paint(filt){
    var f=low(filt);
    listEl.innerHTML='';items=[];act=-1;
    var keep=[],i,j,m;
    for(i=0;i<rows.length;i++){
      var r=rows[i];
      keep.push(r.opt ? (!f||low(r.text).indexOf(f)>=0) : false);
    }
    for(j=rows.length-1;j>=0;j--){
      if(rows[j].grp){
        var g=false;
        for(m=j+1;m<rows.length&&rows[m].grp===undefined;m++){ if(keep[m]){ g=true; break; } }
        keep[j]=g;
      }
    }
    var nOpt=0;
    for(i=0;i<rows.length;i++){
      if(!keep[i])continue;
      var rw=rows[i];
      if(rw.grp){
        var h=document.createElement('div');h.className='dd-grp';h.textContent=rw.label;
        listEl.appendChild(h);continue;
      }
      nOpt++;
      var d=document.createElement('div');
      var on=rw.el.selected;
      d.className='dd-row'+(on?' on':'');d.setAttribute('role','option');
      if(cur.id==='fDispatcher' && rw.val){
        var plus=document.createElement('button');plus.type='button';plus.className='btn dd-handover';
        var received=cmpHandoverHas(rw.val);
        plus.textContent=received?'−':'+';plus.setAttribute('aria-pressed',String(received));
        plus.setAttribute('aria-label',(received?'Bỏ giao ca ':'Nhận giao ca ')+rw.val);
        plus.title=(received?'Bỏ giao ca ':'Nhận giao ca ')+rw.val;
        plus.disabled=dspKey(rw.val)===dspKey(cur.value);
        (function(name,button){button.addEventListener('click',function(ev){
          ev.stopPropagation();cmpHandoverToggle(name);paint(qEl.value);
        });})(rw.val,plus);
        d.appendChild(plus);
      }
      var ck=document.createElement('span');ck.className='dd-ck';d.appendChild(ck);
      var tx=document.createElement('span');tx.className='dd-tx';tx.textContent=rw.text||'—';d.appendChild(tx);
      if(!on){
        try{
          var cs=getComputedStyle(rw.el),bg=cs.backgroundColor;
          if(bg&&bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')d.style.backgroundColor=bg;
          if(cs.color)d.style.color=cs.color;
          if(cs.fontWeight&&cs.fontWeight!=='400'&&cs.fontWeight!=='normal')d.style.fontWeight=cs.fontWeight;
        }catch(e){}
      }
      (function(row,el){ el.addEventListener('click',function(){pick(row);}); })(rw,d);
      d.__i=i;
      listEl.appendChild(d);items.push(d);
    }
    if(!nOpt){
      var em=document.createElement('div');em.className='dd-none';em.textContent='Không tìm thấy lựa chọn nào';
      listEl.appendChild(em);
    }
    var s=-1;
    for(i=0;i<items.length;i++){ if(items[i].classList.contains('on')){ s=i; break; } }
    jump(s);
  }
  function jump(i){
    if(i<0)i=0;
    if(i>items.length-1)i=items.length-1;
    if(!items.length)i=-1;
    act=i;
    for(var k=0;k<items.length;k++)items[k].classList.toggle('hi',k===act);
    if(act>=0&&items[act].scrollIntoView)items[act].scrollIntoView({block:'nearest'});
  }
  function move(d){
    if(!items.length)return;
    var n=act<0?(d>0?0:items.length-1):act+d;
    if(n<0)n=0;
    if(n>items.length-1)n=items.length-1;
    jump(n);
  }
  function clean(l){
    try{
      var c=l.cloneNode(true);
      var x=c.querySelectorAll('i.jp,.ops-field-icon');
      for(var i=0;i<x.length;i++)x[i].parentNode.removeChild(x[i]);
      return (c.textContent||'').replace(/\\s+/g,' ').trim();
    }catch(e){ return (l.textContent||'').trim(); }
  }
  function labelOf(sel){
    try{
      if(sel.labels&&sel.labels.length)return clean(sel.labels[0]);
      var p=sel.previousElementSibling;
      if(p&&p.tagName==='LABEL')return clean(p);
      var w=sel.closest('.field');
      if(w){ var l=w.querySelector('label'); if(l)return clean(l); }
    }catch(e){}
    var t=sel.getAttribute('title')||'';
    return t.length>46?t.slice(0,46)+'\\u2026':t;
  }
  function open(sel){
    if(!pop)build();
    // Ô chọn nằm trong hộp thoại modal (top layer) thì danh sách phải nằm cùng
    // hộp thoại — để ở body sẽ bị che và không bấm được.
    var host=(sel.closest&&sel.closest('dialog[open]'))||document.body;
    if(pop.parentNode!==host)host.appendChild(pop);
    cur=sel;rows=flat(sel);
    ttEl.textContent=labelOf(sel);
    var n=0;for(var i=0;i<rows.length;i++)if(rows[i].opt)n++;
    ctEl.textContent=n+' lựa chọn';
    qEl.hidden=n<9;
    qEl.value='';
    paint('');
    pop.hidden=false;
    place();
    if(!qEl.hidden)qEl.focus();
  }
  function place(){
    if(!cur||!pop||pop.hidden)return;
    // Trang có thể đang bị thu nhỏ vừa màn (html[zoom]); đặt zoom ngược cho
    // khung danh sách để chữ hiện đúng cỡ, rồi mới tính chỗ đặt.
    var z=1;
    try{
      var ph=pop.parentNode,zf=function(el){ return parseFloat(getComputedStyle(el).zoom)||1; };
      z=zf(document.documentElement);
      if(ph&&ph!==document.body){
        z=(typeof ph.currentCSSZoom==='number'&&ph.currentCSSZoom>0)?ph.currentCSSZoom:z*zf(document.body)*zf(ph);
      }
    }catch(e){}
    pop.style.zoom=(z>0.05&&Math.abs(z-1)>0.001)?String(1/z):'';
    var r=cur.getBoundingClientRect(),vw=window.innerWidth,vh=window.innerHeight,m=8;
    if(r.bottom<m||r.top>vh-m){ close(); return; }
    var w=Math.max(r.width,260);
    w=Math.min(w,Math.max(220,vw-m*2));
    pop.style.width=w+'px';
    var x=Math.min(Math.max(m,r.left),Math.max(m,vw-w-m));
    pop.style.left=x+'px';
    var h=pop.offsetHeight;
    var y=r.bottom+6;
    if(y+h>vh-m&&r.top-(h+6)>m)y=r.top-h-6;
    pop.style.top=Math.max(m,y)+'px';
  }
  function close(){
    if(pop)pop.hidden=true;
    cur=null;rows=[];items=[];act=-1;
  }
  function pick(row){
    if(!cur||!row)return;
    var sel=cur,prev=sel.value;
    close();
    sel.value=row.val;
    try{ sel.focus({preventScroll:true}); }catch(e){}
    if(prev!==sel.value){
      try{
        sel.dispatchEvent(new Event('input',{bubbles:true}));
        sel.dispatchEvent(new Event('change',{bubbles:true}));
      }catch(e){}
    }
  }
  function onKey(e){
    if(!pop||pop.hidden)return;
    var k=e.key;
    if(k==='Escape'){ e.preventDefault(); var s=cur; close(); try{ if(s)s.focus(); }catch(x){} return; }
    if(k==='ArrowDown'){ e.preventDefault(); move(1); return; }
    if(k==='ArrowUp'){ e.preventDefault(); move(-1); return; }
    if(k==='Home'){ e.preventDefault(); jump(0); return; }
    if(k==='End'){ e.preventDefault(); jump(items.length-1); return; }
    if(k==='Enter'){
      e.preventDefault();
      if(items[act])pick(rows[items[act].__i]);
      else if(items.length)pick(rows[items[0].__i]);
      return;
    }
    if(k==='Tab'){ close(); }
  }
  document.addEventListener('mousedown',function(e){
    var t=e.target;
    if(pop&&!pop.hidden){
      if(pop.contains(t))return;
      var was=cur; close();
      // Bấm lại vào ô đang mở: chỉ đóng, không để trình duyệt bật danh sách cũ.
      if(t&&t.tagName==='SELECT'){
        e.preventDefault();
        if(t!==was&&ok(t)){ try{ t.focus({preventScroll:true}); }catch(x){} open(t); }
      }
      return;
    }
    if(t&&t.tagName==='SELECT'&&ok(t)){
      e.preventDefault();
      try{ t.focus({preventScroll:true}); }catch(x){}
      open(t);
    }
  },true);
  document.addEventListener('keydown',function(e){
    if(pop&&!pop.hidden){ onKey(e); return; }
    var t=e.target;
    if(t&&t.tagName==='SELECT'&&(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Enter'||e.key===' '||e.key==='F4')){
      if(!ok(t))return;
      e.preventDefault();
      open(t);
    }
  },true);
  window.addEventListener('scroll',function(){ if(pop&&!pop.hidden)place(); },true);
  window.addEventListener('resize',function(){ if(pop&&!pop.hidden)close(); });
  document.addEventListener('click',function(e){
    if(!pop||pop.hidden)return;
    var t=e.target;
    if(t&&t.tagName==='SELECT'&&pop.contains(t))close();
  },true);
})();
`;

let cached: string | null = null;

const ATC_SKIN = `<style id="atc-result-skin">
/* The original review was z-index 50, below the 9999 hover/dropdown panels. */
#ftAtcModal{z-index:10080!important;isolation:isolate;box-sizing:border-box;pointer-events:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
#ftAtcModal:not(.open){display:none!important;visibility:hidden!important}
#ftAtcModal.open{display:flex!important;visibility:visible!important;pointer-events:auto!important}
#ftAtcModal>.sheet{position:relative;pointer-events:auto!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
#ftAtcModal .crew-foot{position:relative;z-index:1;display:flex;flex-wrap:wrap;align-items:center;gap:8px;pointer-events:auto!important}
#ftAtcModal .crew-foot button,#ftAtcClose{pointer-events:auto!important;touch-action:manipulation}
#ftAtcModal::before,#ftAtcModal::after,#ftAtcModal .sheet::before,#ftAtcModal .sheet::after{pointer-events:none!important}
html.atc-review-open .cmp-tip{visibility:hidden!important;pointer-events:none!important}
.cmp-tip:not(.on){display:none!important;visibility:hidden!important;pointer-events:none!important}
.cmp-tip.on{visibility:visible}
.taf-tip:not(.show){display:none!important;visibility:hidden!important;pointer-events:none!important}
html.atc-review-open .taf-tip{display:none!important;pointer-events:none!important}
html.night{--atc-paper:var(--atc-night-paper);--atc-stripe:var(--atc-night-stripe);--atc-hover:var(--atc-night-hover);--atc-ink:var(--atc-night-ink);--atc-line:var(--atc-night-line);--atc-missing:var(--atc-night-missing)}
#wrapAtcCheck #acTbl{border-collapse:separate;border-spacing:0;color:var(--atc-ink) !important}
#wrapAtcCheck #acTbl thead th{background:var(--atc-header) !important;color:var(--atc-on-color) !important;-webkit-text-fill-color:var(--atc-on-color) !important;border-color:var(--atc-header) !important;font-weight:800}
#wrapAtcCheck #acTbl tbody tr>td{background:var(--atc-paper) !important;color:var(--atc-ink) !important;-webkit-text-fill-color:var(--atc-ink) !important;border-bottom:1px solid var(--atc-line) !important;padding-top:7px;padding-bottom:7px;letter-spacing:0 !important}
#wrapAtcCheck #acTbl tbody tr:nth-child(even)>td{background:var(--atc-stripe) !important}
#wrapAtcCheck #acTbl tbody tr:hover>td{background:var(--atc-hover) !important}
#wrapAtcCheck #acTbl tbody tr>td:is(.ac-filed,.ac-true){background:var(--atc-success) !important;color:var(--atc-on-color) !important;-webkit-text-fill-color:var(--atc-on-color) !important;font-weight:800;text-shadow:none !important}
#wrapAtcCheck #acTbl tbody tr>td:is(.ac-false,.ac-cancelled){background:var(--atc-danger) !important;color:var(--atc-on-color) !important;-webkit-text-fill-color:var(--atc-on-color) !important;font-weight:800;text-shadow:none !important}
#wrapAtcCheck #acTbl tbody tr>td:is(.ac-departed,.ac-closed-op,.ac-na){background:var(--atc-warning) !important;color:var(--atc-warning-ink) !important;-webkit-text-fill-color:var(--atc-warning-ink) !important;font-weight:800;text-shadow:none !important}
#wrapAtcCheck #acTbl tbody tr>td.ac-closed{background:var(--atc-neutral) !important;color:var(--atc-on-color) !important;-webkit-text-fill-color:var(--atc-on-color) !important;font-weight:800}
#wrapAtcCheck #acTbl tbody tr>td:is(.ac-status,.ac-regchk,.ac-stdchk){text-align:center}
#wrapAtcCheck #acTbl tbody tr>td:is(.ac-reg,.ac-time,.ac-dof){font-weight:600}
#wrapAtcCheck #acTbl input[data-col="0"]{background:var(--atc-paper) !important;color:var(--atc-ink) !important;-webkit-text-fill-color:var(--atc-ink) !important;border-color:var(--atc-line) !important;letter-spacing:0 !important;font-weight:700}
#wrapAtcCheck #acTbl tbody tr.ac-has-flight>td:is(.ac-status,.ac-reg,.ac-regchk,.ac-time,.ac-stdchk,.ac-dof):empty::before{content:"- - - -";color:var(--atc-missing);-webkit-text-fill-color:var(--atc-missing);font-weight:600;white-space:nowrap}
</style>`;

// ==== MẪU THỬ (nháp): nút trong tab "Công cụ hỗ trợ" = nền đỏ, chữ trắng ====
// :not(#_) là mẹo tăng độ ưu tiên: nó luôn đúng với mọi phần tử nhưng
// được tính như một id, nên thắng được các quy định cũ có id/!important.
// Mọi quy định đều đóng trong #wrapTool nên tab khác và header giữ nguyên.
const BTNRED = `<style id="btn-red-skin">
#wrapTool{--x-red-solid:#E31937;--x-red-solid-d:#B01028}
/* 1. Mọi nút trong tab: đỏ đặc, chữ trắng */
#wrapTool .btn:not(#_):not(#_){
  background:var(--x-red-solid) !important;background-image:none !important;
  color:#fff !important;-webkit-text-fill-color:#fff !important;
  border-color:var(--x-red-solid) !important;
  box-shadow:0 1px 3px rgba(227,25,55,.26) !important;
}
/* 2. Chữ và biểu tượng bên trong nút cũng phải trắng */
#wrapTool .btn:not(#_):not(#_):not(#_) *,
#wrapTool .btn:not(#_):not(#_):not(#_) ::before,
#wrapTool .btn:not(#_):not(#_)::before{
  color:#fff !important;-webkit-text-fill-color:#fff !important;
}
#wrapTool .btn:not(#_):not(#_) svg,
#wrapTool .btn:not(#_):not(#_) svg *{stroke:currentColor !important}
/* 3. Rê chuột: đỏ đậm hơn */
#wrapTool .btn:not(#_):not(#_):hover:not(:disabled){
  background:var(--x-red-solid-d) !important;border-color:var(--x-red-solid-d) !important;
}
/* 4. Nút đang bật / đang chọn: cùng màu đỏ, thêm viền trắng trong để phân biệt */
#wrapTool .btn:is(.primary,.t-go,.act,.t-ok,.t-soft,.t-warn,.t-undo)[aria-pressed="true"]:not(#_):not(#_),
#wrapTool .btn[aria-pressed="true"]:not(#_):not(#_),
#wrapTool .btn.on:not(#_):not(#_){
  background:var(--x-red-solid) !important;border-color:var(--x-red-solid) !important;
  box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.6),0 1px 3px rgba(227,25,55,.26) !important;
}
/* 5. Nút đang tắt: vẫn đỏ chữ trắng, chỉ mờ đi cho dễ nhận */
#wrapTool .btn:not(#_):not(#_):disabled,
#wrapTool .btn:not(#_):not(#_)[disabled]{
  background:var(--x-red-solid) !important;border-color:var(--x-red-solid) !important;
  color:#fff !important;-webkit-text-fill-color:#fff !important;
  opacity:.45 !important;box-shadow:none !important;
}
</style>`;

// ==== Nút hành động chính trong tab FPL: nền đỏ chữ trắng (yêu cầu của người dùng) ====
// Extra autofill, Auto Rounding PLD, Get ATC convert, Checklist 2, FORM MNL,
// OFP check data, Tạo điện văn — cùng màu với các nút trong tab Công cụ hỗ trợ.
const BTNRED2 = `<style id="btn-red-skin-2">
#ftExtraFill:not(#_):not(#_),#ftPldRound:not(#_):not(#_),#ftAtcConvBtn:not(#_):not(#_),
#ftCkSaveBtn:not(#_):not(#_),#ftMnlBtn:not(#_):not(#_),#ftOfpRulesBtn:not(#_):not(#_),
#ftMsgBtn:not(#_):not(#_){
  --x-red-solid:#E31937;--x-red-solid-d:#B01028;
  background:var(--x-red-solid) !important;background-image:none !important;
  color:#fff !important;-webkit-text-fill-color:#fff !important;
  border-color:var(--x-red-solid) !important;
  box-shadow:0 1px 3px rgba(227,25,55,.26) !important;
}
#ftExtraFill:not(#_):not(#_):not(#_) *,#ftPldRound:not(#_):not(#_):not(#_) *,
#ftAtcConvBtn:not(#_):not(#_):not(#_) *,#ftCkSaveBtn:not(#_):not(#_):not(#_) *,
#ftMnlBtn:not(#_):not(#_):not(#_) *,#ftOfpRulesBtn:not(#_):not(#_):not(#_) *,
#ftMsgBtn:not(#_):not(#_):not(#_) *,
#ftExtraFill::before,#ftPldRound::before,#ftAtcConvBtn::before,#ftCkSaveBtn::before,
#ftMnlBtn::before,#ftOfpRulesBtn::before,#ftMsgBtn::before{
  color:#fff !important;-webkit-text-fill-color:#fff !important;
}
#ftExtraFill:not(#_):not(#_):hover:not(:disabled),#ftPldRound:not(#_):not(#_):hover:not(:disabled),
#ftAtcConvBtn:not(#_):not(#_):hover:not(:disabled),#ftCkSaveBtn:not(#_):not(#_):hover:not(:disabled),
#ftMnlBtn:not(#_):not(#_):hover:not(:disabled),#ftOfpRulesBtn:not(#_):not(#_):hover:not(:disabled),
#ftMsgBtn:not(#_):not(#_):hover:not(:disabled){
  background:var(--x-red-solid-d) !important;border-color:var(--x-red-solid-d) !important;
}
/* Auto Rounding PLD đang bật: cùng đỏ, viền trắng trong để phân biệt */
#ftPldRound[aria-pressed="true"]:not(#_):not(#_){
  background:var(--x-red-solid) !important;border-color:var(--x-red-solid) !important;
  box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.6),0 1px 3px rgba(227,25,55,.26) !important;
}
/* Đang bận / tắt: vẫn đỏ chữ trắng, chỉ mờ đi */
#ftExtraFill:not(#_):not(#_):disabled,#ftPldRound:not(#_):not(#_):disabled,
#ftAtcConvBtn:not(#_):not(#_):disabled,#ftCkSaveBtn:not(#_):not(#_):disabled,
#ftMnlBtn:not(#_):not(#_):disabled,#ftOfpRulesBtn:not(#_):not(#_):disabled,
#ftMsgBtn:not(#_):not(#_):disabled{
  background:var(--x-red-solid) !important;border-color:var(--x-red-solid) !important;
  color:#fff !important;-webkit-text-fill-color:#fff !important;
  opacity:.45 !important;box-shadow:none !important;
}
</style>`;

// ==== Skin điện thoại: CHỈ áp dụng khi màn hình < 820px ====
// Bản máy tính giữ nguyên 100%. Trên điện thoại: nút/ô nhập to hơn cho
// dễ bấm, khung dropdown bám theo màn hình, bảng cuộn ngang mượt.
const MOBILE = `<style id="mobile-skin">
@media (max-width:820px){
  html{-webkit-text-size-adjust:100%}
  body{overscroll-behavior-x:contain}
  /* Nút bấm & ô nhập đủ to cho ngón tay (sau khi zoom-fit 0.5, kích thước
     thực = giá trị CSS × 0.5, nên nhân đôi để chạm ~40px thật) */
  button,input[type="button"],input[type="submit"],select{
    min-height:34px;font-size:15px !important;
  }
  input[type="text"],input[type="number"],input[type="password"],textarea{
    font-size:15px !important;
  }
  /* Khung chọn (dropdown tùy biến) bám sát mép màn hình, chữ to */
  #ddPop{max-width:calc(100vw - 12px) !important;font-size:16px !important}
  /* Bảng KHB: cuộn ngang mượt, giữ thanh cuộn hiển thị */
  table{-webkit-overflow-scrolling:touch}
  /* Hộp thoại/modal không tràn màn hình */
  .modal,.dialog,[class*="popup"]{max-width:calc(100vw - 16px) !important}
}
</style>`;




const CMP_HEADER_SKIN = `<style id="cmp-header-skin">
#wrapCompare > #estBar{position:sticky;top:0;z-index:20;flex-shrink:0;display:flex;flex-wrap:nowrap;align-items:center;gap:8px!important;
  padding:8px 14px!important;background:#f8fafc!important;border-bottom:1px solid #e2e8f0!important;
  box-shadow:0 6px 14px -12px rgba(15,23,42,.35);overflow-x:auto;scrollbar-width:thin}
#estBar > *{flex-shrink:0}
#estBar > label.chk{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 12px!important;border:1px solid #e2e8f0;
  border-radius:10px;background:#fff;font-size:12px;font-weight:700;color:#334155;white-space:nowrap}
#estBar > label.chk input{accent-color:#E31937;width:15px;height:15px;margin:0}
#estBar > .btn{height:32px;padding:0 12px!important;border-radius:9px!important;font-size:12px!important;font-weight:700!important;
  white-space:nowrap;min-width:76px;justify-content:center}
#estBar > #estRefresh{min-width:84px}
#estBar #estStat[hidden]{display:inline-flex!important}
#estBar #estStat{display:inline-flex!important;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:10px;
  background:#fff;border:1px solid #e2e8f0;font:600 12px/1 'JetBrains Mono',monospace!important;color:#0f172a!important;
  white-space:nowrap;min-width:150px;max-width:300px;overflow:hidden;text-overflow:ellipsis}
#estBar #estStat::before{content:"EST";font:800 10px/1 system-ui,sans-serif;letter-spacing:.08em;color:#fff;background:#E31937;
  padding:4px 6px;border-radius:5px}
#estBar #estStat:empty::after{content:"chưa cập nhật";color:#94a3b8;font-weight:500}
#estBar #cmpFileBar{margin-left:auto}
#estBar .crew-using,#estBar #cmpVerBar{white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis}
</style>`;

const PLD_HOVER = `<style id="pld-hover-skin">
.pld-tip{position:fixed;z-index:10050;width:320px;border-radius:14px;background:#ffffff;color:#0f172a;border:1px solid #e2e8f0;box-shadow:0 18px 48px -12px rgba(15,23,42,.35);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;opacity:0;transform:translateY(-4px);transition:opacity .12s,transform .12s;pointer-events:none;overflow:hidden}
.pld-tip.on{opacity:1;transform:none}
.pld-tip .ph{padding:10px 14px;background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.pld-tip .ph b{font-size:14px;letter-spacing:.02em}.pld-tip .ph span{font-size:11px;opacity:.8}
.pld-tip .pb{padding:10px 14px;display:grid;gap:8px}
.pld-tip .card{border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;background:#f8fafc}
.pld-tip .card.est{border-left:4px solid #7c3aed}.pld-tip .card.ofp{border-left:4px solid #0284c7}
.pld-tip .k{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b}
.pld-tip .k i{font-style:normal;font-weight:600;text-transform:none;letter-spacing:0;color:#475569}
.pld-tip .big{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:2px}
.pld-tip .sub{font-size:11.5px;color:#475569;font-variant-numeric:tabular-nums}
.pld-tip .dl{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:10px;font-weight:800}
.pld-tip .dl.ok{background:#dcfce7;color:#15803d}.pld-tip .dl.bad{background:#fee2e2;color:#b91c1c}.pld-tip .dl.n{background:#f1f5f9;color:#334155}
.pld-tip .dl em{font-style:normal;font-size:18px;font-variant-numeric:tabular-nums}
.pld-tip .muted{color:#94a3b8;font-weight:600}
</style>
<script>
(function(){
  var tip=null,cur=null;
  function n(v){return v==null||v===""||isNaN(Number(v))?"—":Number(v).toLocaleString("en-US");}
  function t(iso){if(!iso)return "";var d=new Date(iso);if(isNaN(d))return "";
    var p=function(x){return String(x).padStart(2,"0");};
    return p(d.getUTCDate())+"/"+p(d.getUTCMonth()+1)+" "+p(d.getUTCHours())+":"+p(d.getUTCMinutes())+"Z";}
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
  function build(sid){
    var w=(typeof W_CACHE!=="undefined"&&W_CACHE[sid])||null;
    var p=(typeof E_CACHE!=="undefined"&&E_CACHE[sid])||{};
    var f=(typeof flights!=="undefined"&&flights.find(function(x){return String(x.id)===String(sid);}))||{};
    var on=document.querySelector("#cmpPld")&&document.querySelector("#cmpPld").checked;
    var h='<div class="ph"><b>'+esc(f.callsign||"")+" "+esc(f.route||"")+'</b><span>STD '+esc(t(f.std))+'</span></div><div class="pb">';
    h+='<div class="card est"><div class="k">EST payload · Omni<i>'+(p.est_time?"cập nhật "+esc(t(p.est_time)):"")+'</i></div>';
    if(!on) h+='<div class="sub muted">Chưa bật "so PLD / EST"</div>';
    else if(p.est==null) h+='<div class="sub muted">'+esc(p.err||"Đang lấy EST…")+'</div>';
    else h+='<div class="big">'+n(p.est)+' kg</div><div class="sub">Khách '+n(p.pax)+' · Hành lý '+n(p.bag)+' · Cargo '+n(p.cargo)+(p.tare!=null?' · Tare '+n(p.tare):'')+'</div>'
      +'<div class="sub">'+esc(p.omni||"")+(p.omni_std?' (LT)':'')+'</div>';
    h+='</div><div class="card ofp"><div class="k">Payload OFP · FliteBrief<i>'+(f.plan_released_on?"REL "+esc(t(f.plan_released_on)):"")+'</i></div>';
    if(!w) h+='<div class="sub muted">Chưa có OFP</div>';
    else h+='<div class="big">'+n(w.pld)+' kg</div><div class="sub">'+(f.plan_no?"CFP "+esc(f.plan_no)+" · ":"")+'DOW '+n(w.dow)+'</div><div class="sub">ZFW '+n(w.zfw)+' / MZFW '+n(w.mzfw)+'</div>';
    h+='</div>';
    if(on&&w&&w.pld!=null&&p.est!=null){
      var v=Number(w.pld)-Number(p.est);
      h+='<div class="dl '+(v>0?"ok":v<0?"bad":"n")+'"><span>'+(v<0?"EST vượt PLD":"PLD − EST")+(Math.abs(v)>2000?" ⚠ > 2000":"")+'</span><em>'+(v>0?"+":"")+v.toLocaleString("en-US")+'</em></div>';
    }
    return h+'</div>';
  }
  function place(td){var r=td.getBoundingClientRect(),W=tip.offsetWidth,H=tip.offsetHeight;
    var x=r.right+8;if(x+W>innerWidth-8)x=Math.max(8,r.left-W-8);
    var y=Math.min(Math.max(8,r.top-10),innerHeight-H-8);tip.style.left=x+"px";tip.style.top=y+"px";}
  document.addEventListener("mouseover",function(e){
    var td=e.target&&e.target.closest&&e.target.closest('#cmpBody td[data-w="pld"]');
    if(td===cur)return;cur=td;
    if(!td){if(tip)tip.classList.remove("on");return;}
    if(td.title){td.dataset.tipT=td.title;td.removeAttribute("title");}
    if(!tip){tip=document.createElement("div");tip.className="pld-tip";document.body.appendChild(tip);}
    tip.innerHTML=build(td.dataset.sid);place(td);tip.classList.add("on");
  },true);
})();
</script>`;
const TOOL_HEADER_SKIN = `<style id="tool-header-skin">
#wrapTool #tlAddBrief,#wrapTool #mergePdfPick{display:none!important}
#wrapTool .tool-row{display:flex!important;align-items:center;gap:10px;flex-wrap:nowrap;padding:8px 12px!important;margin:0 0 8px!important;
  background:#fff!important;border:1px solid #e2e8f0!important;border-radius:12px!important;
  box-shadow:0 1px 2px rgba(15,23,42,.05)!important;overflow-x:auto;scrollbar-width:thin}
#wrapTool .tool-row > .tlbl{flex:0 0 104px;display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 10px!important;
  border-radius:8px!important;background:#0f172a!important;color:#fff!important;font:800 11px/1 system-ui,sans-serif!important;
  letter-spacing:.1em;text-transform:uppercase;border:0!important}
#wrapTool .tool-row > .tlbl::before{content:"";width:6px;height:6px;border-radius:50%;background:#E31937;box-shadow:0 0 0 3px rgba(227,25,55,.25)}
#wrapTool .tool-row .tg{display:flex!important;align-items:center;gap:6px;flex-wrap:nowrap;flex-shrink:0}
#wrapTool .tool-row .tg + .tg{padding-left:10px;border-left:1px solid #e2e8f0}
#wrapTool .tool-row .btn{height:30px;padding:0 12px!important;border-radius:8px!important;white-space:nowrap;flex-shrink:0;
  font-size:12px!important;font-weight:700!important;line-height:30px!important}
#wrapTool .tool-row select{height:30px;border-radius:8px;border:1px solid #e2e8f0;padding:0 8px;background:#f8fafc;font-size:12px}
#wrapTool .tool-row input[type=text],#wrapTool .tool-row input[type=number]{height:26px;border-radius:7px;border:1px solid #e2e8f0;background:#f8fafc}
#wrapTool .tool-row label.chk{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:12px;font-weight:600;color:#334155}
#wrapTool .tool-row label.chk input{accent-color:#E31937}
#wrapTool #tlExportBrief{min-width:150px}
</style>`;

const KHB_HEADER_SKIN = `<style id="khb-header-skin">
#wrapFplText #ftAtcBtn{display:none!important}
#wrapFplText #ftCountLine{display:flex;align-items:center;gap:8px;margin:0!important;padding:8px 14px 0;
  background:#f8fafc;font:700 12px/1 'JetBrains Mono',monospace!important;color:#0f172a!important;letter-spacing:.04em;text-transform:uppercase}
#wrapFplText #ftCountLine::before{content:"";width:8px;height:8px;border-radius:50%;background:#E31937;box-shadow:0 0 0 3px rgba(227,25,55,.15)}
#wrapFplText > .toolbar2{position:sticky;top:0;z-index:20;flex-shrink:0;display:flex;flex-wrap:wrap;align-items:center;
  gap:8px 8px!important;padding:8px 14px 10px!important;background:#f8fafc!important;
  border-bottom:1px solid #e2e8f0!important;box-shadow:0 6px 14px -12px rgba(15,23,42,.35)}
#wrapFplText > .toolbar2::after{content:"";flex-basis:100%;height:0;order:5}
#wrapFplText > .toolbar2 > .ft-tool-group{order:1;flex-wrap:nowrap!important;flex-shrink:0;gap:3px!important;padding:3px!important;
  border-radius:10px!important;border:1px solid #e2e8f0!important;background:#fff!important}
#wrapFplText > .toolbar2 .ft-tool-group .btn{height:30px;padding:0 11px!important;border-radius:7px!important;white-space:nowrap;
  font-size:12px!important;font-weight:700!important;line-height:30px;flex-shrink:0}
#wrapFplText #ftPldRound{min-width:150px;text-align:center}
#wrapFplText #ftStat{order:2;flex:0 0 150px;width:150px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#64748b}
#wrapFplText > .toolbar2 > .spacer{order:3;flex:1 1 0;min-width:0}
#wrapFplText #ftCrewUse{order:4;flex-shrink:0;max-width:340px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
#wrapFplText #ftCrewUse:empty{display:none}
#wrapFplText > .toolbar2 > label.ftdsp,#wrapFplText > .toolbar2 > .ftdsp{order:6;display:inline-flex;align-items:center;gap:8px;height:34px;
  padding:0 6px 0 12px!important;border-radius:10px!important;border:1px solid #e2e8f0!important;background:#fff!important;
  font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#475569;white-space:nowrap;flex-shrink:0}
#wrapFplText > .toolbar2 .ftdsp input{height:24px;border:0!important;border-left:1px solid #e2e8f0!important;border-radius:0!important;
  padding:0 8px!important;background:transparent!important;font:600 13px 'JetBrains Mono',monospace;color:#0f172a;outline:none;text-transform:none;letter-spacing:0}
#wrapFplText > .toolbar2 .ftdsp:focus-within{border-color:#E31937!important;box-shadow:0 0 0 3px rgba(227,25,55,.12)}
</style>`;

/* Bảng Tạo KHB: chữ/ô to hơn, khung thẻ bo góc, đầu bảng gọn, dòng thoáng.
   Chỉ đổi kích thước/khung; màu cảnh báo của từng ô (đổi tàu, giới hạn, PLD…) giữ nguyên. */
const KHB_TABLE_MODERN = `<style id="khb-table-modern">
#wrapFplText > .tbl-wrap{margin:10px 14px 14px !important;border:1px solid #E2E8F0 !important;border-radius:14px !important;
  background:#fff !important;box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px -12px rgba(15,23,42,.18) !important;overflow:auto !important}
#wrapFplText table.fttbl{width:2000px !important;font-size:14.5px !important}
#wrapFplText table.fttbl :is(th,td):nth-child(4){width:104px !important}
#wrapFplText table.fttbl :is(th,td):nth-child(5){width:108px !important}
#wrapFplText table.fttbl :is(th,td):nth-child(6){width:64px !important}
#wrapFplText table.fttbl :is(th,td):nth-child(7),#wrapFplText table.fttbl :is(th,td):nth-child(8){width:68px !important}
#wrapFplText table.fttbl :is(th,td):nth-child(9),#wrapFplText table.fttbl :is(th,td):nth-child(10),#wrapFplText table.fttbl :is(th,td):nth-child(11){width:76px !important}
#wrapFplText table.fttbl thead th{
  font-size:12.5px !important;font-weight:700 !important;letter-spacing:.05em !important;padding:13px 8px !important;
  background:#D7102B !important;background-image:linear-gradient(180deg,#E31937 0%,#C70F28 100%) !important;
  border:0 !important;border-right:1px solid rgba(255,255,255,.10) !important;border-bottom:0 !important;
  vertical-align:middle !important;z-index:5 !important}
#wrapFplText table.fttbl thead th:first-child{border-top-left-radius:13px !important}
#wrapFplText table.fttbl thead th:last-child{border-top-right-radius:13px !important;border-right:0 !important}
#wrapFplText table.fttbl :is(th,td):nth-child(3){width:250px !important}
#wrapFplText table.fttbl :is(th,td):nth-child(12),#wrapFplText table.fttbl :is(th,td):nth-child(13){width:215px !important}
#wrapFplText table.fttbl tbody td{padding:7px 6px !important;border-bottom:1px solid #EEF2F6 !important;font-size:14.5px}
#wrapFplText .fttbl tbody tr:nth-child(even) td{background:#F8FAFC}
#wrapFplText .fttbl tbody tr:hover td{background:#FFF4F5}
#wrapFplText table.fttbl input[type=text]{height:38px !important;line-height:38px !important;font-size:15px !important;
  border-radius:9px !important;padding:0 8px !important;transition:border-color .15s,box-shadow .15s}
#wrapFplText table.fttbl input[type=text]:hover{border-color:#CBD5E1}
#wrapFplText table.fttbl input[type=checkbox]{width:20px !important;height:20px !important}
#wrapFplText table.fttbl td.ftperf{font-size:13px !important;line-height:1.4 !important;padding-top:8px !important}
#wrapFplText table.fttbl td.dimcell{color:#CBD5E1 !important}
#wrapFplText .ft-pld-value{font-size:15px !important;line-height:22px !important}
html.night #wrapFplText > .tbl-wrap{background:#1b1f27 !important;border-color:#3a4050 !important}
html.night #wrapFplText table.fttbl tbody td{border-bottom-color:#2a303c !important}
html.night #wrapFplText .fttbl tbody tr:nth-child(even) td{background:#1e2430}
html.night #wrapFplText .fttbl tbody tr:hover td{background:#2a2230}
</style>`;

/* Bảng Hiển thị chung + Công cụ hỗ trợ: cùng phong cách thẻ với bảng KHB
   (khung bo góc, đầu bảng đỏ chuyển sắc, dòng cao, sọc rất nhạt, hover hồng).
   Màu trạng thái dòng (done/fail/pending, dòng đang chọn) giữ nguyên. */
const TABLE_MODERN = `<style id="table-modern">
#wrapTool > .tbl-wrap,#wrapTool .tbl-wrap:has(> table.tooltbl){margin:12px 14px 14px !important;border:1px solid #E2E8F0 !important;border-radius:14px !important;
  background:#fff !important;box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px -12px rgba(15,23,42,.18) !important;overflow:auto !important}
#wrapGeneral.tbl-wrap{border:1px solid #E2E8F0 !important;border-radius:14px !important;background:#fff !important;
  box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px -12px rgba(15,23,42,.18) !important;overflow:auto !important}
:is(#wrapGeneral table.gtable,#wrapTool table.tooltbl) thead th{
  font-size:12.5px !important;font-weight:700 !important;letter-spacing:.05em !important;padding:13px 10px !important;
  background:#D7102B !important;background-image:linear-gradient(180deg,#E31937 0%,#C70F28 100%) !important;
  color:#fff !important;-webkit-text-fill-color:#fff !important;
  border:0 !important;border-right:1px solid rgba(255,255,255,.10) !important;border-bottom:0 !important;vertical-align:middle !important}
:is(#wrapGeneral table.gtable,#wrapTool table.tooltbl) thead th:first-child{border-top-left-radius:13px !important}
:is(#wrapGeneral table.gtable,#wrapTool table.tooltbl) thead th:last-child{border-top-right-radius:13px !important;border-right:0 !important}
#wrapGeneral table.gtable{font-size:13.5px !important}
#wrapGeneral table.gtable tbody td{padding:9px 10px !important;border-bottom:1px solid #EEF2F6 !important}
#wrapGeneral table.gtable tbody td:first-child{font-weight:700 !important;color:#0F172A}
#wrapGeneral table.gtable tbody tr{background:#fff}
#wrapGeneral table.gtable tbody tr:nth-child(even){background:#F8FAFC}
#wrapGeneral table.gtable tbody tr:hover{background:#FFF4F5;box-shadow:inset 3px 0 #E31937}
#wrapTool table.tooltbl{font-size:14px !important}
#wrapTool table.tooltbl tbody td{padding:7px 10px !important;border-bottom:1px solid #EEF2F6 !important;vertical-align:middle}
#wrapTool table.tooltbl tbody td:first-child{color:#94A3B8;font-weight:700;text-align:center;font-variant-numeric:tabular-nums}
#wrapTool table.tooltbl tbody tr:not(.done):not(.fail):not(.pending){background:#fff}
#wrapTool table.tooltbl tbody tr:nth-child(even):not(.done):not(.fail):not(.pending){background:#F8FAFC}
#wrapTool table.tooltbl tbody tr:hover{background:#FFF4F5;box-shadow:inset 3px 0 #E31937}
#wrapTool table.tooltbl input[type=text]{height:36px !important;font-size:14px !important;border-radius:9px !important;padding:0 10px !important;
  border-color:#E2E8F0 !important;transition:border-color .15s,box-shadow .15s}
#wrapTool table.tooltbl input[type=text]:hover{border-color:#CBD5E1 !important}
#wrapTool table.tooltbl input[type=text]:focus{border-color:#E31937 !important;box-shadow:0 0 0 3px rgba(227,25,55,.12) !important}
html.night #wrapTool .tbl-wrap,html.night #wrapGeneral.tbl-wrap{background:#1b1f27 !important;border-color:#3a4050 !important}
html.night :is(#wrapGeneral table.gtable,#wrapTool table.tooltbl) tbody td{border-bottom-color:#2a303c !important}
html.night #wrapGeneral table.gtable tbody td:first-child{color:#eeeae4}
html.night #wrapGeneral table.gtable tbody tr,html.night #wrapTool table.tooltbl tbody tr:not(.done):not(.fail):not(.pending){background:#18181c}
html.night #wrapGeneral table.gtable tbody tr:nth-child(even),html.night #wrapTool table.tooltbl tbody tr:nth-child(even):not(.done):not(.fail):not(.pending){background:#1e2430}
html.night :is(#wrapGeneral table.gtable,#wrapTool table.tooltbl) tbody tr:hover{background:#2a2230}
</style>`;

const KHB_RESULT_SKIN = `<style id="khb-result-skin">
#wrapFplText .fttbl :is(th,td):nth-child(15){width:76px!important;min-width:76px;max-width:76px}
#wrapFplText .fttbl :is(th,td):nth-child(16){width:100px!important;min-width:100px}
#wrapFplText .fttbl td.ft-pld-cell{padding:4px 2px!important;vertical-align:middle;background:var(--atc-paper)!important;letter-spacing:0}
.ft-pld-grid{display:grid;grid-template-columns:minmax(0,1fr);text-align:center;align-items:center}
.ft-pld-value{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;font-size:13px;line-height:20px;font-weight:600;white-space:nowrap;color:var(--atc-ink)}
.ft-pld-input{width:100%;box-sizing:border-box;border:1px solid transparent;border-radius:6px;background:transparent;text-align:center;font:inherit;color:inherit;padding:1px 2px;outline:none}
.ft-pld-input:hover{border-color:var(--atc-line)}
.ft-pld-input:focus{border-color:var(--atc-accent,#2563eb);background:var(--atc-paper)}
.ft-pld-input[data-empty="true"]{color:var(--atc-missing)}
.ft-pld-input.ft-pld-ok{color:var(--atc-success)!important;-webkit-text-fill-color:currentColor!important}
.ft-pld-input.ft-pld-bad{color:var(--atc-danger)!important;-webkit-text-fill-color:currentColor!important}
.ft-pld-difference{margin:5px 8px 0;text-align:center;font-size:10px;line-height:18px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--atc-neutral);border-top:1px solid var(--atc-line);padding-top:3px}
.ft-pld-difference:empty{display:none}
.ft-pld-difference[data-tone="good"]{color:var(--atc-success)}
.ft-pld-difference[data-tone="bad"]{color:var(--atc-danger)}
.ft-pld-hi{animation:khb-payload-alert .85s ease-in-out infinite;font-weight:800}
@keyframes khb-payload-alert{50%{opacity:.5}}
@media(prefers-reduced-motion:reduce){.ft-pld-hi{animation:none;text-decoration:underline;text-decoration-thickness:2px}}
</style>`;


const FILE_CHECK_FN = `
function cmpFileCheckCell(f){
  const td = document.createElement("td");
  td.className = "bat-cell cmp-file-cell";
  if(!f){ td.textContent = "—"; return td; }
  const esc = v => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const a = f.attch || {};
  const items = a.items || [];
  const isVN = !!(f.dep && String(f.dep).toUpperCase().startsWith("VV"));
  const pib = !!f.has_pib, wx = !!f.has_wx;
  const okN = items.filter(m => m.state === "ok").length + (isVN ? (pib?1:0) + (wx?1:0) : 0);
  const total = items.length + (isVN ? 2 : 0);
  const wrong = (a.wrong_n || 0) > 0;
  const missing = total - okN - (a.wrong_n || 0);
  const full = total > 0 && okN === total;
  const soon = !full && fileDueSoon(f.std);
  const pct = total ? Math.round(100 * okN / total) : 0;
  const state = wrong ? "wrong" : soon ? "wrong" : (!full && total ? "miss" : "");
  if(!total){ td.textContent = "—"; return td; }
  td.appendChild(sysBat("att", pct, full, full ? "Đủ" : "Thiếu", state));
  const std = Date.parse(f.std || "");
  const mins = std ? Math.round((std - Date.now()) / 60000) : null;
  const badge = wrong ? ["bad", "⚠ SAI TÀU"] : soon ? ["bad", "⚠ ≤1H TỚI STD"] : full ? ["ok", "ĐỦ HỒ SƠ"] : ["warn", "THIẾU FILE"];
  const row = (ok, name, val) => '<div class="fc-row ' + ok + '"><span class="fc-ic">' + (ok === "ok" ? "✓" : ok === "bad" ? "⚠" : "✗") + '</span><span class="fc-n">' + esc(name) + '</span><b>' + esc(val) + '</b></div>';
  let h = '<div class="fc-tip"><div class="fc-head"><div><div class="fc-cs">' + esc(f.callsign || "") + '</div><div class="fc-sub">' + esc(f.route || "") + (std ? ' · STD ' + new Date(std).toISOString().slice(11,16) + 'Z' : '') + '</div></div><span class="fc-badge ' + badge[0] + '">' + badge[1] + '</span></div>';
  h += '<div class="fc-sec">File Notice add</div>';
  if(items.length) for(const m of items){
    const st = m.state === "ok" ? "ok" : m.state === "wrong" ? "bad" : "miss";
    h += row(st, (typeof attchLine === "function" ? attchLine(m) : (m.kind || "file")), st === "ok" ? "Có" : st === "bad" ? "Sai tàu" : "Thiếu");
  } else h += '<div class="fc-empty">Không có file Notice yêu cầu</div>';
  h += '<div class="fc-sec">PIB / WX</div>';
  if(isVN){ h += row(pib ? "ok" : "miss", "PIB (NOTAM)", pib ? "Đã có" : "Chưa có") + row(wx ? "ok" : "miss", "WX (thời tiết)", wx ? "Đã có" : "Chưa có"); }
  else h += '<div class="fc-empty">Sân đi nước ngoài (' + esc(f.dep || "?") + ') — không cần PIB/WX</div>';
  const why = [];
  if(wrong) why.push("Có " + a.wrong_n + " file gắn sai tàu " + (f.reg ? "(tàu đúng: " + f.reg + ")" : ""));
  if(soon) why.push(mins != null && mins >= 0 ? "Còn " + mins + " phút tới STD mà thiếu " + missing + " file" : "Đã qua STD mà còn thiếu " + missing + " file");
  if(why.length) h += '<div class="fc-alert">' + why.map(esc).join("<br>") + '</div>';
  h += '<div class="fc-foot"><div class="fc-bar"><i style="width:' + pct + '%"></i></div><span>' + okN + '/' + total + ' file · ' + pct + '%</span></div></div>';
  td.dataset.ctip = h;
  if(typeof cmpTipEnsure === "function") cmpTipEnsure();
  return td;
}
`;
const FILE_CHECK_CSS = `<style id="cmp-file-check">
.cmp-tip:has(.fc-tip){padding:0!important;max-width:380px!important;background:#fff!important;color:#0f172a!important;border:1px solid #e2e8f0}
.fc-row .fc-n{color:#0f172a}.fc-row.miss .fc-n{color:#991b1b;font-weight:600}
.fc-tip{min-width:300px;font:13px/1.4 system-ui,sans-serif;color:#0f172a}
.fc-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;background:linear-gradient(135deg,#f8fafc,#eef2ff);border-bottom:1px solid #e2e8f0;border-radius:10px 10px 0 0}
.fc-cs{font-weight:800;font-size:15px;letter-spacing:.02em}.fc-sub{font-size:11.5px;color:#64748b}
.fc-badge{font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap}
.fc-badge.ok{background:#16a34a;color:#fff}.fc-badge.warn{background:#fee2e2;color:#b91c1c}.fc-badge.bad{background:#dc2626;color:#fff;animation:att-wrong-blink .85s infinite}
.fc-sec{padding:8px 14px 3px;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#4f46e5}
.fc-row{display:flex;align-items:center;gap:8px;padding:4px 14px}
.fc-row .fc-n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fc-ic{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex:none}
.fc-row.ok .fc-ic{background:#dcfce7;color:#15803d}.fc-row.ok b{color:#15803d}
.fc-row.miss .fc-ic{background:#fee2e2;color:#b91c1c}.fc-row.miss b{color:#b91c1c}
.fc-row.bad .fc-ic{background:#dc2626;color:#fff}.fc-row.bad b{color:#dc2626}
.fc-empty{padding:3px 14px;color:#94a3b8;font-size:12px;font-style:italic}
.fc-alert{margin:8px 14px 0;padding:7px 10px;border-radius:8px;background:#fef2f2;border-left:3px solid #dc2626;color:#991b1b;font-weight:600;font-size:12px}
.fc-foot{display:flex;align-items:center;gap:10px;padding:10px 14px;margin-top:8px;border-top:1px solid #e2e8f0;font-size:12px;color:#475569;font-weight:600}
.fc-bar{flex:1;height:6px;border-radius:3px;background:#e2e8f0;overflow:hidden}.fc-bar i{display:block;height:100%;background:linear-gradient(90deg,#22c55e,#16a34a)}
.cmptbl td.cmp-file-cell{text-align:center}
</style>`;
async function page(): Promise<string> {
  if (cached) return cached;
  const raw = (await import("@/tool/page.html?raw")).default as string;
  cached = patchCmpDspFastPage(patchCmpBatchPage(patchCmpValidationPage(patchKhbCrewSyncPage(patchKhbPayloadPage(patchFlightIdentityPage(patchAccountMemoryPage(patchFlightRefreshPage(raw))))))))
    .replace('</head>', KHB_RESULT_SKIN + KHB_HEADER_SKIN + CMP_HEADER_SKIN + TOOL_HEADER_SKIN + KHB_TABLE_MODERN + TABLE_MODERN + '</head>')
    .replace('</body>', PLD_HOVER + '</body>')
    // V 6.08: CFP time cell shows OFP STA (UTC) under STD instead of local time.
    .replace(`  if(r.std_excel){
    const lt = document.createElement("span");
    lt.className = "v lt";
    lt.textContent = r.std_excel + " LT";`, `  if(r.sta){
    const lt = document.createElement("span");
    lt.className = "v lt";
    lt.textContent = "STA " + r.sta + "Z";
    td.appendChild(lt);
    td.title = "STD " + r.std + "Z · STA " + r.sta + "Z (OFP/FliteBrief, UTC)"
      + (r.std_excel ? "\\nExcel " + (r.std_excel_src || "STD") + ": " + r.std_excel + " LT" : "");
  }else if(false){
    const lt = document.createElement("span");
    lt.textContent = "";`)
    // V 6.07: one PLD column = OFP payload + (PLD−EST) delta; EST/Δ columns hidden.
    .replace(`      td.appendChild(mk("span", "v n", NUM(w.pld)));
      if(w.dow)`, `      td.appendChild(mk("span", "v n", NUM(w.pld)));
      td.appendChild(mk("span", "pld-d", ""));
      setTimeout(function(){ paintDelta(sid); }, 0);
      if(w.dow)`)
    .replace(`  td.appendChild(wrap);
  td.title = (v > 0
    ? "còn dư "`, `  td.appendChild(wrap);
  const pd = document.querySelector('#cmpBody td[data-w="pld"][data-sid="' + sid + '"] .pld-d');
  if(pd){ pd.innerHTML = ""; const c = wrap.cloneNode(true); pd.appendChild(document.createTextNode(" (")); pd.appendChild(c); pd.appendChild(document.createTextNode(")")); }
  td.title = (v > 0
    ? "còn dư "`)
    .replace('</head>', '<style>.cmptbl thead th:nth-child(18),.cmptbl thead th:nth-child(19),.cmptbl td[data-w="est"],.cmptbl td[data-w="delta"]{display:none!important}.cmptbl td[data-w="pld"]{white-space:nowrap}.cmptbl .pld-d{margin-left:4px}</style></head>')
    .replace('el.textContent = (d.total != null ? d.total + " chuyến · " : "") + hm\n    + (d.added', 'el.title = "Payload EST (Omni) cập nhật lúc " + t.toLocaleString("vi-VN");\n  el.textContent = "EST cập nhật " + hm; void 0\n    + (d.added')
    // The embedded source stays intact; account fixes belong in this shim.
    // Team default accounts (Omni/AviWeb/OpsCore) always show a masked password.
    .replace('id="acOmniPass" placeholder="(giữ nguyên nếu để trống)"', 'id="acOmniPass" value="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" data-mask="1" placeholder="nhập mật khẩu"')
    .replace('id="acAviwebPass" placeholder="(giữ nguyên nếu để trống)"', 'id="acAviwebPass" value="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" data-mask="1" placeholder="nhập mật khẩu"')
    .replace(/id="acOpscorePass" placeholder="[^"]*"/, 'id="acOpscorePass" value="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" data-mask="1" placeholder="nhập mật khẩu"')
    .replace('      const hasPw = Boolean(info.has_password);', '      const hasPw = Boolean(info.has_password) || ((kind === "omni" || kind === "aviweb" || kind === "opscore") && (!info.username || info.username === AC_DEF_USER[kind]));')
    .replace('      $("#ac"+pf+"Pass").value = "";', `      pin.type = "password";
      pin.dataset.saved = "1";
      pin.dataset.mask = "1";
      pin.value = AC_MASK;
      pin.placeholder = "nhập mật khẩu";
      const savedEye = pin.parentNode.querySelector(".aceye");
      if(savedEye) savedEye.textContent = "👁";`)
    .replace('  fetch("/api/credentials").then(r => r.json()).then(d => {', '  return fetch("/api/credentials").then(r => r.json()).then(d => {')
    .replace('    acRefresh();\n  }catch(e){', '    await acRefresh();\n  }catch(e){')
    .replace('</head>', `<style>
#accModal{zoom:calc(var(--taf-read-scale,1) * var(--account-body-scale,1));padding:18px 8px}
#accModal .sheet{max-width:880px;width:100%;max-height:85vh;max-height:85dvh;display:flex;flex-direction:column;flex-shrink:0}
#accModal .sheet-head{flex-shrink:0}
#accModal .sheet-head h3{font-size:22px !important;line-height:1.35}
#accModal .sheet-body{padding:16px;min-height:0;overflow-y:auto;overscroll-behavior-y:contain;touch-action:pan-y;scrollbar-gutter:stable}
#accModal .accard{padding:13px;margin-bottom:12px}
#accModal .accard .top{gap:9px;flex-wrap:wrap}
#accModal .accard .top b{font-size:18px !important;line-height:1.35}
#accModal .accard .top .use,#accModal .achint,#accModal .acwarn{font-size:14.5px !important;line-height:1.5;overflow-wrap:anywhere}
#accModal .field label{font-size:14px !important;line-height:1.4;letter-spacing:0 !important;text-transform:none !important}
#accModal input{font-size:16.5px !important;min-height:40px;padding:8px 11px;min-width:0}
#accModal .acpw{min-width:0}
#accModal .acpw input{padding-right:44px;width:100%}
#accModal .aceye{font-size:19px !important;width:34px;height:34px}
#accModal .acmsg,#accModal .accaps{font-size:14px !important;line-height:1.4}
#accModal .btn.small{font-size:15px !important;min-height:36px;padding:7px 14px}
#accModal .acgrid{gap:11px}
#accModal .acfoot{flex-wrap:wrap;gap:9px}
@media(max-width:700px){#accModal .acgrid{grid-template-columns:minmax(0,1fr)}#accModal .sheet-body{padding:12px}}
</style></head>`)
    // Structured special limits (rules/aircraft groups) shared with the server checker.
    .replace('function limBlankAc(){', specialRulesScript.replace(/^export /gm, '') + '\nfunction limBlankAc(){')
    .replace('function paintLimitWarns(td, warns){', `function limitDisplayWarns(warns, f){
  if(!f) return warns || [];
  const route = String(f.route || "").split(/[-/ ]+/).filter(Boolean);
  const sector = {reg:f.reg, ac:f.ac_type || f.ac, dep:f.dep_icao || f.dep || route[0], dest:f.dest_icao || f.arr_icao || f.dest || f.arr || route[1]};
  let out = (warns || []).slice();
  (limData.special || []).filter(r => r.rule === "ONLY_ACS_APTS").forEach(row => {
    out = out.filter(w => !(w.check === "special" && (String(w.text || "").includes(srRuleLabel(row.rule)) || (row.note && String(w.text || "").includes(row.note)))));
    out.push(...srOnlyAircraftDisplay(row, sector, srGroups));
  });
  return out;
}
function paintLimitWarns(td, warns, f){
  warns = limitDisplayWarns(warns, f);`)
    .replaceAll('paintLimitWarns(td[6], warns);', 'paintLimitWarns(td[6], warns, f);')
    .replaceAll('paintLimitWarns(cell, warns);', 'paintLimitWarns(cell, warns, f);')
    .replace('return warns.some(w => (w.severity || "") === "critical") ? "critical" : "warning";', 'return warns.some(w => w.severity === "critical") ? "critical" : warns.some(w => w.severity !== "success") ? "warning" : "success";')
    .replace('s.className = "lim-bang " + (sev === "critical" ? "crit" : "warn");\n  s.textContent = "!";', 's.className = "lim-bang " + (sev === "critical" ? "crit" : sev === "success" ? "ok" : "warn");\n  s.textContent = sev === "success" ? "✓" : "!";')
    .replace('box.className = "lim-tip";', 'box.className = "lim-tip" + (w.severity === "success" ? " lim-pass" : "");')
    .replace('const tag = (w && w.severity || "") === "critical" ? "⚠ VI PHẠM: " : "• ";', 'const tag = (w && w.severity || "") === "critical" ? "⚠ VI PHẠM: " : w && w.severity === "success" ? "✓ " : "• ";')
    .replace('function srSyncText(row){', 'function srSyncText(row){')
    .replace('srRuleLabel(row.rule) + (row.note ? " — " + row.note : "")', '(row.rule === "ONLY_ACS_APTS" ? "Chỉ các tàu đã chọn được bay đến sân bay " + srAptLabel(row.apts) : srRuleLabel(row.rule)) + (row.note ? " — " + row.note : "")')
    .replace('function repaintLimitCells(ids){\n  const idset = new Set(ids);', 'function repaintLimitCells(ids){\n  const idset = new Set(ids);\n  try{ document.querySelectorAll("#cmpBody td[data-cmp-lim-sid]").forEach(c => { if(!idset.has(c.dataset.cmpLimSid) && !idset.has(Number(c.dataset.cmpLimSid))) return; const r = ((lastCmp && lastCmp.table) || []).find(x => String(x.sector_id) === c.dataset.cmpLimSid); const lf = r && cmpActionFlight(r); if(lf) paintLimitWarns(c, lf.limit_warns || [], lf); }); }catch(_){}')
    .replace('  if(mode === "limits") limRender();', '  if(mode === "limits") limRender();\n  repaintLimitCells(flights.map(f => f.id));')
    .replace('  if(typeof limRender === "function") limRender();', '  if(typeof limRender === "function") limRender();\n  repaintLimitCells(flights.map(f => f.id));')
    .replace('</head>', '<style>.lim-bang.ok{color:var(--vj-dark-ink);border-radius:50%;background:var(--vj-green)}.lim-bang.ok::before{display:none}.taf-tip .lim-pass .lim-tip-head,.taf-tip .lim-pass .lim-tip-rule{color:var(--hover-success)!important}</style></head>')
    // Shared pilot formatting for KHB load/pick/edit/export; source names remain intact.
    .replace('function ftCrewLabel(person){', khbPilotNameScript.replace('export function', 'function') + '\nfunction ftCrewLabel(person){')
    .replace('if(person && person.label) return String(person.label);', 'if(person && person.label) return limitKhbPilotName(person.label);')
    .replace('return ((person && person.id) ? person.id + " " : "") + ((person && person.name) || "");', 'return limitKhbPilotName(((person && person.id) ? person.id + " " : "") + ((person && person.name) || ""));')
    .replace('st.cptText = cpt ? ftCrewLabel(cpt).trim() : (f.cpt || "");', 'st.cptText = limitKhbPilotName(cpt ? ftCrewLabel(cpt) : f.cpt);')
    .replace('st.foText = fo ? ftCrewLabel(fo).trim() : (f.fo || "");', 'st.foText = limitKhbPilotName(fo ? ftCrewLabel(fo) : f.fo);')
    .replace('  const td = document.createElement("td");\n  td.className = "ftflt";\n  if(list.length >= 2){', '  st[key] = limitKhbPilotName(st[key]);\n  const td = document.createElement("td");\n  td.className = "ftflt";\n  if(list.length >= 2){')
    .replace('inp.addEventListener("input", function(){ st[key] = inp.value; });\n  td.appendChild(inp);\n  return ftPack(td);\n}\nfunction ftTafPlace', 'inp.addEventListener("input", function(){ st[key] = inp.value; });\n  inp.addEventListener("change", function(){ st[key] = limitKhbPilotName(inp.value); inp.value = st[key]; });\n  td.appendChild(inp);\n  return ftPack(td);\n}\nfunction ftTafPlace')
    .replace('    const typedCpt = String(st.cptText || "").trim().match', '    st.cptText = limitKhbPilotName(st.cptText);\n    st.foText = limitKhbPilotName(st.foText);\n    const typedCpt = String(st.cptText || "").trim().match')
    // Keep a dispatcher-picked duplicate sector: same id, then full route+ETD; never fall back to the first duplicate.
    .replace('    const nf = same.find(c => c.dep === f.dep) || same[0];', `    const nrm = v => String(v == null ? "" : v).trim().toUpperCase();
    const nf = same.find(c => String(c.id) === String(f.id))
      || same.find(c => nrm(c.dep) === nrm(f.dep) && nrm(c.arr) === nrm(f.arr) && nrm(c.etd) === nrm(f.etd))
      || (same.filter(c => nrm(c.dep) === nrm(f.dep) && nrm(c.arr) === nrm(f.arr)).length === 1 ? same.find(c => nrm(c.dep) === nrm(f.dep) && nrm(c.arr) === nrm(f.arr)) : null)
      || (same.length === 1 ? same[0] : null);`)
    .replace('function ftPickMate(index, id){', 'function ftPickMate(index, id){\n  setTimeout(() => { try{ ftKeepSave(); }catch(_){} }, 0);')
    // A new workbook invalidates both the lookup catalogue and selected KHB rows.
    .replace('if(fplText && !ftCatalog.length) ftLoad();', 'if(fplText) ftLoad();')
    .replace('async function ftLoad(){', `let ftCrewRevision = 0;
let ftKeep = null;
function ftSnap(){
  return ftRows.map(f => f ? {f: f, edit: ftEdit[f.id] ? JSON.parse(JSON.stringify(ftEdit[f.id])) : null} : null);
}
function ftRemap(snap){
  const norm = v => String(v == null ? "" : v).trim().toUpperCase();
  const key = (f, n) => [f.flt, f.date, f.dep, f.arr, f.etd].slice(0, n).map(norm).join("|");
  const used = new Set();
  const out = [];
  for(const k of Object.keys(ftEdit)) delete ftEdit[k];
  snap.forEach((s, i) => {
    if(!s) return;
    let hit = null;
    for(const n of [5, 4, 2, 1]){
      hit = ftCatalog.find(c => !used.has(c.id) && key(c, n) === key(s.f, n));
      if(hit) break;
    }
    if(!hit) return;
    used.add(hit.id);
    // Keep the prior source fields until ftApplyCrewDiff compares them with the
    // fresh catalogue; replacing them here hides changes behind saved edits.
    out[i] = Object.assign({}, s.f, {id: hit.id});
    if(s.edit) ftEdit[hit.id] = s.edit;
  });
  ftRows = out;
}
function ftCrewChanged(){
  ftCrewRevision++;
  // Keep the dispatcher's rows: remember them and re-match after the new Crewlist loads.
  if(ftRows.some(Boolean)) ftKeep = ftSnap();
  ftCatalog = [];
  ftRender();
  $("#ftStat").textContent = "Crewlist đã thay đổi — đang nạp dữ liệu mới…";
  ftLoad();
}
async function ftLoad(){
  const revision = ftCrewRevision;`)
    .replace('    ftCatalog = d.flights || [];', `    if(revision !== ftCrewRevision) return;
    const next = d.flights || [];
    const signature = rows => JSON.stringify(rows.map(f => [f.id, f.flt, f.date, f.dep, f.arr, f.etd, f.reg]));
    if(!ftKeep && ftCatalog.length && signature(ftCatalog) !== signature(next) && ftRows.some(Boolean)) ftKeep = ftSnap();
    ftCatalog = next;
    if(ftKeep){ const snap = ftKeep; ftKeep = null; ftRemap(snap); }`)
    // Flight count line above the KHB buttons.
    .replace('function ftRender(){', `function ftCountLine(){
  const g = $("#ftTaxiBtn") && $("#ftTaxiBtn").closest(".ft-tool-group");
  const bar = g && g.parentElement;
  if(!bar) return;
  let el = document.getElementById("ftCountLine");
  if(!el){
    el = document.createElement("div");
    el.id = "ftCountLine";
    el.style.cssText = "font:700 13px/1.4 'JetBrains Mono',monospace;color:var(--x-khb-ink,#1E3A8A);margin:0 0 4px 2px";
    bar.parentElement.insertBefore(el, bar);
  }
  let n = 0;
  for(let i = 0; i < ftRows.length; i++) if(ftRows[i]) n++;
  for(const k in ftBlank){ const b = ftBlank[k]; if(b && String(b.flt || "").trim() && !ftRows[+k]) n++; }
  el.textContent = "Tổng: " + n + " chuyến";
}
function ftRender(){
  setTimeout(ftCountLine, 0);`)
    // Crewlist uploads can renumber rows: send flight identity, not just the row ID.
    .replace('body: JSON.stringify({ids: ids})', 'body: JSON.stringify({ids: ids, rows: ftRows.filter(Boolean).map(f => ({id:f.id, flt:f.flt, date:f.date, dep:f.dep, arr:f.arr, etd:f.etd}))})')
    .replace('specs.push({id: f.id, talt:', 'specs.push({id: f.id, flt: f.flt, date: f.date, dep: f.dep, arr: f.arr, etd: f.etd, talt:')
    // Airport hover stays bound even before TAF arrives and reads current cell values.
    .replace('function ftWatchTaf(el, pack){', 'function ftWatchTaf(el, source){\n  const pack = typeof source === "function" ? source() : source;')
    .replace('  if(!el || !pack) return;\n  const segs = pack.segments || [];', '  if(!el) return;\n  const segs = (pack && pack.segments) || [];')
    .replace('  const raw = pack.raw || pack.why || "";\n  if(!segs.length && !raw) return;\n  const meta = [pack.code, pack.role, pack.when].filter(Boolean).join(" ");\n  el.addEventListener("mouseenter", ev => showTafTip(ev, meta, segs, raw));', `  let hovering = false;
  el.addEventListener("mouseleave", () => { hovering = false; });
  el.addEventListener("mouseenter", async ev => {
    hovering = true;
    const paint = p => showTafTip(ev, p ? [p.code, p.role, p.when].filter(Boolean).join(" ") : "TAF", (p && p.segments) || [], (p && (p.raw || p.why)) || "Chưa có TAF cho sân này; bấm TAF để cập nhật.");
    const current = () => typeof source === "function" ? source() : source;
    if(current()){ paint(current()); return; }
    showTafTip(ev, "TAF", [], "Đang lấy TAF…");
    try {
      if(!window.__ftTafPending) window.__ftTafPending = ftBindTaf(false, true).finally(() => { window.__ftTafPending = null; });
      await window.__ftTafPending;
      if(hovering && el.isConnected) paint(current());
    } catch(err) {
      if(hovering && el.isConnected) showTafTip(ev, "TAF", [], err.message || "Không tải được TAF; bấm TAF để thử lại.");
    }
  });`)
    .replace('ftWatchTaf(td, ftTafPlace(st, st[key], "ETA"));', 'ftWatchTaf(td, () => ftTafPlace(st, st[key], "ETA"));')
    .replace('ftWatchTaf(depCell, ftTafPlace(st, st.dep, "ETD"));', 'ftWatchTaf(depCell, () => ftTafPlace(st, st.dep, "ETD"));')
    .replace('ftWatchTaf(arrCell, ftTafPlace(st, st.arr, "ETA"));', 'ftWatchTaf(arrCell, () => ftTafPlace(st, st.arr, "ETA"));')
    .replace('async function ftBindTaf(fill){', 'async function ftBindTaf(fill, hoverOnly){')
    // Chỉ đối chiếu lại TAF khi dữ liệu thật sự đổi: nhớ chữ ký specs sau lần
    // chạy thành công, bỏ qua các lần gọi lặp (blur/hover) với cùng dữ liệu.
    .replace('  if(!specs.length) return;', '  if(!specs.length) return;\n  const tafSig = JSON.stringify(specs);\n  if(!fill && window.__ftTafSig === tafSig) return;')
    .replace('  const active = document.activeElement;', '  window.__ftTafSig = tafSig;\n  const active = document.activeElement;')
    // Blur chỉ chạy lại khi giá trị ô thật sự thay đổi, không phải cứ rời ô là chạy.
    .replace('    inp.addEventListener("blur", function(){ ftBindTaf(false).catch(function(){}); });', '    let v0 = inp.value;\n    inp.addEventListener("focus", function(){ v0 = inp.value; });\n    inp.addEventListener("blur", function(){ if(inp.value !== v0) ftBindTaf(false).catch(function(){}); });')
    // Bấm nút TAF tải bản mới: xoá chữ ký cache để lần đối chiếu kế chạy lại thật.
    .replace('    ftBindTaf(false).catch(function(){});\n    const n = tafLastIds.length;', '    window.__ftTafSig = null;\n    ftBindTaf(false).catch(function(){});\n    const n = tafLastIds.length;')
    .replace('    if(fill){ $("#ftStat").textContent = d.error; alert(d.error); }\n    return;', '    if(fill){ $("#ftStat").textContent = d.error; alert(d.error); }\n    if(hoverOnly) throw new Error(d.error);\n    return;')
    .replace('  if(!ftApplying) ftRender();\n  if(fill){', '  if(!ftApplying && !hoverOnly) ftRender();\n  if(fill){')
    // Name each flight that could not be matched to TAF and why.
    .replace('      + " · TAF " + (d.taf_count || 0) + " sân";', '      + " · TAF " + (d.taf_count || 0) + " sân"\n      + ((d.missed_list || []).length ? " — " + d.missed_list.join(" · ") : "");\n    $("#ftStat").title = (d.missed_list || []).join("\\n");')
    // FPL watcher polls every 10s: only re-diff when the watcher reports a new
    // ver pair, or when the newest pair differs from the table already shown.
    .replace('  if(old === fplVerApplied.old && neu === fplVerApplied.new){\n    paintVerBang(ver);\n    return;\n  }', '  const verSig = old + "\\0" + neu;\n  if(verSig === window.__fplVerSig || (old === fplVerApplied.old && neu === fplVerApplied.new)){\n    paintVerBang(ver);\n    return;\n  }\n  window.__fplVerSig = verSig;')
    .replace('  if(mode === "version" && $("#vOld").value && $("#vNew").value\n     && $("#vOld").value !== $("#vNew").value) vRun();', '  if(mode === "version" && $("#vOld").value && $("#vNew").value\n     && $("#vOld").value !== $("#vNew").value\n     && !(vLast && vLast._pair === $("#vOld").value + "\\0" + $("#vNew").value && $("#vBody").querySelector("tr"))) vRun();')
    // Summary comes from the original per-flight verdict pipeline, never raw map hits.
    .replace(/\/\/ Tóm tắt cả ca quốc nội:[\s\S]*?(?=function nmPaintVerdict\(\))/, '')
    .replace(/    let fleet = \(nmData && nmData\.fleet_verdict\) \|\| null;\s*if\(fleet && !\(fleet\.sections \|\| \[\]\)\.length\)\{[\s\S]*?\n    \}/, '    const fleet = (nmData && nmData.fleet_verdict) || null;')
    .replace('function nmBuildVerdict(){', () => `const nmAssessedVerdict = ${assessedVerdict.toString()};\nfunction nmBuildVerdict(){`)
    .replace('    if(graded.size){', '    if(graded.size && !v.tracked){')
    .replace('  const tracked = !!(nmTrackData && String(tf.id || "") === id);', '  const tracked = !!(nmTrackData && String(tf.id || "") === id);\n  if(tracked && nmTrackData.verdict && (nmTrackData.verdict.sections || []).length){\n    const current = nmTrackData.tuned ? nmAssessedVerdict(nmTrackData.verdict, nmTrackData.places || [], nmClassifyEffect) : nmTrackData.verdict;\n    return Object.assign({}, current, {callsign:f.callsign, dep:f.dep, dest:f.dest});\n  }')
    .replace(/\/\* ===== Checklist F-017 ===== \*\/[\s\S]*?(?=\$\("#ftMsgBtn"\)\.onclick)/, () => 'const CK_EDTO_TEMPLATE_URL = '+JSON.stringify(checklistEdtoAsset.url)+';\n'+checklistScript + '\nconst FORM_MNL_TEMPLATE_URL = '+JSON.stringify(formMnlAsset.url)+';\nconst FORM_MNL_SIG_URL = '+JSON.stringify(mnlSigAsset.url)+';\n'+formMnlScript+'\n')
    .replace(/\s*<button type="button" class="btn small" id="ftLicBtn"[^>]*>DSP License<\/button>/, '')
    .replace('KHOUXAAF /OU=KHOUXAAF/O=AFTN/";', 'KHOUXAAF /OU=KHOUXAAF/O=AFTN/PRMD=K/ADMD=ICAO/C=XX/";')
    .replace('  $("#afDef").value=localStorage.getItem(K.def)??DEF_DEFAULT;', `  $("#afDef").value=(localStorage.getItem(K.def)??DEF_DEFAULT).split(/\\r?\\n/).map(line => /^KHOUXAAF\\s+\\/OU=KHOUXAAF\\/O=AFTN\\/\\s*$/i.test(line.trim()) ? "KHOUXAAF /OU=KHOUXAAF/O=AFTN/PRMD=K/ADMD=ICAO/C=XX/" : line).join("\\n");`)
    .replace(/<textarea id="afDef"[^>]*><\/textarea>/, `<textarea id="afDef" hidden></textarea><div class="af-default-scroll"><table id="afDefTable" aria-label="Địa chỉ AFTN mặc định"><colgroup><col class="af-code-col"><col></colgroup><thead><tr><th>CODE</th><th>ĐỊA CHỈ AFTN</th></tr></thead><tbody id="afDefRows"></tbody></table></div>`)
    .replace('  $("#afBook").value=localStorage.getItem(K.book)??BOOK_DEFAULT;', `  const suppliedBook = ${JSON.stringify(aftnAddresses)};
  const savedBook = localStorage.getItem(K.book);
  const customBook = savedBook && savedBook !== BOOK_DEFAULT ? savedBook : "";
  const customCodes = new Set(parse(customBook).map(row => row[0]));
  $("#afBook").value = localStorage.getItem("aftn.book.replaced") === "1" && savedBook !== null ? savedBook : customBook ? customBook + "\\n" + suppliedBook.split(/\\r?\\n/).filter(line => !customCodes.has(line.split(/\\s+/)[0])).join("\\n") : suppliedBook;`)
    .replace(/<textarea id="afBook"[^>]*><\/textarea>/, `<textarea id="afBook" hidden></textarea><div class="af-book-scroll"><table id="afBookTable" aria-label="Danh bạ AFTN"><colgroup><col class="af-code-col"><col></colgroup><thead><tr><th>CODE</th><th>ĐỊA CHỈ AFTN</th></tr></thead><tbody id="afBookRows"></tbody></table></div>`)
    .replace('<div style="font-size:12px;opacity:.8">Dán từ Excel 2 cột (CODE + địa chỉ). Tự lưu trên máy này.</div>', `<div class="af-paste-area"><label for="afBookPaste">DÁN DANH BẠ MỚI</label><textarea id="afBookPaste" spellcheck="false" aria-label="Dán danh bạ AFTN mới" placeholder="CODE&#9;ĐỊA CHỈ AFTN"></textarea><div id="afBookPasteStatus" role="status"></div></div>`)
    .replace('<label>File FPL (chọn thư mục hoặc nhiều file)<br>', '<label hidden>')
    .replace('<div><b>Nội dung FPL tìm được</b>', '<div hidden>')
    .replace('</body>', `<style>
      #afBook[hidden],#afDef[hidden]{display:none!important}
      .af-default-scroll{max-height:260px;overflow:auto;border:1px solid var(--x-line);background:var(--x-card)}
      .af-book-scroll{height:420px;overflow:auto;border:1px solid var(--x-line);background:var(--x-card)}
      .af-paste-area{margin-top:10px;color:var(--x-ink)}
      .af-paste-area label{display:block;font-weight:700;margin-bottom:6px}
      #afBookPaste{width:100%;height:100px;resize:vertical;font-family:var(--x-mono);border:1px solid var(--x-line);background:var(--x-card)!important;color:var(--x-ink)!important;-webkit-text-fill-color:var(--x-ink)!important}
      #afBookPasteStatus{min-height:22px;font-size:13px;color:var(--x-ink)}
      #afBookTable,#afDefTable{width:100%;table-layout:fixed;border-collapse:collapse;font-family:var(--x-mono)}
      #afBookTable .af-code-col,#afDefTable .af-code-col{width:116px}
      #afBookTable th,#afDefTable th{position:sticky;top:0;z-index:1;background:var(--x-bg)!important;color:var(--x-ink)!important;-webkit-text-fill-color:var(--x-ink)!important;text-align:left;padding:8px;border-bottom:1px solid var(--x-line)}
      #afBookTable td,#afDefTable td{padding:6px 8px;border-bottom:1px solid var(--x-line2);border-right:1px solid var(--x-line);vertical-align:top;color:var(--x-ink)!important;-webkit-text-fill-color:var(--x-ink)!important;background:var(--x-card)!important;font-size:13px!important;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}
      #afBookTable td:focus,#afDefTable td:focus{outline:2px solid var(--x-red);outline-offset:-2px}
      #wrapAftn>div:nth-child(2){grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}
      #wrapAftn label:has(#afFl){display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;font-size:16px;font-weight:800;letter-spacing:.06em;color:var(--x-ink);-webkit-text-fill-color:var(--x-ink)}
      #wrapAftn #afFl{box-sizing:border-box!important;width:240px!important;min-height:68px!important;font-size:34px!important;font-weight:800!important;line-height:1;text-align:center!important;padding:8px 12px!important;border:2px solid var(--x-line)!important;border-radius:12px!important;background:var(--x-card)!important;color:#c00!important;-webkit-text-fill-color:#c00!important}
      #wrapAftn #afFl:focus{outline:3px solid var(--x-red);outline-offset:2px}
      #wrapNmTrack .nm-track-head{overflow-x:auto;overflow-y:hidden;flex-wrap:nowrap;scrollbar-width:thin;scrollbar-color:var(--x-ink2) var(--x-line);max-width:100%;min-width:0}
      #wrapNmTrack .nm-track-head #nmTrackHead{flex:0 0 auto;min-width:0;width:max-content}
      #wrapNmTrack .nm-track-head #nmTrackHead:empty{min-width:0;display:none}
      #wrapNmTrack .nm-th-tools{flex-wrap:nowrap;white-space:nowrap;flex:0 0 auto;margin-left:0}
      #wrapNmTrack .nm-th-meta{flex:0 0 auto;padding:0 8px}
      .nm-storm-lbl{background:rgba(17,24,39,.85);color:#fff;border:0;font:700 11px/1.2 sans-serif;padding:2px 5px;box-shadow:none}
      #wrapNmTrack .nm-th-arrow{position:sticky;z-index:3;flex:0 0 auto;align-self:stretch;min-width:28px;border:0;background:var(--x-red);color:#fff;font-size:13px;cursor:pointer;padding:0 6px}
      #wrapNmTrack .nm-th-arrow[hidden]{display:none}
      #wrapNmTrack .nm-th-l{left:0}
      #wrapNmTrack .nm-th-r{right:0;margin-left:auto}
    </style><script>${aftnBookScript}</script><script>${notamGeometryFixes}</script><script>${ddScript}</script><script>${khbEzfwScript}</script><script>${stormToolbarScript}</script><style>.dbx-wrap{flex-direction:column;flex:1;min-height:0;overflow:auto;padding:20px;gap:18px;background:linear-gradient(180deg,#fff7f7,#fff)}
.dbx-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.dbx-head h2{margin:0;font-size:26px;font-weight:800;color:#b91c1c;letter-spacing:-.02em}
.dbx-head p{margin:4px 0 0;color:#64748b;font-size:14px}
#dbxFind{padding:9px 14px;border:1px solid #fecaca;border-radius:999px;min-width:220px;font-size:14px}
.dbx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.dbx-card{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:left;padding:18px;border:1px solid #f1f5f9;border-radius:16px;background:#fff;cursor:pointer;box-shadow:0 2px 10px rgba(15,23,42,.06);transition:transform .15s,box-shadow .15s,border-color .15s;overflow:hidden}
.dbx-card::before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:var(--c)}
.dbx-card:hover{transform:translateY(-3px);box-shadow:0 12px 28px rgba(15,23,42,.12);border-color:var(--c)}
.dbx-ic{font-size:26px;width:46px;height:46px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:color-mix(in srgb,var(--c) 12%,#fff)}
.dbx-t{font-size:17px;font-weight:800;color:#0f172a}
.dbx-d{font-size:13px;color:#64748b;line-height:1.4;flex:1}
.dbx-go{font-size:12px;font-weight:700;color:var(--c);margin-top:4px}
</style><script>window.__namedAirspaceCatalogue=${JSON.stringify([...enrCatalogue(), ...auDahCatalogue()]).replace(/</g, '\\u003c')};</script><script>window.__airportCatalogue=${JSON.stringify(airportCatalogue())};</script><script>${databaseTabScript}</script></body>`)
    .replace(/function moveTafTip\(ev\)\{[\s\S]*?\n\}/, `function moveTafTip(ev){
  const el = tafTipEl();
  if(!el.classList.contains("show")) return;
  const zoom = (parseFloat(document.documentElement.style.zoom) || 1) * (parseFloat(document.body.style.zoom) || 1);
  el.style.setProperty('--taf-read-scale', String(1 / zoom));
  const rect = el.getBoundingClientRect();
  const pad = 16;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if(x + rect.width > window.innerWidth - 12) x = ev.clientX - rect.width - pad;
  if(y + rect.height > window.innerHeight - 12) y = ev.clientY - rect.height - pad;
  x = Math.max(12, Math.min(x, window.innerWidth - rect.width - 12));
  y = Math.max(12, Math.min(y, window.innerHeight - rect.height - 12));
  el.style.left = (x / zoom) + "px";
  el.style.top = (y / zoom) + "px";
  const placed = el.getBoundingClientRect();
  const dx = placed.right > window.innerWidth - 12 ? window.innerWidth - 12 - placed.right : placed.left < 12 ? 12 - placed.left : 0;
  const dy = placed.bottom > window.innerHeight - 12 ? window.innerHeight - 12 - placed.bottom : placed.top < 12 ? 12 - placed.top : 0;
  if(dx) el.style.left = ((parseFloat(el.style.left) || 0) + dx / zoom) + "px";
  if(dy) el.style.top = ((parseFloat(el.style.top) || 0) + dy / zoom) + "px";
}`)
    .replace("<head>", "<head>" + FONTS + SHIM)
    .replace("</head>", SKIN + POPART + PRO + FONTUP + ATC_SKIN + BTNRED + BTNRED2 + DROPDOWN + MOBILE + `<style>:root{--dispatch-sky:url("${dispatchSkyHeader}");--airport-clean:url("${dispatchAirportClean}");--vj-logo:url("${vietjetLogo}")}</style>` + "</head>")
    .replace(
      "const AP_EXACT = {",
      `const ICAO_COUNTRIES = ${JSON.stringify(icaoCountries)};\nconst AP_EXACT = {`,
    )
    .replace(
      '  let hit = AP_EXACT[c] || AP_META[c.slice(0, 2)];',
      '  let hit = AP_EXACT[c] || AP_META[c.slice(0, 2)];\n'
      + '  const airportIso = ICAO_COUNTRIES[c] || "";\n'
      + '  if(airportIso && (!hit || hit[3] !== airportIso)){\n'
      + '    let country = airportIso.toUpperCase();\n'
      + '    try { country = new Intl.DisplayNames(["vi"], {type:"region"}).of(country) || country; } catch(e){}\n'
      + '    hit = [country, "", hit ? hit[2] : "", airportIso];\n'
      + '  }',
    )
    .replace(
      'src="/static/flags/\' + iso + \'.png"',
      'src="/static/flags/\' + iso + \'.svg"',
    )
    .split("/static/shanghai-bund-inner-true-hd.jpg").join("/static/shanghai-bund-night.png")
    // Xuất briefing: khi job xong có link tải, tự động tải ZIP về máy người dùng.
    .replace(
      '+ (m.folder ? " → " + m.folder : ""),',
      '+ (m.folder ? " → " + m.folder : "") + (m.download ? " — đang tải ZIP về máy…" : ""),',
    )
    .replace(
      'bxEs.close(); bxEs = null; bxJob = null;\n            if(btn){ btn.disabled = false; btn.textContent = "Xuất briefing"; }\n            resolve(m);',
      'bxEs.close(); bxEs = null; bxJob = null;\n            if(btn){ btn.disabled = false; btn.textContent = "Xuất briefing"; }\n            if(m.download){ var _a=document.createElement("a"); _a.href=m.download; _a.download=""; document.body.appendChild(_a); _a.click(); _a.remove(); }\n            resolve(m);',
    )
    // Mở web KHÔNG tự đăng nhập Outlook nữa (tránh cửa sổ Microsoft Sign-in
    // hiện lên trên máy công ty) — chỉ chạy khi bấm nút "Đăng nhập Outlook".
    .replace("  startOwaBoot();", "  /* startOwaBoot() tắt: chỉ đăng nhập Outlook khi bấm nút */")
    // Watcher inactivity/token age is not a Microsoft login rejection.
    // Active login/PIB events still own setOwaState, including real auth errors.
    .replace('    if(!owaJob && !tlJob && !d.running) setOwaState("stale");', '')
    .replace(': "chưa chạy — đăng nhập Outlook Web";', ': "tạm dừng quét FPL";')
    .replace("    if(ok) await defPullSummary({quiet: true});", "    /* defect summary chỉ tải khi bấm nút */")
    // Use the persisted merge in the editor too.
    .replace(
      "    limData.aircraft = limPad(d.aircraft || [], LIM_ROWS, limBlankAc);",
      "    limData.aircraft = limPad(d.limits_aircraft || d.aircraft || [], LIM_ROWS, limBlankAc);",
    )
    .replace(/function nmMakeVjBrand\(\)\{[\s\S]*?\n\}/, `const nmOverviewCounts = ${notamCounts.toString()};
function nmMakeVjBrand(){
  const box = document.createElement("div");
  box.className = "nm-overview-counts";
  const pack = nmGroup === NM_GROUP_TRACK ? nmTrackBundle() : nmData;
  const counts = nmOverviewCounts(pack);
  for(const [label, key] of [["NOTAM tổng", "total"], ["CRUCIAL", "impact"], ["MANUAL CHECK", "manual"], ["BRIEFING INFO", "brief"], ["MINOR", "noimpact"]]){
    const item = document.createElement("button");
    item.type = "button";
    item.title = "Xem toàn bộ NOTAM " + label;
    item.onclick = () => { window.nmOvGroup = (window.nmOvGroup === key) ? "" : key; nmRender(); };
    item.className = "nm-overview-count nm-overview-" + key + (window.nmOvGroup === key ? " on" : "");
    item.appendChild(document.createTextNode(label + " "));
    const num = document.createElement("b");
    num.textContent = String(counts[key]);
    item.appendChild(num);
    box.appendChild(item);
  }
  return box;
}
`)
    .replace('function nmPaintList(place, q){', `
function nmPaintList(place, q){
  if(window.nmOvGroup){ try{ if(nmPaintListAll(place, q)) return; }catch(e){} window.nmOvGroup = ""; }
  if(place && !place.error){
    // Sân/FIR: hiện nguyên toàn bộ NOTAM kéo về, không qua phân loại.
    const raw = (place.notams_src || [...(place.notams || []), ...(place.dropped || [])]).map(n => { const c = Object.assign({}, n); delete c.level; delete c._noimp; return c; });
    nmPaintListBase(Object.assign({}, place, {notams: raw, dropped: []}), q);
    return;
  }
  nmPaintListBase(place, q);
}
function nmPaintListAll(place, q){
  const list = $("#nmList"), head = $("#nmPlaceHead");
  if(!list) return false;
  const d = nmGroup === NM_GROUP_TRACK ? nmTrackBundle() : nmData;
  if(!d) return false;
  const key = window.nmOvGroup;
  const names = {total:"NOTAM TỔNG", impact:"CRUCIAL", manual:"MANUAL CHECK", brief:"BRIEFING INFO", noimpact:"MINOR"};
  const grpOf = (n) => {
    if(n._noimp) return "noimpact";
    const l = n.level || "";
    if(l === "CRITICAL" || l === "DELAY-ONLY") return "impact";
    if(l === "NEED MANUAL CHECK") return "manual";
    if(l === "BRIEFING INFO") return "brief";
    return "brief";
  };
  const allRows = [];
  for(const p of (d.places || [])){
    const seen = new Set();
    for(const n of [...(p.notams || []), ...(p.dropped || []).map(x => Object.assign({}, x, {_noimp: true, level: x.level || "NO IMPACT"}))]){
      if(n.ident && seen.has(n.ident)) continue;
      if(n.ident) seen.add(n.ident);
      if(q && !nmMatchItem(n, q)) continue;
      allRows.push([p, n]);
    }
  }
  const rows = key === "total" ? allRows : allRows.filter(([, n]) => grpOf(n) === key);
  list.innerHTML = "";
  if(head) head.textContent = "TOÀN CHUYẾN  ·  " + names[key] + "  ·  " + rows.length + " NOTAM";
  const sum = document.createElement("div");
  sum.className = "nm-grp-sum";
  for(const k of ["total", "impact", "manual", "brief", "noimpact"]){
    const s = document.createElement("button");
    s.type = "button";
    s.className = "nm-grp-pill nm-grp-" + k + (key === k ? " on" : "");
    s.innerHTML = '<i class="nm-gp-dot"></i><span class="nm-gp-lb"></span><b class="nm-gp-n"></b>';
    s.children[1].textContent = names[k];
    s.children[2].textContent = String(k === "total" ? allRows.length : allRows.filter(([, n]) => grpOf(n) === k).length);
    s.onclick = () => { window.nmOvGroup = k === key ? "" : k; nmRender(); };
    sum.appendChild(s);
  }
  list.appendChild(sum);
  if(!rows.length){
    const empty = document.createElement("div");
    empty.className = "nm-item miss";
    empty.textContent = "Không có NOTAM nào trong mục này.";
    list.appendChild(empty);
    return true;
  }
  for(const [p, n] of rows){
    const item = document.createElement("div");
    const selected = !!nmFocusIdent && n.ident === nmFocusIdent;
    item.className = "nm-item" + (n._noimp || n.level === "NO IMPACT" ? " drop" : "") + (selected ? " nm-item-on" : "");
    if(selected){
      const pin = document.createElement("span");
      pin.className = "nm-map-pin";
      pin.textContent = "•";
      item.appendChild(pin);
      item.setAttribute("aria-current", "true");
    }
    if(n.ident) item.dataset.ident = n.ident;
    const lv = document.createElement("div");
    lv.className = "nm-lv nm-lv-" + String(n.level || "NO IMPACT").replace(/[^A-Z]/g, "").toLowerCase();
    const tag = document.createElement("b");
    tag.textContent = (n.level === "NO IMPACT" || !n.level ? "MINOR" : n.level)
      + (n.level === "DELAY-ONLY" && n.impact_delay != null ? " · trễ ≥" + n.impact_delay + "′" : "")
      + (n.match_type ? " · " + n.match_type : "")
      + "  ·  " + (p.kind === "FIR" ? "FIR " : "") + (p.code || "");
    if(n.unidentified_area){ const u = document.createElement("i"); u.className = "nm-unid"; u.textContent = "⚠ UNIDENTIFIED AREA"; tag.appendChild(u); }
    lv.appendChild(tag);
    const why = (n.reasons || []).length ? n.reasons.join(" ") : (n.skip_why || n.reason || "");
    if(why){ const r = document.createElement("span"); r.textContent = why; lv.appendChild(r); }
    item.appendChild(lv);
    const body = document.createElement("div");
    body.className = "nm-item-body";
    body.appendChild(nmPaintFliteText(n.text || n.e_field || "", n.ident || "", n, p));
    item.appendChild(body);
    if(selected){ try{ item.appendChild(nmPaintPinBar(n, p)); }catch(e){} }
    const icao = (p && p.code) || n.icao || "";
    const ident = n.ident || "";
    item.onclick = () => {
      /* Đang xem toàn chuyến thì giữ nguyên: chỉ tô sáng dòng và nhấp nháy
         vùng trên bản đồ, không nhảy về tab sân/FIR của NOTAM. */
      nmShowNotam(icao, ident, "");
    };
    list.appendChild(item);
  }
  if(nmFocusIdent){
    const on = [...list.querySelectorAll(".nm-item")].find(el => el.dataset.ident === nmFocusIdent);
    if(on) on.scrollIntoView({block: "nearest", behavior: "smooth"});
  }
  return true;
}
function nmPaintListBase(place, q){`)
    // Overview selection must resolve the clicked row across all places, not
    // only nmPick; otherwise map clicks clear the selected NOTAM identity.
    .replace('  const place = pack.find(p => p.code === nmPick);', '  const place = window.nmOvGroup ? here : pack.find(p => p.code === nmPick);')
    .replace('    nmPick = place.code;\n    nmShowDropped = false;\n    nmFocusIdent = "";\n    nmRender();', '    nmPick = place.code;\n    window.nmOvGroup = "";\n    nmShowDropped = false;\n    nmFocusIdent = "";\n    nmRender();')
    .replace('    nmGroup = NM_GROUP_TRACK;\n    nmPick = NM_HITS_TAB;', '    nmGroup = NM_GROUP_TRACK;\n    nmPick = NM_HITS_TAB;\n    window.nmOvGroup = "";')
    .replace('  btn.onclick = () => {\n    nmGroup = id;', '  btn.onclick = () => {\n    nmGroup = id;\n    window.nmOvGroup = "";')
    .replace('  close.title = "Đóng";', '  close.title = "Đóng NOTAM";\n  close.setAttribute("aria-label", "Đóng NOTAM");')
    // Keep checkboxes outside flight buttons so button styling/default actions
    // cannot hide or cancel the multi-selection control.
    .replace('    b.prepend(ck);', `    ck.setAttribute("aria-label", "Chọn " + opt.textContent);
    const row = document.createElement("div");
    row.className = "nm-flt-choice";
    row.appendChild(ck);
    row.appendChild(b);
    {
      const bp = document.createElement("span");
      const ok = opt.dataset.bp === "1";
      bp.className = "nm-flt-bp " + (ok ? "ok" : "no");
      bp.textContent = (ok ? "☑" : "☐") + " Briefing pack";
      bp.title = ok ? "Đã verify — có Briefing pack" : "Chưa verify — chưa có Briefing pack";
      row.appendChild(bp);
      try{ window.bpRowExtras && window.bpRowExtras(row, opt); }catch(_e){}
    }`)
    .replace('    el.value = String(f.id);\n    const t = String(f.std || "").match(/T(\\d{2}:\\d{2})/);', '    el.value = String(f.id);\n    el.dataset.bp = (f.verified_by || f.verified_on) ? "1" : "0"; el.dataset.dep = String(f.etd || f.std || "");\n    const t = String(f.std || "").match(/T(\\d{2}:\\d{2})/);')
    .replace('</head>', '<style>.nm-flt-choice{display:flex;align-items:center}.nm-flt-bp{margin-left:auto;padding-left:8px;white-space:nowrap;font:800 11px/1.2 system-ui,sans-serif}.nm-flt-bp.ok{color:#16a34a}.nm-flt-bp.no{color:#dc2626}</style></head>')
    .replace('  const cur = (($("#nmFlt") || {}).value || "");\n  hits.forEach(opt => {', `  const cur = (($("#nmFlt") || {}).value || "");
  {
    const allRow = document.createElement("label");
    allRow.className = "nm-flt-choice nm-flt-all";
    const allCk = document.createElement("input");
    allCk.type = "checkbox"; allCk.className = "nm-flt-ck";
    allCk.checked = hits.length > 0 && hits.every(o => nmMulti.has(o.value));
    allCk.setAttribute("aria-label", "Chọn tất cả chuyến");
    allCk.onmousedown = ev => ev.stopPropagation();
    allCk.onclick = ev => {
      ev.stopPropagation();
      hits.forEach(o => { if(allCk.checked) nmMulti.add(o.value); else nmMulti.delete(o.value); });
      box.querySelectorAll(".nm-flt-choice:not(.nm-flt-all) .nm-flt-ck").forEach(c => { c.checked = allCk.checked; });
      nmMultiLabel();
    };
    const t = document.createElement("span");
    t.textContent = "Tất cả (" + hits.length + " chuyến)";
    allRow.appendChild(allCk); allRow.appendChild(t);
    box.appendChild(allRow);
    const split = document.createElement("div");
    split.className = "nm-flt-split";
    [["intl", "Quốc tế", o => o.className.indexOf("intl") >= 0], ["dom", "Quốc nội", o => o.className.indexOf("intl") < 0]].forEach(([k, name, test]) => {
      const grp = hits.filter(test);
      const sb = document.createElement("button");
      sb.type = "button"; sb.className = "nm-flt-sp nm-flt-sp-" + k;
      const allOn = grp.length > 0 && grp.every(o => nmMulti.has(o.value));
      if(allOn) sb.classList.add("on");
      sb.textContent = name + " (" + grp.length + ")";
      sb.onmousedown = ev => ev.preventDefault();
      sb.onclick = ev => {
        ev.preventDefault(); ev.stopPropagation();
        grp.forEach(o => { if(allOn) nmMulti.delete(o.value); else nmMulti.add(o.value); });
        nmMultiLabel(); nmFltFillItems(($("#nmFltQ") || {}).value || "");
      };
      split.appendChild(sb);
    });
    box.appendChild(split);
  }
  hits.forEach(opt => {`)
    .replace('let nmBatchLbl = "";', `let nmBatchLbl = "";
let nmRteOverlays = [];
function nmRouteLayers(ids){
  const map = nmEnsureMap();
  if(!map || !nmLayerCtl) return;
  nmRteOverlays.forEach(g => { try{ nmLayerCtl.removeLayer(g); map.removeLayer(g); }catch(e){} });
  nmRteOverlays = [];
  const sel = $("#nmFlt");
  const rows = ids.map(id => {
    const d = nmTrackCache[String(id)];
    if(!d) return null;
    const f = d.flight || {};
    return {id: String(id), d, f, intl: nmIsIntl(f)};
  }).filter(Boolean).sort((a, b) => (b.intl - a.intl) || String(a.f.callsign || "").localeCompare(String(b.f.callsign || "")));
  for(const r of rows){
    const g = L.layerGroup();
    const legs = nmAddRouteLegs(r.d.track, r.d.line, {weight: 4, opacity: 1, flightId: r.id, color: r.intl ? "#c62828" : "#f2c200"});
    if(!legs.length) continue;
    const tip = (r.f.callsign || "") + "  " + (r.f.dep || "") + "–" + (r.f.dest || "");
    legs.forEach(l => { l.bindTooltip(tip); l.addTo(g); });
    const lab = '<b class="nm-rte-tag ' + (r.intl ? "qt" : "qn") + '">' + (r.intl ? "QT" : "QN") + "</b> " + esc(tip);
    nmLayerCtl.addOverlay(g, lab);
    nmRteOverlays.push(g);
  }
  if(sel) void sel;
}`)
    .replace('  $("#nmFlt").value = ids[0]; nmFltSyncQ(); nmTrackShow(ids[0]);', '  $("#nmFlt").value = ids[0]; nmFltSyncQ(); nmTrackShow(ids[0]);\n  if(ids.length > 1) nmRouteLayers(ids);')
    .replace('    box.appendChild(b);\n  });\n}\nfunction nmFltPlaceMenu', '    box.appendChild(row);\n  });\n}\nfunction nmFltPlaceMenu')
    .replace('</head>', `<style>
      #nmFltItems .nm-flt-choice{display:flex;align-items:center;gap:8px;padding-left:10px;min-height:42px}
      #nmFltItems .nm-flt-choice:has(input:checked){background:var(--x-red-50)}
      #nmFltItems .nm-flt-split{display:flex;gap:6px;padding:6px 10px;border-bottom:1px solid var(--x-line)}
      #wrapNotam #nmFltItems .nm-flt-sp{flex:1;text-align:center;border:1.5px solid;border-radius:8px;font-weight:800;padding:8px 4px}
      #wrapNotam #nmFltItems .nm-flt-sp-intl{color:#c62828;border-color:#c62828}
      #wrapNotam #nmFltItems .nm-flt-sp-dom{color:#1d4ed8;border-color:#1d4ed8}
      #wrapNotam #nmFltItems .nm-flt-sp-intl.on{background:#c62828;color:#fff}
      #wrapNotam #nmFltItems .nm-flt-sp-dom.on{background:#1d4ed8;color:#fff}
      #nmTrackMap .nm-rte-tag{display:inline-block;font-size:10px;padding:1px 5px;border-radius:4px;color:#fff}
      #nmTrackMap .nm-rte-tag.qt{background:#c62828}#nmTrackMap .nm-rte-tag.qn{background:#1d4ed8}
      #nmFltItems .nm-flt-all{font:800 15px/1.3 Arial,sans-serif;color:var(--x-red);border-bottom:1px solid var(--x-line);cursor:pointer;padding-right:10px}
      #wrapNotam #nmFltItems .nm-flt-choice>button{flex:1;min-width:0;text-align:left;width:auto}
      #nmFltItems .nm-flt-choice>.nm-flt-ck{display:block!important;visibility:visible!important;opacity:1!important;appearance:auto!important;position:static!important;flex:0 0 20px;width:20px!important;height:20px!important;margin:0!important;padding:0!important;accent-color:var(--x-red);cursor:pointer}
      #nmTrackMap .nm-side-pop{box-sizing:border-box;width:440px;max-width:calc(100% - 24px);max-height:calc(100% - 24px);padding:54px 20px 20px;background:var(--x-card);color:var(--x-ink);border:1px solid var(--x-line);border-top:4px solid var(--x-red);border-radius:8px;box-shadow:0 8px 24px color-mix(in srgb,var(--x-ink) 20%,transparent);font:16px/1.6 Arial,Helvetica,sans-serif;overflow:auto;overflow-wrap:anywhere;scrollbar-gutter:stable}
      #nmTrackMap .nm-side-pop::before{content:"NOTAM";position:absolute;top:14px;left:20px;font:800 14px/24px Arial,Helvetica,sans-serif;color:var(--x-red)}
      #nmTrackMap .nm-side-pop b{font-size:17px;line-height:1.5;color:var(--x-ink)}
      #nmTrackMap .nm-side-pop-x{top:8px;right:8px;width:40px;height:40px;display:grid;place-items:center;background:var(--x-bg);color:var(--x-ink2);border:1px solid var(--x-line);border-radius:6px;font:400 30px/1 Arial,sans-serif;cursor:pointer}
      #nmTrackMap .nm-side-pop-x:hover,#nmTrackMap .nm-side-pop-x:focus-visible{background:var(--x-red-50);color:var(--x-red);border-color:var(--x-red);outline:2px solid var(--x-red);outline-offset:2px}
      #nmTrackMap .nm-stack-pop{max-width:none}
      #nmTrackMap .nm-stack-item{padding:12px 8px;font:inherit;color:var(--x-ink);border-radius:6px}
      #nmTrackMap .nm-stack-item:hover{background:var(--x-red-50)}
      #nmTrackMap .nm-stack-pop hr{border-color:var(--x-line)}
      #nmTrackMap .nm-stack-n{font-size:14px;color:var(--x-ink2)}
      #nmTrackMap .leaflet-control-layers{background:var(--x-card);color:var(--x-ink);border:1px solid var(--x-line);border-radius:8px;box-shadow:0 4px 16px color-mix(in srgb,var(--x-ink) 16%,transparent);font:15px/1.4 Arial,Helvetica,sans-serif}
      #nmTrackMap .leaflet-control-layers-toggle{width:44px;height:44px}
      #nmTrackMap .leaflet-control-layers-expanded{box-sizing:border-box;width:280px;max-width:calc(100vw - 48px);padding:14px 12px}
      #nmTrackMap .leaflet-control-layers-list{max-height:min(580px,65vh);overflow-y:auto;scrollbar-gutter:stable;padding-right:4px}
      #nmTrackMap .leaflet-control-layers-base::before,#nmTrackMap .leaflet-control-layers-overlays::before{display:block;padding:4px 8px 10px;font:800 12px/1.4 Arial,sans-serif;color:var(--x-mute)}
      #nmTrackMap .leaflet-control-layers-base::before{content:"BẢN ĐỒ NỀN"}
      #nmTrackMap .leaflet-control-layers-overlays::before{content:"LỚP HIỂN THỊ";padding-top:8px}
      #nmTrackMap .leaflet-control-layers-list label{display:block;margin:2px 0;border-radius:6px;cursor:pointer}
      #nmTrackMap .leaflet-control-layers-list label>span{display:flex;align-items:center;gap:10px;min-height:38px;padding:6px 8px;box-sizing:border-box}
      #nmTrackMap .leaflet-control-layers-list label>span>span{flex:1;white-space:normal}
      #nmTrackMap .leaflet-control-layers-list label:hover{background:var(--x-bg)}
      #nmTrackMap .leaflet-control-layers-list label:has(input:checked){background:var(--x-red-50);color:var(--x-red-d);font-weight:700}
      #nmTrackMap .leaflet-control-layers-selector{position:static;flex:0 0 18px;width:18px;height:18px;margin:0;accent-color:var(--x-red);cursor:pointer}
      #nmTrackMap .leaflet-control-layers-separator{border-color:var(--x-line);margin:10px 0}
      #nmTrackMap .nm-ats-all{display:none!important}
      #nmTrackMap .leaflet-control-layers-expanded{border:0;border-radius:16px;padding:16px 14px;background:color-mix(in srgb,var(--x-card) 92%,transparent);backdrop-filter:blur(10px);box-shadow:0 12px 32px color-mix(in srgb,var(--x-ink) 22%,transparent)}
      #nmTrackMap .leaflet-control-layers-base::before,#nmTrackMap .leaflet-control-layers-overlays::before{font:800 11px/1.4 Arial,sans-serif;letter-spacing:.12em}
      #nmTrackMap .leaflet-control-layers-list label{margin:4px 0;border-radius:10px;border:1px solid transparent;transition:background .15s,border-color .15s}
      #nmTrackMap .leaflet-control-layers-list label:has(input:checked){border-color:var(--x-red)}
      #nmTrackMap .leaflet-control-layers-separator{margin:12px 4px}
      @media(max-width:600px){#nmTrackMap .nm-side-pop{top:8px;right:8px;max-width:calc(100% - 16px);padding-left:16px;padding-right:16px}}
      #wrapNotam #nmList .nm-item.nm-item-on{background:color-mix(in srgb,var(--x-red) 10%,var(--x-bg));color:var(--x-ink);outline:2px solid var(--x-red);outline-offset:-2px;border-left:5px solid var(--x-red);border-radius:6px;padding:12px 12px 12px 38px;margin:6px 2px;position:relative}
      #wrapNotam #nmList .nm-item.nm-item-on .nm-map-pin{background:var(--x-red);color:var(--x-bg);left:10px;top:12px}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-counts{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:8px;max-width:100%;font-size:13px}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-count{display:inline-flex;gap:7px;align-items:center;padding:5px 8px;border-radius:6px;background:var(--x-bg);color:var(--x-ink2);border:1px solid var(--x-line);white-space:nowrap;font-weight:650}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-count b{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;color:var(--x-ink)}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-impact{border-color:var(--x-red);color:var(--x-red)}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-impact b{color:var(--x-red)}
      :is(#nmTabs,.nm-vd-counts) button.nm-overview-count{cursor:pointer;font:inherit;font-weight:650}
      :is(#nmTabs,.nm-vd-counts) button.nm-overview-count:hover{transform:translateY(-1px);box-shadow:0 2px 6px rgba(0,0,0,.12)}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-manual{border-color:#d97706;color:#b45309}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-brief{border-color:#2563eb;color:#1d4ed8}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-count{transition:transform .15s ease, box-shadow .15s ease}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-count.on{outline:none;box-shadow:0 3px 10px rgba(0,0,0,.22)}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-total.on{background:#334155;border-color:#334155;color:#fff}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-impact.on{background:#dc2626;border-color:#dc2626;color:#fff}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-manual.on{background:#d97706;border-color:#d97706;color:#fff}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-brief.on{background:#2563eb;border-color:#2563eb;color:#fff}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-noimpact.on{background:#16a34a;border-color:#16a34a;color:#fff}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-count.on b{color:#fff}
      :is(#nmTabs,.nm-vd-counts) .nm-overview-noimpact{border-color:#16a34a;color:#15803d}
      .nm-vd-counts{margin:8px 12px 2px;padding:10px;border:1px solid #e4eaf3;border-radius:12px;background:#f8fafc}
      .nm-vd-counts .nm-overview-counts{display:flex;flex-wrap:wrap;gap:6px;margin:0}
      /* Ghim thanh công cụ + hàng nhóm khi cuộn danh sách NOTAM */
      #wrapNotam .toolbar2{position:sticky;top:0;z-index:130;box-shadow:0 2px 8px rgba(156,26,92,.12)}
      #wrapNotam .nm-bar2{position:sticky;top:var(--nm-tbh,46px);z-index:125;background:linear-gradient(145deg,#fff5fa,#fce9f1);padding-bottom:4px}
    </style></head>`)
    .replace('if(nmTrackData) nmTrackCache[id] = nmTrackData;', 'if(nmTrackData){ nmTrackCache[id] = nmTrackData; try{ window.bpSaveBase && window.bpSaveBase(id, nmTrackData); }catch(_e){} }')
    .replace('</body>', `<style>
#wrapNotam .nm-flt-menu{width:min(800px,96vw) !important;max-width:96vw !important;min-width:min(800px,96vw) !important}
#wrapNotam #nmFltItems .nm-flt-choice:not(.nm-flt-all){display:grid !important;grid-template-columns:22px minmax(0,1fr) 150px 130px 150px 72px;align-items:center;gap:8px;padding:4px 10px !important;min-height:40px;border-bottom:1px solid #eef0f4}
#wrapNotam #nmFltItems .nm-flt-choice:not(.nm-flt-all) > button{white-space:nowrap !important;overflow:hidden;text-overflow:ellipsis;text-align:left;min-height:32px !important;padding:6px 8px !important;border-radius:8px}
#wrapNotam #nmFltItems .nm-flt-choice .nm-flt-bp{margin:0;padding:0;justify-self:start}
#wrapNotam #nmFltItems .nm-flt-choice .nm-flt-cmp{margin:0;justify-self:start;text-align:center}
#wrapNotam #nmFltItems .nm-flt-choice .nm-flt-new{margin:0;justify-self:start}
#wrapNotam #nmFltItems .nm-flt-choice .nm-flt-cmp.none{visibility:hidden}
#wrapNotam #nmFltItems .nm-flt-choice .nm-flt-bp{font-size:14px !important;font-weight:800 !important}
#wrapNotam #nmFltItems .nm-flt-choice .nm-flt-cmp{font-size:13.5px;padding:4px 10px}
.nm-flt-cd{justify-self:start;padding:4px 10px;border-radius:999px;font:800 13px/1.2 ui-monospace,Consolas,monospace;white-space:nowrap;border:1px solid #cbd5e1;color:#475569;background:#f8fafc}
.nm-flt-cd.run{color:#1d4ed8;border-color:#93c5fd;background:#eff6ff}
.nm-flt-cd.ok{background:#16a34a;color:#fff;border-color:#16a34a;font-family:system-ui,sans-serif}
.nm-flt-cd.scan{color:#b45309;border-color:#fcd34d;background:#fffbeb}
.nm-flt-cmp{margin-left:6px;padding:2px 7px;border-radius:999px;white-space:nowrap;font:800 11px/1.2 system-ui,sans-serif;cursor:pointer;border:1px solid transparent}
.nm-flt-cmp.wait{color:#64748b;border-color:#cbd5e1;background:#f8fafc}
.nm-flt-cmp.ok{background:#16a34a;color:#fff}
.nm-flt-cmp.bad{background:#dc2626;color:#fff}
.nm-flt-new{margin-left:6px;padding:2px 7px;border-radius:999px;background:#dc2626;color:#fff;font:800 11px/1.2 system-ui,sans-serif;cursor:pointer;animation:bpPulse 1s infinite}
@keyframes bpPulse{50%{opacity:.35}}
#bpToast{position:fixed;right:18px;top:70px;z-index:99999;max-width:380px;background:#dc2626;color:#fff;padding:12px 14px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.3);font:600 14px/1.4 system-ui,sans-serif;white-space:pre-line;cursor:pointer}
</style><script>(function(){
  ${bpParsePack.toString()}
  ${bpWebIds.toString()}
  ${bpCompare.toString()}
  ${bpNewIds.toString()}
  ${bpDueRescan.toString()}
  function uid(){ try{ for(const k of Object.keys(localStorage)){ if(/^sb-.*-auth-token$/.test(k)){ const s = JSON.parse(localStorage.getItem(k)||"{}"); const u = (s.user||(s.currentSession||{}).user||{}).id; if(u) return u; } } }catch(e){} return "anon"; }
  const K = (kind, fid) => "nm." + kind + ":" + uid() + ":" + fid;
  const get = (k) => { try{ return JSON.parse(localStorage.getItem(k) || "null"); }catch(e){ return null; } };
  const set = (k, v) => { try{ if(v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  const allIds = (places) => { const w = bpWebIds(places); return [...new Set(Object.values(w).flat())]; };
  function depOf(fid){ const o = document.querySelector('#nmFlt option[value="' + fid + '"]'); const t = Date.parse((o && o.dataset.dep) || ""); return t; }
  function label(fid){ const o = document.querySelector('#nmFlt option[value="' + fid + '"]'); return o ? String(o.textContent || "").trim().split(/\\s+/)[0] : ("#" + fid); }
  window.bpSaveBase = function(fid, data){
    const places = (data && data.places) || [];
    const old = get(K("watch", fid));
    const dep = depOf(fid);
    // Lần check trong giờ T-60 vẫn làm mốc mới; đã quét T-60 rồi thì giữ trạng thái done.
    setTimeout(() => { const o = document.querySelector('#nmFlt option[value="' + fid + '"]'); if(o && o.dataset.bp === "1") autoPack(fid); }, 500);
    set(K("watch", fid), { ids: allIds(places), dep: Number.isFinite(dep) ? dep : (old && old.dep) || null, done: !!(old && old.done && old.dep === dep) });
  };
  function refill(){ try{ if(typeof nmFltFillItems === "function") nmFltFillItems((document.getElementById("nmFltQ") || {}).value || ""); }catch(e){} }
  function toast(msg){
    let t = document.getElementById("bpToast"); if(t) t.remove();
    t = document.createElement("div"); t.id = "bpToast"; t.textContent = msg; t.title = "Bấm để đóng";
    t.onclick = () => t.remove(); document.body.appendChild(t);
    try{ const a = new (window.AudioContext || window.webkitAudioContext)(); [0, .18].forEach((d, i) => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = i ? 1100 : 880; g.gain.value = .6; o.connect(g); g.connect(a.destination); o.start(a.currentTime + d); o.stop(a.currentTime + d + .15); }); }catch(e){}
  }
  const bpBusy = {};
  async function autoPack(fid, force){
    const data = (typeof nmTrackCache !== "undefined" && nmTrackCache[fid]) || null;
    if(!data || bpBusy[fid]) return;
    const prev = get(K("bpcmp", fid));
    if(prev && !force && prev.web === allIds(data.places || []).length) return;
    bpBusy[fid] = 1; refill();
    try{
      const r = await fetch("/api/notam/bpack?fid=" + encodeURIComponent(fid));
      if(!/pdf/.test(r.headers.get("content-type") || "")){ const j = await r.json().catch(() => ({})); set(K("bpcmp", fid), { err: j.error || ("HTTP " + r.status) }); return; }
      const pdfjs = await import("/vendor/pdf.min.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise;
      let text = "";
      for(let i = 1; i <= doc.numPages; i++){ const tc = await (await doc.getPage(i)).getTextContent(); text += tc.items.map(t => t.str).join(" ") + "\\n"; }
      const res = bpCompare(bpParsePack(text), bpWebIds(data.places || []));
      set(K("bpcmp", fid), { at: Date.now(), web: allIds(data.places || []).length, common: res.common, packCount: res.packCount, missing: res.missing });
      if(res.missing.length) toast(label(fid) + ": Briefing pack có " + res.missing.length + " NOTAM web chưa có\\n" + res.missing.map(m => m.loc + " " + m.id).join(", "));
    }catch(e){ set(K("bpcmp", fid), { err: String(e && e.message || e) }); }
    finally{ delete bpBusy[fid]; refill(); }
  }
  window.bpAutoPack = autoPack;
  window.bpRowExtras = function(row, opt){
    const fid = opt.value;
    if(opt.dataset.bp === "1"){
      const c = get(K("bpcmp", fid));
      const s = document.createElement("span");
      if(bpBusy[fid]){ s.className = "nm-flt-cmp wait"; s.textContent = "Đang so…"; }
      else if(!c){ s.className = "nm-flt-cmp wait"; s.textContent = "Chưa so"; s.title = "Check NOTAM chuyến này, web sẽ tự so với Briefing pack trên FliteBrief"; }
      else if(c.err){ s.className = "nm-flt-cmp wait"; s.textContent = "Lỗi pack"; s.title = c.err + " — bấm để thử lại"; }
      else if(!c.missing.length){ s.className = "nm-flt-cmp ok"; s.textContent = "✓ Đủ NOTAM"; s.title = "Web có đủ " + c.packCount + " NOTAM của pack ở " + c.common.join(", ") + ". Bấm để so lại."; }
      else { s.className = "nm-flt-cmp bad"; s.textContent = "✕ Thiếu " + c.missing.length; s.title = "Web chưa có:\\n" + c.missing.map(m => m.loc + "  " + m.id).join("\\n") + "\\n\\nBấm để so lại."; }
      s.onmousedown = ev => { ev.preventDefault(); ev.stopPropagation(); };
      s.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); if(!(typeof nmTrackCache !== "undefined" && nmTrackCache[fid])){ alert("Hãy Check NOTAM tracking chuyến " + label(fid) + " trước."); return; } autoPack(fid, true); };
      row.appendChild(s);
    } else { const s = document.createElement("span"); s.className = "nm-flt-cmp none"; s.textContent = "-"; row.appendChild(s); }
    const cd = document.createElement("span"); cd.className = "nm-flt-cd"; cd.dataset.fid = fid; cdPaint(cd); row.appendChild(cd);
    const nw = get(K("new", fid));
    if(nw && nw.ids && nw.ids.length){
      const b = document.createElement("span"); b.className = "nm-flt-new"; b.textContent = "+" + nw.ids.length + " mới";
      b.title = "NOTAM mới trước giờ bay 1h:\\n" + nw.ids.join("\\n") + "\\n\\nBấm để đã xem";
      b.onmousedown = ev => { ev.preventDefault(); ev.stopPropagation(); };
      b.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); set(K("new", fid), null); refill(); };
      row.appendChild(b);
    }
  };
  function fmt(ms){ const t = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), x = t % 60; return "⏱ " + (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(x).padStart(2, "0"); }
  function cdPaint(el){
    const fid = el.dataset.fid, w = get(K("watch", fid)), nw = get(K("new", fid));
    el.title = "Quét lại NOTAM lúc 1 giờ trước STD";
    if(!w || !w.dep){ el.className = "nm-flt-cd"; el.textContent = "Chưa check"; return; }
    if(w.done){ if(nw && nw.ids && nw.ids.length){ el.className = "nm-flt-cd scan"; el.textContent = "Đã quét T-60"; } else { el.className = "nm-flt-cd ok"; el.textContent = "✓ Không NOTAM mới"; } return; }
    const left = w.dep - 3600_000 - Date.now();
    if(left > 0){ el.className = "nm-flt-cd run"; el.textContent = fmt(left); }
    else { el.className = "nm-flt-cd scan"; el.textContent = "Đang quét…"; }
  }
  setInterval(() => document.querySelectorAll(".nm-flt-cd[data-fid]").forEach(cdPaint), 1000);
  let busy = false;
  async function tick(){
    if(busy) return; busy = true;
    try{
      const pre = "nm.watch:" + uid() + ":";
      for(const k of Object.keys(localStorage)){
        if(!k.startsWith(pre)) continue;
        const fid = k.slice(pre.length);
        const w = get(k); if(!w) continue;
        const now = Date.now();
        if(w.dep && (now > w.dep + 6 * 3600_000)){ set(k, null); continue; }
        if(!bpDueRescan(Number(w.dep), now, !!w.done)) continue;
        w.done = true; set(k, w);
        try{
          const r = await fetch("/api/notam/track?id=" + encodeURIComponent(fid) + "&days=2");
          const d = await r.json();
          if(!d || d.error) continue;
          const added = bpNewIds(w.ids || [], allIds(d.places || []));
          if(added.length){
            set(K("new", fid), { ids: added, at: now });
            toast(label(fid) + " có " + added.length + " NOTAM mới (" + (w.ids || []).length + " → " + ((w.ids || []).length + added.length) + ")\\n" + added.join(", "));
            refill();
          }
        }catch(e){}
      }
    }finally{ busy = false; }
  }
  setInterval(tick, 60000); setTimeout(tick, 15000);
})();</script></body>`)
    .replace('</body>', `<script>(function(){
  function nmStickyTb(){
    var w = document.getElementById("wrapNotam");
    var tb = w && w.querySelector(".toolbar2");
    if(!w || !tb) return;
    w.style.setProperty("--nm-tbh", tb.offsetHeight + "px");
  }
  window.addEventListener("resize", nmStickyTb);
  var t0 = Date.now();
  var iv = setInterval(function(){
    nmStickyTb();
    if(Date.now() - t0 > 15000) clearInterval(iv);
  }, 800);
  document.addEventListener("DOMContentLoaded", nmStickyTb);
})();</script></body>`)
    .replace('  if(nmMapIsTrack() && row) onSeg = !!nmFlashTrackNotam(row);', `  const areaHit = nmFindHit(ident);
  const hasBoundary = areaHit && ((areaHit.ring || []).length >= 3 || Number(areaHit.radius_nm) > 0 || ((areaHit.shape === "line" || areaHit.shape === "linestring") && (areaHit.ring || []).length >= 2));
  if(hasBoundary){ nmFocusMap(ident); onSeg = true; }
  else if(nmMapIsTrack() && row) onSeg = !!nmFlashTrackNotam(row);`)
    .replaceAll('A product by Rosie', 'Dispatch Board')
    .replace('Roise x HN', 'Hy x HN')
    .replace('["prefix_or_touches","Prefix quốc gia / sân bay"], ["touches_or_alt","Đi/đến/alternate"]\n];', '["prefix_or_touches","Prefix quốc gia / sân bay"], ["touches_or_alt","Đi/đến/alternate"],\n  ["prefix_touches_alt","Vùng/quốc gia (đi/đến/dự bị, !XX loại trừ)"]\n];')
    .replace(/(id="appVersion"[^>]*>)V [\d.]+/, '$1V 6.20')
    // V 6.17: ERA hợp lệ khi có trong OFP và không bị cảnh báo AIR OPS; chỉ báo lỗi ERA với chuyến ≥ 3h.
    .replace('ERA: chuyến 3PCT phải có sân enroute và TIME dưới 60p.', 'ERA: có ERA và không bị cảnh báo AIR OPS → hợp lệ; chỉ chuyến ≥ 3h thiếu/không đạt ERA mới báo lỗi.')
    // V 6.16: NOTAM map box 'Ẩn vùng xa route (>50 NM)' keeps every area (incl. MINOR) within 50 NM of the route.
    // V 6.14: tên tab thanh bên bằng tiếng Anh (chuẩn OCC); id giữ nguyên.
    .replace('title="Tạo KHB / FPL.req theo sheet TOOL từ file sohee">Tạo KHB</button>', 'title="Tạo KHB / FPL.req theo sheet TOOL từ file sohee">Flight Planning</button>')
    .replace('title="Bảng giao ca: chuyến bay, extra, ATC, EZFW, ATFM, note">Giao ca</button>', 'title="Bảng giao ca: chuyến bay, extra, ATC, EZFW, ATFM, note">Shift Handover</button>')
    .replace('aria-selected="true">Hiển thị chung<span', 'aria-selected="true">Flight Overview<span')
    .replace('aria-live="polite"></span>Dữ liệu so sánh</button>', 'aria-live="polite"></span>Flight Supervisor</button>')
    .replace('aria-selected="false">Công cụ hỗ trợ</button>', 'aria-selected="false">Dispatch Tools</button>')
    .replace('rồi tóm tắt">Check NOTAM</button>', 'rồi tóm tắt">NOTAM Tracking</button>')
    .replace('xuống D:\\Omni">Tự động tải</button>', 'xuống D:\\Omni">Auto Downloader</button>')
    .replace('(Selenium chạy nền)">Check ATC avi</button>', '(Selenium chạy nền)">ATC AviWeb Check</button>')
    .replace('theo sân bay">Giới hạn tàu và sân bay</button>', 'theo sân bay">Aircraft &amp; Airport Limits</button>')
    .replace('thời gian hiệu lực">Thiết lập file add</button>', 'thời gian hiệu lực">Notice Rules</button>')
    .replace('theo số chuyến">AFTN filling</button>', 'theo số chuyến">AFTN Filing</button>')
    .replace('bấm tab Dữ liệu so sánh để xác nhận', 'bấm tab Flight Supervisor để xác nhận')
    .replace('<input type="file" id="fileXls"', '<button type="button" class="btn act ico" id="btnAims" data-ico="⬇" title="Tải Crewlist trực tiếp từ AIMS (Daily Flight Schedule) bằng tài khoản AIMS đã lưu, rồi nạp vào So sánh">AIMS</button>\n          <input type="file" id="fileXls"')
    .replace('      </div>\n    </div>\n  </div>\n</div>\n\n<div class="modal" id="nmPinModal">', `      </div>
      <div class="accard" id="acAims">
        <div class="top"><b>AIMS</b><span class="use" id="acAimsSrc"></span></div>
        <p class="achint">Dùng cho nút AIMS trên thanh đầu trang: tự tải Crewlist (Daily Flight Schedule) thay cho tải tay. Mỗi người lưu tài khoản AIMS riêng.</p>
        <div class="acgrid">
          <div class="field"><label for="acAimsUser">AIMS User ID</label>
            <input type="text" id="acAimsUser" value="" autocomplete="off" spellcheck="false"></div>
          <div class="field"><label for="acAimsPass">Password</label>
            <input type="password" id="acAimsPass" placeholder="(giữ nguyên nếu để trống)"></div>
          <div class="field"><label for="acAimsBox">Email AIMS</label>
            <input type="email" id="acAimsBox" autocomplete="off" spellcheck="false" placeholder="ten@vietjetair.com" oninput="this.dataset.dirty=1"></div>
        </div>
        <div class="acfoot">
          <button class="btn primary small" id="acAimsSave">Lưu</button>
          <span class="acmsg" id="acAimsMsg"></span>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="modal" id="nmPinModal">`)
    .replace('if(kind === "outlook") body.mailbox = $("#acOutlookBox").value.trim();', 'if(kind === "outlook") body.mailbox = $("#acOutlookBox").value.trim();\n    if(kind === "aims") body.mailbox = $("#acAimsBox").value.trim();')
    .replace('if(kind === "outlook" && info.mailbox) $("#acOutlookBox").value = info.mailbox;', 'if(kind === "outlook" && info.mailbox) $("#acOutlookBox").value = info.mailbox;\n      if(kind === "aims" && info.mailbox) $("#acAimsBox").value = info.mailbox;')
    .replace('$("#acOpscoreSave").onclick = () => acSave("opscore", "Opscore");', '$("#acOpscoreSave").onclick = () => acSave("opscore", "Opscore");\n$("#acAimsSave").onclick = () => acSave("aims", "Aims");')
    .replace('Aviweb:"aviweb",Opscore:"opscore"}[pf] || "";', 'Aviweb:"aviweb",Opscore:"opscore",Aims:"aims"}[pf] || "";')
    .replace('</body>', () => `<style>
.aims-pop{position:fixed;z-index:5000;width:340px;background:var(--x-card,#fff);color:var(--x-ink,#222);border:1px solid var(--x-line,#ddd);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.25);padding:14px;font:14px/1.45 system-ui}
.aims-pop[hidden]{display:none}
.aims-hd{display:flex;justify-content:space-between;align-items:center;font-size:16px;margin-bottom:6px}
.aims-x{border:0;background:none;cursor:pointer;font-size:15px;color:inherit}
.aims-hint{margin:0 0 10px;font-size:12.5px;opacity:.8}
.aims-row{display:flex;gap:10px;margin-bottom:10px}.aims-row label{flex:1;font-weight:600;font-size:13px}
.aims-row input{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:7px 8px;border:1px solid var(--x-line,#ccc);border-radius:7px;font:14px system-ui;background:transparent;color:inherit}
.aims-go{width:100%;padding:9px;border:0;border-radius:8px;background:var(--pp-red,#E31937);color:#fff;font-weight:800;font-size:14px;cursor:pointer}
.aims-go:disabled{opacity:.6;cursor:wait}
.aims-msg{min-height:18px;margin-top:8px;font-size:13px;font-weight:600;color:#15803d}.aims-msg.bad{color:#c62828}
.aims-pop{max-height:calc(100vh - 140px);overflow:auto}
.aims-watch{margin-top:12px;padding-top:10px;border-top:1px solid var(--x-line,#ddd)}
.aims-wrow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.aims-sw{display:flex;align-items:center;gap:6px;font-weight:800;font-size:14px;cursor:pointer}.aims-sw input{width:17px;height:17px;accent-color:var(--pp-red,#E31937)}
.aims-ev{font-size:13px;font-weight:600;white-space:nowrap;display:flex;align-items:center;gap:4px}.aims-ev select{display:inline-block !important;width:auto !important;margin:0 !important;padding:3px 4px;border:1px solid var(--x-line,#ccc);border-radius:6px;font:13px system-ui;background:transparent;color:inherit}
.aims-wst{font-size:12.5px;font-weight:600;color:#15803d;margin:4px 0}.aims-wst.bad{color:#c62828}
.aims-lh{display:flex;justify-content:space-between;align-items:center;margin:8px 0 4px;font-size:13.5px}
.aims-clr{border:1px solid var(--x-line,#ccc);background:transparent;color:inherit;border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer}
.aims-le{border:1px solid var(--x-line,#e2e2e2);border-radius:9px;padding:6px 8px;margin-bottom:6px}
.aims-lt{font-size:12px;font-weight:700;opacity:.7;margin-bottom:3px}
.aims-li{padding:4px 0;border-top:1px dashed var(--x-line,#e5e5e5);font-size:13px}.aims-li:first-of-type{border-top:0}
.aims-d{opacity:.7;font-size:12px}.aims-tx{font-size:12.5px;margin-top:2px}
.aims-k{display:inline-block;margin-right:5px;padding:1px 6px;border-radius:999px;font:800 10.5px/1.5 system-ui;color:#fff;background:#64748b}
.aims-k.reg{background:#c62828}.aims-k.crew{background:#7c3aed}.aims-k.time{background:#d97706}.aims-k.add{background:#16a34a}.aims-k.rem{background:#475569}
.aims-bell{position:absolute;top:-7px;right:-7px;font-size:13px;line-height:1;filter:grayscale(1);opacity:.75;pointer-events:none;z-index:2}
.aims-bell.on{filter:none;opacity:1}
.aims-cnt{position:absolute;top:-6px;right:-10px;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:999px;background:#dc2626;color:#fff;-webkit-text-fill-color:#fff;font:800 10px/16px system-ui;font-style:normal;text-align:center;box-shadow:0 0 0 2px #fff}
.aims-bell.ring{animation:aimsRing 1s ease-in-out 3}
@keyframes aimsRing{0%,100%{transform:rotate(0)}15%{transform:rotate(18deg)}30%{transform:rotate(-16deg)}45%{transform:rotate(12deg)}60%{transform:rotate(-8deg)}75%{transform:rotate(4deg)}}
header#mdRoom .filt-actions #btnAims{overflow:visible !important}
.aims-toast{position:fixed;right:18px;bottom:18px;z-index:6000;width:380px;max-width:calc(100vw - 36px);background:var(--x-card,#fff);color:var(--x-ink,#222);border:2px solid #dc2626;border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.3);padding:10px 12px;font:13px/1.45 system-ui;cursor:pointer;animation:aimsIn .25s ease-out}
.aims-toast[hidden]{display:none}
.aims-th{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:15px;color:#dc2626;margin-bottom:4px}
.aims-th button{border:0;background:none;cursor:pointer;font-size:15px;color:inherit}
.aims-ti{padding:3px 0;border-top:1px dashed var(--x-line,#e5e5e5)}
.aims-tf{margin-top:5px;font-weight:700;color:#15803d}
@keyframes aimsIn{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}
</style><script>${aimsCrewlistScript}</script></body>`)
    .replace('      sid_star_hit_names: n.sid_star_hit_names\n    }))', '      sid_star_hit_names: n.sid_star_hit_names,\n      sup_geoms: n.sup_geoms\n    }))')
    .replace('if(as && as.level === "NO IMPACT" && critIds.has(ident)){', 'if(as && as.level === "NO IMPACT" && critIds.has(ident) && !/Lịch D\\)|B–C ngoài cửa sổ|B–C không giao/.test((as.reasons || []).join(" "))){')
    .replace('    if(h.impact === "ref") continue;\n    if(h.kind === "FIR"', '    if(h.impact === "ref") continue;\n    if(!nmHitTimeOk(h)) continue;\n    if(h.kind === "FIR"')
    .replace('  const n = (place.notams || []).filter(x => nmMatchItem(x, q)).length;', '  const n = (place.notams_src || [...(place.notams || []), ...(place.dropped || [])]).filter(x => nmMatchItem(x, q)).length;')
    .replace('    nmPick = place.code;\n    nmShowDropped = false;', '    nmPick = place.code;\n    window.nmOvGroup = "";\n    nmShowDropped = false;')
    .replace('</body>', () => `<style>
.ma-ctl button{background:var(--x-card,#fff);color:var(--x-ink,#222);border:0;padding:6px 10px;font:700 12px/1.2 system-ui;cursor:pointer}
.ma-panel{position:fixed;right:18px;top:90px;z-index:4000;width:380px;max-height:80vh;overflow:auto;background:var(--x-card,#fff);color:var(--x-ink,#222);border:1px solid var(--x-line,#ccc);border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.25);padding:12px;font:13px/1.4 system-ui}
.ma-panel[hidden]{display:none}
.ma-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:15px}
.ma-hd button,.ma-rh button{border:0;background:none;cursor:pointer;font-size:14px;color:inherit}
.ma-panel label{display:block;margin:6px 0;font-weight:600}
.ma-panel input,.ma-panel textarea{display:block;width:100%;box-sizing:border-box;margin-top:3px;padding:6px 8px;border:1px solid var(--x-line,#ccc);border-radius:6px;font:12px/1.4 monospace;background:transparent;color:inherit}
.ma-panel textarea{height:110px;resize:vertical}
.ma-act{display:flex;gap:8px;margin:8px 0}
.ma-act button{flex:1;padding:7px;border-radius:6px;border:1px solid #d84315;background:#d84315;color:#fff;font-weight:700;cursor:pointer}
.ma-act .ma-clear{background:transparent;color:#d84315}
.ma-msg{min-height:16px;font-size:12px;color:#2e7d32}.ma-msg.bad{color:#c62828}
.ma-row{border-left:4px solid #999;padding:6px 8px;margin:6px 0;border-radius:6px;background:rgba(127,127,127,.08)}
.ma-rh{display:flex;gap:6px;align-items:center}.ma-rh span{flex:1;opacity:.75;font-size:12px}
.ma-v{margin-top:3px;font-weight:600}
.ma-cr{border-color:#c62828}.ma-cr .ma-v{color:#c62828}.ma-br{border-color:#f9a825}.ma-ok{border-color:#16a34a}.ma-ok .ma-v{color:#16a34a}.ma-mu{opacity:.7}
.nm-unid{cursor:pointer}
</style><script>window.__ma={parse:${maParse.toString()},band:${maBand.toString()},check:${maCheck.toString()}};</script><script>${manualAreaScript}</script></body>`)
    .replaceAll('btn.textContent = "Xuất briefing"', 'btn.textContent = "Tạo briefing + Add"')
    .replace('title="Soạn PDF Official Briefing cho các chuyến trong cột FLT NO (dùng bản đã Lưu nếu có), lưu vào folder briefing trên server">Xuất briefing</button>', 'title="Soạn PDF Official Briefing cho các chuyến trong cột FLT NO (dùng bản đã Lưu nếu có), rồi tự Add lên FliteBrief">Tạo briefing + Add</button>')
    .replace('$("#tlExportBrief").onclick = tlExportBrief;', '$("#tlExportBrief").onclick = async () => { const ex = await tlExportBrief(); if(ex && ex.ok && !ex.cancelled) await tlAddBriefFromFlt({noConfirm: true}); };')
    .replace('  if(ex.ok) await tlAddBriefFromFlt();\n  bfDupRemember([]);', '  if(ex.ok) await tlAddBriefFromFlt({noConfirm: true});\n  bfDupRemember([]);')
    .replace('if(!quiet && !confirm("Đính kèm " + d0.ready', 'if(!quiet && !opts.noConfirm && !confirm("Đính kèm " + d0.ready')
    .replace('    }, ids, {quiet: quiet});', '    }, ids, {quiet: quiet, noConfirm: !!opts.noConfirm});')
    // Xuất briefing theo lô nhỏ: mỗi lô một luồng ngắn để không bị đứt giữa chừng.
    .replace('  const go = async (callsigns, sectorIds) => {\n    const btn = $("#tlExportBrief");', `  const go = async (callsigns, sectorIds) => {
    const CH = 4, tot = {ok:0, failed:0, skipped:0, elapsed:0, folder:""};
    for(let i = 0; i < callsigns.length; i += CH){
      const part = callsigns.slice(i, i + CH);
      if(callsigns.length > CH) write("▶ lô " + (i/CH + 1) + "/" + Math.ceil(callsigns.length/CH) + ": " + part.join(", "), "sys");
      const r = await goOne(part, sectorIds);
      if(!r || r.cancelled) return {...tot, cancelled: !!(r && r.cancelled)};
      tot.ok += r.ok || 0; tot.failed += r.failed || 0; tot.skipped += r.skipped || 0;
      tot.elapsed += r.elapsed || 0; tot.folder = r.folder || tot.folder;
    }
    const b2 = $("#tlExportBrief"); if(b2){ b2.disabled = false; b2.textContent = "Tạo briefing + Add"; }
    return tot;
  };
  const goOne = async (callsigns, sectorIds) => {
    const btn = $("#tlExportBrief");`)
    .replace('          write("mất kết nối khi đang xuất briefing — các chuyến đã ✓ vẫn lưu trong kho; bấm Xuất briefing lại cho chuyến còn thiếu", "fail");\n          bxEs.close(); bxEs = null; bxJob = null;', '          write("mất kết nối ở lô này — các chuyến đã ✓ vẫn lưu trong kho; tiếp tục lô sau", "fail");\n          bxEs.close(); bxEs = null; bxJob = null;')
    .replace(/<div class="nm-tune-pop" id="nmTunePop" hidden>[\s\S]*?<\/ul>\n<\/div>/, () => "<div class=\"nm-tune-pop nmlg\" id=\"nmTunePop\" hidden>\n<style>\n.nmlg{font-size:13px;line-height:1.5}\n.nmlg .lg-h{font:800 15px/1.3 system-ui;margin:0 0 4px;color:#0f172a}\n.nmlg .lg-sub{margin:0 0 10px;color:#475569;font-size:12.5px}\n.nmlg .lg-t{font:800 11px/1 system-ui;letter-spacing:.08em;text-transform:uppercase;color:#E31937;margin:12px 0 6px}\n.nmlg .lg-grp{display:grid;gap:6px}\n.nmlg .lg-g{display:grid;grid-template-columns:118px 1fr;gap:8px;align-items:start;padding:7px 9px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0}\n.nmlg .lg-g b{display:inline-block;text-align:center;padding:3px 8px;border-radius:999px;color:#fff;font:800 11px/1.3 system-ui}\n.nmlg .c1 b{background:#dc2626}.nmlg .c2 b{background:#f59e0b}.nmlg .c3 b{background:#2563eb}.nmlg .c4 b{background:#64748b}\n.nmlg .lg-step{display:grid;grid-template-columns:26px 1fr;gap:8px;padding:6px 0;border-bottom:1px dashed #e2e8f0}\n.nmlg .lg-step:last-child{border-bottom:0}\n.nmlg .lg-n{width:24px;height:24px;border-radius:50%;background:#0f172a;color:#fff;font:800 12px/24px system-ui;text-align:center}\n.nmlg .lg-step strong{color:#0f172a}\n.nmlg table{width:100%;border-collapse:collapse;margin-top:4px;font-size:12px}\n.nmlg td,.nmlg th{padding:4px 6px;border-bottom:1px solid #eef2f7;text-align:left}\n.nmlg th{background:#f1f5f9;font-weight:800}\n.nmlg .lg-key{display:flex;flex-wrap:wrap;gap:6px}\n.nmlg .lg-key span{padding:3px 9px;border-radius:999px;font-weight:700;font-size:12px}\n.nmlg .k15{background:#dcfce7;color:#166534}.nmlg .k100{background:#fee2e2;color:#991b1b}.nmlg .k24{background:#dbeafe;color:#1e40af}\n</style>\n<p class=\"lg-h\">C\u00e1ch web l\u1ecdc NOTAM</p>\n<p class=\"lg-sub\">Kh\u00f4ng xo\u00e1 NOTAM n\u00e0o. M\u1ed7i NOTAM \u0111\u01b0\u1ee3c x\u1ebfp v\u00e0o <b>m\u1ed9t nh\u00f3m</b> v\u00e0 c\u00f3 ghi l\u00fd do.</p>\n<div class=\"lg-t\">Lu\u1eadt ch\u00ednh</div>\n<div class=\"lg-key\"><span class=\"k15\">C\u00e1ch route \u2264 15 NM</span><span class=\"k100\">FIR enroute: b\u1ecf v\u00f9ng d\u01b0\u1edbi FL100</span><span class=\"k24\">C\u00f2n hi\u1ec7u l\u1ef1c trong 24h</span></div>\n<div class=\"lg-t\">4 nh\u00f3m k\u1ebft qu\u1ea3</div>\n<div class=\"lg-grp\">\n<div class=\"lg-g c1\"><b>CRUCIAL</b><span>D\u00ednh chuy\u1ebfn. Nh\u00e3n <b style=\"background:#dc2626;padding:0 6px\">CRITICAL</b> l\u00e0 d\u00ednh ngay gi\u1edd bay, <b style=\"background:#f59e0b;padding:0 6px\">DELAY-ONLY</b> l\u00e0 ch\u1ec9 d\u00ednh khi chuy\u1ebfn tr\u1ec5.</span></div>\n<div class=\"lg-g c2\"><b>MANUAL CHECK</b><span>Ch\u01b0a \u0111\u1ee7 d\u1eef li\u1ec7u \u0111\u1ec3 k\u1ebft lu\u1eadn, c\u1ea7n \u0111\u1ecdc tay. V\u00ed d\u1ee5: thi\u1ebfu B/C/E, v\u00f9ng kh\u00f4ng c\u00f3 ranh gi\u1edbi, l\u1ecbch D kh\u00f3 hi\u1ec3u.</span></div>\n<div class=\"lg-g c3\"><b>BRIEFING INFO</b><span>C\u00f3 li\u00ean quan nh\u01b0ng ch\u1ec9 \u0111\u1ec3 bi\u1ebft: taxiway/stand \u0111\u00f3ng, chim, WIP, \u0111\u00e8n, UAV ho\u1eb7c ch\u01b0\u1edbng ng\u1ea1i kh\u00f4ng c\u1ea5m bay.</span></div>\n<div class=\"lg-g c4\"><b>MINOR</b><span>Ch\u1eafc ch\u1eafn kh\u00f4ng \u1ea3nh h\u01b0\u1edfng. M\u1eb7c \u0111\u1ecbnh \u0111\u01b0\u1ee3c \u1ea9n, v\u1eabn m\u1edf ra xem l\u00fd do \u0111\u01b0\u1ee3c.</span></div>\n</div>\n<div class=\"lg-t\">C\u00e1c b\u01b0\u1edbc ki\u1ec3m tra (d\u1eebng ngay khi c\u00f3 k\u1ebft lu\u1eadn)</div>\n<div class=\"lg-step\"><span class=\"lg-n\">1</span><div><strong>\u0110\u1ecdc NOTAM</strong>: thi\u1ebfu m\u1ee5c B, C ho\u1eb7c E th\u00ec x\u1ebfp v\u00e0o MANUAL CHECK.</div></div>\n<div class=\"lg-step\"><span class=\"lg-n\">2</span><div><strong>Gi\u1edd hi\u1ec7u l\u1ef1c</strong>: so v\u1edbi gi\u1edd chuy\u1ebfn t\u1ea1i t\u1eebng s\u00e2n v\u00e0 FIR, t\u00ednh th\u00eam th\u1eddi gian tr\u1ec5 t\u1ed1i \u0111a 180 ph\u00fat.\n<table><tr><th>N\u01a1i</th><th>Khung gi\u1edd</th></tr>\n<tr><td>S\u00e2n \u0111i</td><td>ETD \u221260 / +60\u2032</td></tr><tr><td>S\u00e2n \u0111\u1ebfn</td><td>ETA \u221260 / +60\u2032</td></tr>\n<tr><td>D\u1ef1 b\u1ecb c\u1ea5t c\u00e1nh</td><td>ETD \u221215 / +60\u2032</td></tr><tr><td>D\u1ef1 b\u1ecb \u0111\u01b0\u1eddng bay</td><td>ETD \u2192 ETA +60\u2032</td></tr>\n<tr><td>D\u1ef1 b\u1ecb s\u00e2n \u0111\u1ebfn</td><td>ETA \u221260 / +60\u2032</td></tr><tr><td>FIR</td><td>L\u00fac v\u00e0o \u221260\u2032 / l\u00fac ra +60\u2032</td></tr></table>\nC\u00f3 th\u1ec3 ch\u1ec9nh \u1edf n\u00fat <b>\u2699 Filter setting</b>.</div></div>\n<div class=\"lg-step\"><span class=\"lg-n\">3</span><div><strong>L\u1ecbch m\u1ee5c D</strong>: x\u00e9t t\u1eebng ph\u00fat c\u1ee7a chuy\u1ebfn (DAILY, th\u1ee9, ng\u00e0y, EXC, SR/SS, HJ/HN). Kh\u00f4ng ph\u00fat n\u00e0o tr\u00f9ng th\u00ec x\u1ebfp v\u00e0o MINOR.</div></div>\n<div class=\"lg-step\"><span class=\"lg-n\">4</span><div><strong>V\u1ecb tr\u00ed</strong>: v\u00f9ng NOTAM c\u00e1ch route trong <b>15 NM</b>, ho\u1eb7c nh\u1eafc \u0111\u00fang SID/STAR, \u0111\u01b0\u1eddng bay ATS ho\u1eb7c \u0111\u00e0i tr\u00ean FPL. RFFS so theo CAT t\u00e0u (A321/A21N c\u1ea7n CAT 7, A333 c\u1ea7n CAT 9).</div></div>\n<div class=\"lg-step\"><span class=\"lg-n\">5</span><div><strong>\u0110\u1ed9 cao</strong>: FL c\u1ee7a chuy\u1ebfn t\u1ea1i \u0111i\u1ec3m giao ph\u1ea3i n\u1eb1m trong d\u1ea3i \u0111\u1ed9 cao c\u1ee7a NOTAM.<br>\u2022 <b>FIR \u0111i v\u00e0 FIR \u0111\u1ebfn</b>: t\u00ednh c\u1ea3 NOTAM d\u01b0\u1edbi FL100.<br>\u2022 <b>FIR enroute</b>: NOTAM c\u00f3 tr\u1ea7n d\u01b0\u1edbi FL100 x\u1ebfp v\u00e0o MINOR.<br>\u2022 Ch\u01b0\u1edbng ng\u1ea1i l\u1ea5y \u0111\u1ed9 cao \u0111\u1ec9nh (ft AMSL).</div></div>\n<div class=\"lg-step\"><span class=\"lg-n\">6</span><div><strong>M\u1ee9c \u0111\u1ed9</strong>: th\u1eed d\u1eddi gi\u1edd bay t\u1eeb 0 \u0111\u1ebfn 180 ph\u00fat. D\u00ednh ngay ph\u00fat 0 l\u00e0 CRITICAL, ch\u1ec9 d\u00ednh khi tr\u1ec5 l\u00e0 DELAY-ONLY.</div></div>\n<div class=\"lg-t\">Sau khi l\u1ecdc</div>\n<div class=\"lg-step\"><span class=\"lg-n\">\u2713</span><div>So v\u1edbi <b>Briefing pack</b> \u1edf nh\u1eefng s\u00e2n v\u00e0 FIR c\u1ea3 hai b\u00ean \u0111\u1ec1u c\u00f3. \u0110\u1ebfn <b>1 gi\u1edd tr\u01b0\u1edbc gi\u1edd bay</b>, web t\u1ef1 qu\u00e9t l\u1ea1i v\u00e0 b\u00e1o n\u1ebfu c\u00f3 NOTAM m\u1edbi.</div></div>\n</div>\n")
    .replace('const NM_ASSESS_DEF = {corridor_nm:5,', 'const NM_ASSESS_DEF = {corridor_nm:15,')
    .replace('    else body.textContent = n.text || n.e_field || "";\n    item.appendChild(body);', `    else body.textContent = n.text || n.e_field || "";
    try{ nmHlKeys(body); }catch(_e){}
    item.appendChild(body);`)
    .replace('</body>', `<style>.nm-kw{font-weight:800;padding:0 3px;border-radius:4px}.nm-kw.r{background:#fee2e2;color:#b91c1c}.nm-kw.o{background:#ffedd5;color:#c2410c}.nm-kw.b{background:#dbeafe;color:#1d4ed8}</style><script>
function nmHlKeys(root){
  var RED=/^(CLSD|CLOSED|U\\/S|UNSERVICEABLE|NOT AVBL|NOT AVAILABLE|UNAVBL|PROHIBITED|PROHIBITED AREA|SUSPENDED|OUT OF SERVICE|NOT USABLE|DANGER|MISSILE|FIRING|ROCKET|GUN FIRING)$/i;
  var ORG=/^(WIP|WORK IN PROGRESS|OBST|OBSTACLE|CRANE|RESTRICTED|LIMITED|REDUCED|DEGRADED|CAUTION|BIRD|ACT|ACTIVE|UNMANNED|UAS|DRONE|LGT|LIGHTING)$/i;
  var re=/\\b(CLSD|CLOSED|U\\/S|UNSERVICEABLE|NOT AVBL|NOT AVAILABLE|UNAVBL|PROHIBITED|SUSPENDED|OUT OF SERVICE|NOT USABLE|DANGER|MISSILE|ROCKET|GUN FIRING|FIRING|WIP|WORK IN PROGRESS|OBST|OBSTACLE|CRANE|RESTRICTED|LIMITED|REDUCED|DEGRADED|CAUTION|BIRD|UNMANNED|UAS|DRONE|RWY\\s?\\d{2}[LRC]?(?:\\/\\d{2}[LRC]?)?|TWY\\s?[A-Z]\\d?|ILS|VOR|DME|NDB|GP|LOC|PAPI|FL\\s?\\d{2,3})\\b/gi;
  var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null),list=[],t;
  while((t=w.nextNode())){ if(t.parentNode&&t.parentNode.closest&&t.parentNode.closest(".nm-kw"))continue; list.push(t); }
  list.forEach(function(tn){
    var s=tn.nodeValue; re.lastIndex=0; if(!re.test(s))return; re.lastIndex=0;
    var f=document.createDocumentFragment(),last=0,m;
    while((m=re.exec(s))){
      if(m.index>last)f.appendChild(document.createTextNode(s.slice(last,m.index)));
      var k=m[0],sp=document.createElement("span");
      sp.className="nm-kw "+(RED.test(k)?"r":ORG.test(k)?"o":"b");
      sp.textContent=k; f.appendChild(sp); last=m.index+k.length;
    }
    if(last<s.length)f.appendChild(document.createTextNode(s.slice(last)));
    tn.parentNode.replaceChild(f,tn);
  });
}</script></body>`)
    .replace('const nmGrpName = {impact:"IMPACT", manual:"MANUAL CHECK", brief:"BRIEFING INFO", noimpact:"NO IMPACT"};', 'const nmGrpName = {impact:"CRUCIAL", manual:"MANUAL CHECK", brief:"BRIEFING INFO", noimpact:"MINOR"};')
    .replace('      tag.textContent = n.level + (n.level === "DELAY-ONLY"', '      tag.textContent = (n.level === "NO IMPACT" ? "MINOR" : n.level) + (n.level === "DELAY-ONLY"')
    .replace('BRIEFING INFO, NO IMPACT. Không xoá NOTAM nào; NO IMPACT nằm', 'BRIEFING INFO, MINOR. Không xoá NOTAM nào; MINOR nằm')
    .replace('(kể cả khi trễ tối đa) sẽ là NO IMPACT.', '(kể cả khi trễ tối đa) sẽ là MINOR.')
    .replace('<li><b>NO IMPACT</b> — chứng minh', '<li><b>MINOR</b> — chứng minh')
    .replace('Không phút nào bật → NO IMPACT.', 'Không phút nào bật → MINOR.')
    .replaceAll('if(nmLayerCtl) nmLayerCtl.addOverlay(nmAtsGroups[cc], nmAtsLabel(cc));', '')
    .replace('{"Sân bay": nmAdGroup, "Đài": nmNavGroup},', '{"Sân bay": nmAdGroup},')
    .replace('  $("#ftAtcMiss").textContent = (d.missed || []).join(" · ");', '  $("#ftAtcMiss").textContent = (d.missed || []).join(" · ");\n  $("#ftAtcMiss").style.cssText = /KHÔNG có giờ AviWeb/.test($("#ftAtcMiss").textContent) ? "color:#d10000;font-weight:800;font-size:14px" : "";')
    // Compare: NGÀY GIỜ -> NGÀY GIỜ CFP, plus a Crewlist STD/ETD column (ETD green).
    .replace('  ["NGÀY GIỜ", "Dòng trên:', '  ["NGÀY GIỜ CFP", "Dòng trên:')
    .replace('  ["CREW", "So theo mã nhân viên.', '  ["STD/ETD", "Giờ local theo Crewlist. Chỉ có STD thì hiện STD; có ETD mới thì hiện cả STD và ETD, ETD màu xanh lá."],\n  ["TAF", "Như bảng Hiển thị chung: TAF sân đáp trong ETA ±1 giờ."],\n  ["EXTRA", "Extra fuel OFP: giờ:phút · kg."],\n  ["CREW", "So theo mã nhân viên.')
    .replace('    tr.appendChild(timeCell(r));\n', `    tr.appendChild(timeCell(r));
    { const sx = document.createElement("td");
      if(r.crew_etd && r.crew_std && r.crew_etd !== r.crew_std){
        const s0 = document.createElement("span");
        s0.className = "v n"; s0.textContent = r.crew_std;
        s0.style.cssText = "text-decoration:line-through;opacity:.75";
        const ar = document.createElement("span");
        ar.textContent = " → "; ar.style.cssText = "opacity:.6";
        const v = document.createElement("span");
        v.className = "v"; v.style.cssText = "color:#16a34a;font-weight:700"; v.textContent = r.crew_etd;
        sx.title = "ETD mới (Crewlist)\\nSTD: " + r.crew_std;
        sx.appendChild(s0); sx.appendChild(ar); sx.appendChild(v);
      } else {
        const v = document.createElement("span");
        v.className = "v n"; v.textContent = r.crew_etd || r.crew_std || "—";
        if(r.crew_std || r.crew_etd) sx.title = (r.crew_etd ? "ETD" : "STD") + " (Crewlist)";
        sx.appendChild(v);
      }
      tr.appendChild(sx); }
    { const fx = (typeof cmpActionFlight === "function" && cmpActionFlight(r)) || null;
      const tt = document.createElement("td"); tt.className = "taf-cell";
      const xt = document.createElement("td"); xt.className = "num extra-cell";
      if(fx){ try{ paintTafWx(tt, fx); }catch(_){ tt.textContent = "—"; } try{ paintExtra(xt, fx); }catch(_){ xt.textContent = "—"; } }
      else { tt.textContent = "—"; xt.textContent = "—"; }
      tr.appendChild(tt); tr.appendChild(xt); }
`)
    // General-table weather belongs to the whole cell, not just its small icon.
    // Read current flight data on entry and distinguish missing TAF from good WX.
    .replace(`  if(!segs && !raw && !t.tip) return;
  s.onmouseenter = ev => showTafTip(ev, "", segs, raw);
  s.onmousemove = moveTafTip;
  s.onmouseleave = hideTafTip;`, `  td.onmouseenter = ev => {
    const wx = f.taf_wx || {};
    const parts = Array.isArray(wx.segments) ? wx.segments : [];
    const text = wx.raw || wx.snippet || wx.tip || wx.why || wx.label || "Chưa có dữ liệu TAF cho sân đáp; bấm TAF để cập nhật.";
    const destination = f.dest_icao || f.arr_icao || f.dest || f.arr || String(f.route || "").split(/[-/ ]+/).pop();
    showTafTip(ev, [f.callsign, destination, "TAF sân đáp"].filter(Boolean).join(" · "), parts, text);
  };
  td.onmousemove = moveTafTip;
  td.onmouseleave = hideTafTip;`)
    .replace('  if(!t || !t.closest) return;\n  if(_tipHost', '  if(!t || !t.closest) return;\n  if(t.closest("#wrapGeneral td.taf-cell")) return;\n  if(_tipHost')
    .replace('  if(_tipHost && _tipHost.contains(t)) return;', '  if(t.closest("td[data-ctip],.cmp-tip")){ tipRelease(); return; }\n  if(_tipHost && _tipHost.contains(t)) return;')
    // V 6.12: Compare FILE CHECK = Notice add + PIB/WX in one battery (last column, keeps nth-child rules).
    .replace('    if(tip) th.title = tip;\n    head.appendChild(th);\n  }\n', '    if(tip) th.title = tip;\n    head.appendChild(th);\n  }\n  { const th = document.createElement("th"); th.textContent = "FILE CHECK"; th.title = "Gộp file Notice add + PIB/WX. Đỏ = thiếu; nháy = sai tàu hoặc còn ≤1h tới STD mà thiếu."; const ra = [...head.children].find(x => x.textContent === "REG AIMS"); if(ra) ra.after(th); else head.appendChild(th); }\n')
    .replace('    tr.append(messageCell, briefCell, verifyCell);', '    tr.append(messageCell, briefCell, verifyCell);\n    { const fcc = cmpFileCheckCell(actionFlight); const lim = tr.querySelector("td.cmp-lim-cell"); if(lim) tr.insertBefore(fcc, lim); else tr.appendChild(fcc); }')
    .replace('function renderCompareTable(d, opts){', FILE_CHECK_FN + 'function renderCompareTable(d, opts){')
    .replace('</head>', FILE_CHECK_CSS + '</head>')
    ;
  cached = patchDefectSourcePage(patchNotamChangePopupPage(patchCmpCrewHoverPage(patchKhbAirportHoverPage(cached))))
    // Compare re-run button label: "Reload" (runs last so earlier patches still find "Cmp").
    .replace('data-talk="so lại FliteBrief / OFP.">Cmp</button>', 'data-talk="so lại FliteBrief / OFP.">Reload</button>')
    // V 6.13: Check OFP results open in a floating modal; the general tab is hidden.
    .replace('</body>', () => `<script>${ofpCheckModalScript}</script></body>`)
    .replaceAll('btn.textContent = "Cmp";', 'btn.textContent = "Reload";');
  return cached;
}

export const Route = createFileRoute("/tool-page")({
  server: {
    handlers: {
      GET: async () =>
        new Response(await page(), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "CDN-Cache-Control": "no-store",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Frame-Options": "SAMEORIGIN",
          },
        }),
    },
  },
});
