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
        window.__efbAutoFill=function(){
          if(efbInput.value) return;
          fetch('/api/efb/latest?pc=1').then(function(r){return r.json();}).then(function(d){
            if(d && d.value && !efbInput.value){
              efbInput.value=d.value;
              try{ localStorage.setItem('fb_efb', d.value); }catch(e){}
            }
          }).catch(function(){});
        };
        // Tự lấy mã EFB mới nhất khi ô còn trống — CHỈ thử từ máy chủ,
        // không bật Outlook trên máy công ty (tránh popup đăng nhập).
        if(!efbInput.value){
          fetch('/api/efb/latest').then(function(r){return r.json();}).then(function(d){
            if(d && d.value && !efbInput.value){
              efbInput.value=d.value;
              try{ localStorage.setItem('fb_efb', d.value); }catch(e){}
            }
          }).catch(function(){});
        }
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
        board.title='Tải gói trợ lý PC về máy — giải nén rồi chạy cai-tro-ly.bat';
        board.addEventListener('click',function(e){
          e.preventDefault(); e.stopPropagation();
          var a=document.createElement('a'); a.href='/agent/tro-ly-pc.zip'; a.download='tro-ly-pc.zip';
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
        setInterval(hoGuardBlanks,1500);
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
      acTokens.textContent=':root{'+acDeclarations.join(';')+'}';
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
      setInterval(acMarkRows,750);
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
      acctMenu.innerHTML='<div class="ops-acct-who"><small>Đang đăng nhập</small><strong id="opsAcctMail">…</strong></div><button type="button" class="ops-acct-out" id="opsAcctEdit" style="margin-bottom:6px;background:#fff;color:#E31937;border:1px solid #E31937">Tài khoản / mật khẩu / ảnh đại diện</button><button type="button" class="ops-acct-out" id="opsSignOut">Đăng xuất</button>';
      room.appendChild(acctMenu);
      var acctBtn=document.getElementById('opsAccountBtn'),acctMail=document.getElementById('opsAcctMail'),acctAvatar=document.getElementById('opsAvatar'),acctOut=document.getElementById('opsSignOut');
      var setAcctMail=function(mail,avatarUrl,displayName){ if(!acctMail||!mail)return; acctMail.textContent=displayName?displayName+' · '+mail:mail; if(acctAvatar){var nm=String(displayName||mail).split('@')[0].replace(/[^a-z0-9]/gi,''); acctAvatar.textContent=nm.slice(0,2).toUpperCase()||'••'; if(avatarUrl){var img=document.createElement('img');img.src=avatarUrl;img.alt='Ảnh đại diện';img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:50%';img.onerror=function(){acctAvatar.textContent=nm.slice(0,2).toUpperCase()||'••';};acctAvatar.replaceChildren(img);} } };
      var setAcctOpen=function(on){ if(!acctMenu||!acctBtn)return; acctMenu.hidden=!on; acctBtn.setAttribute('aria-expanded',on?'true':'false'); };
      if(acctBtn)acctBtn.addEventListener('click',function(e){ e.stopPropagation(); setAcctOpen(acctMenu.hidden); });
      if(acctMenu)acctMenu.addEventListener('click',function(e){ e.stopPropagation(); });
      document.addEventListener('click',function(){ setAcctOpen(false); });
      var acctEd=document.getElementById('opsAcctEdit'); if(acctEd)acctEd.addEventListener('click',function(){ setAcctOpen(false); try{ window.parent.postMessage({type:'sohee-account-edit'},window.location.origin); }catch(e){} });
      var aftnTab=document.getElementById('mAftn');
      if(aftnTab&&!document.getElementById('opsAcctManage')){ var acctMg=document.createElement('button'); acctMg.type='button'; acctMg.className='mode'; acctMg.id='opsAcctManage'; acctMg.hidden=true; acctMg.title='Chỉ hyphan thấy mục này'; acctMg.textContent='Quản lí tài khoản'; aftnTab.insertAdjacentElement('afterend',acctMg); acctMg.addEventListener('click',function(e){ e.preventDefault(); e.stopImmediatePropagation(); try{ window.parent.postMessage({type:'sohee-accounts-manage'},window.location.origin); }catch(err){} },true); }
      if(acctOut)acctOut.addEventListener('click',function(){ try{ window.parent.postMessage({type:'sohee-signout'},window.location.origin); }catch(e){} });
      window.addEventListener('message',function(ev){ if(ev.origin!==window.location.origin||ev.source!==window.parent)return; var d=ev.data||{}; if(d.type==='sohee-account'){setAcctMail(d.email,d.avatarUrl,d.displayName); var mg=document.getElementById('opsAcctManage'); if(mg)mg.hidden=!d.canManage;} });
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
.aside-head::before{content:"CHỨC NĂNG";display:block;font:800 11.5px var(--x-sans);letter-spacing:.2em;color:#788494;padding:2px 12px 13px}
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
.aside-head .modes .mode#mTool::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14.7 6.3a4.5 4.5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a4.5 4.5 0 0 0 6.4-6.4L16 11l-3-3 1.7-1.7z'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14.7 6.3a4.5 4.5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a4.5 4.5 0 0 0 6.4-6.4L16 11l-3-3 1.7-1.7z'/%3E%3C/svg%3E");background:#F97316}
.aside-head .modes .mode#mNotam::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Cpath d='M7 3h7l5 5v13H7z'/%3E%3Cpath d='M14 3v5h5M9 13h6M9 17h4'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2'%3E%3Cpath d='M7 3h7l5 5v13H7z'/%3E%3Cpath d='M14 3v5h5M9 13h6M9 17h4'/%3E%3C/svg%3E");background:#EAB308}
.aside-head .modes .mode#mVer::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linejoin='round'%3E%3Cpath d='M12 2 3 7l9 5 9-5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linejoin='round'%3E%3Cpath d='M12 2 3 7l9 5 9-5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5'/%3E%3C/svg%3E");background:#10B981}
/* Tự động tải: mũi tên rơi vào khay. */
.aside-head .modes .mode#mFpl::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3v11'/%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3Cpath d='M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3v11'/%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3Cpath d='M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'/%3E%3C/svg%3E");background:#0284C7}
.aside-head .modes .mode#mAtcCheck::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v.01'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12v.01'/%3E%3C/svg%3E");background:#BE123C}
/* Giới hạn tàu: bóng máy bay chếch lên. */
.aside-head .modes .mode#mLimits::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='black'%3E%3Cpath d='M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z'/%3E%3C/svg%3E");background:#7C3AED}
.aside-head .modes .mode#mNoticeRules::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='4'/%3E%3Cpath d='M12 8v8M8 12h8'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='4'/%3E%3Cpath d='M12 8v8M8 12h8'/%3E%3C/svg%3E");background:#EC4899}
.aside-head .modes .mode#mAftn::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='2' y='4' width='20' height='16' rx='2.5'/%3E%3Cpath d='m6 9 4 4-4 4'/%3E%3Cpath d='M13 17h5'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='2' y='4' width='20' height='16' rx='2.5'/%3E%3Cpath d='m6 9 4 4-4 4'/%3E%3Cpath d='M13 17h5'/%3E%3C/svg%3E");background:#3B82F6}
/* Quản lí tài khoản: một người kèm bánh răng phía sau. */
.aside-head .modes .mode#opsAcctManage::before{-webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='9' cy='7' r='4'/%3E%3Cpath d='M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2'/%3E%3Ccircle cx='18' cy='16' r='2.5'/%3E%3Cpath d='M18 11.5V10M18 22v-1.5M22.5 16H21M15 16h-1.5M21.2 12.8l-1 1M15.8 19.2l-1 1M21.2 19.2l-1-1M15.8 12.8l1 1'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='9' cy='7' r='4'/%3E%3Cpath d='M2 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2'/%3E%3Ccircle cx='18' cy='16' r='2.5'/%3E%3Cpath d='M18 11.5V10M18 22v-1.5M22.5 16H21M15 16h-1.5M21.2 12.8l-1 1M15.8 19.2l-1 1M21.2 19.2l-1-1M15.8 12.8l1 1'/%3E%3C/svg%3E");background:#475569}

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
.aside-head .modes .mode-bang#verBang.flash{background:#DC2626 !important}

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
  min-height:229px !important;height:229px !important;padding:0 !important;box-sizing:border-box !important;
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
.ops-header-brand{display:block !important;position:absolute;left:1.25%;top:22px;width:12.4%;height:182px;z-index:16;color:#fff;text-transform:uppercase}
.ops-vj-mark{display:flex;align-items:center;gap:9px}.ops-vj-mark .ops-vj-logo{display:block;width:138px;height:41px;background:var(--vj-logo) center/contain no-repeat;filter:brightness(0) invert(1)}.ops-vj-mark>span:last-child{font:800 11px/1.2 var(--x-sans);color:#fff;letter-spacing:.06em}
.ops-sohee{display:flex;align-items:baseline;gap:8px;margin-top:22px;padding-top:12px;border-top:2px solid var(--x-yel);text-transform:none;white-space:nowrap}
.ops-sohee strong{color:#fff;font:900 26px/1 var(--x-sans);letter-spacing:.02em;text-shadow:0 1px 6px rgba(15,23,42,.45)}
.ops-sohee span{color:rgba(255,255,255,.94);font:600 14px/1 var(--x-sans);letter-spacing:.04em;text-shadow:0 1px 5px rgba(15,23,42,.4)}
.ops-header-live{position:absolute;right:0;top:0;height:78px;display:flex;align-items:center;gap:0;z-index:24;color:#fff;padding:0 17px 0 21px;border:0;border-radius:0 0 0 18px;background:linear-gradient(90deg,rgba(20,30,40,.68),rgba(12,22,32,.84));box-shadow:-10px 10px 28px rgba(20,36,52,.18);backdrop-filter:blur(10px) saturate(1.16)}
.ops-weather{height:56px;display:grid;grid-template-columns:36px auto auto;align-items:center;gap:9px;padding-right:20px;border-right:1px solid rgba(255,255,255,.5)}.ops-weather-icon{font-size:30px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.25))}.ops-weather>strong{font:800 22px/1 var(--x-sans);color:#fff}.ops-weather>span:last-child{display:flex;flex-direction:column;gap:6px}.ops-weather b,.ops-weather small{font:900 12px/1.05 var(--x-sans);letter-spacing:.02em;color:#fff}.ops-weather small{font-weight:600;font-size:11px;color:rgba(255,255,255,.85);text-transform:none}
.ops-clock-wrap{height:56px;display:flex;align-items:center;gap:10px;padding:0 20px;border-right:1px solid rgba(255,255,255,.5)}.ops-clock-icon{display:grid;place-items:center;width:28px;height:28px;color:#fff}.ops-clock-icon svg{width:100%;height:100%}.ops-clock{display:flex;flex-direction:column;align-items:center;min-width:96px}.ops-clock strong{font:800 22px/1 var(--x-mono);color:#fff}.ops-clock span{margin-top:6px;font:800 12px/1 var(--x-sans);letter-spacing:.02em;color:#fff}
.ops-account{display:flex;align-items:center;gap:11px;padding-left:20px}.ops-avatar{width:36px;height:36px;display:grid;place-items:center;border:2px solid #fff;border-radius:50%;background:var(--x-red);box-shadow:0 3px 10px rgba(0,0,0,.3);color:#fff;font:800 11px var(--x-sans)}.ops-account-chevron{width:8px;height:8px;border-right:2px solid rgba(255,255,255,.9);border-bottom:2px solid rgba(255,255,255,.9);transform:rotate(45deg) translateY(-2px)}
.ops-account-btn{display:flex;align-items:center;gap:11px;margin:0;padding:0;border:0;background:none;cursor:pointer;font:inherit}.ops-acct-menu{position:absolute;right:17px;top:70px;min-width:246px;z-index:90;display:flex;flex-direction:column;padding:10px;border:1px solid rgba(255,255,255,.28);border-radius:14px;background:linear-gradient(180deg,#16222e,#0d1722);box-shadow:0 18px 42px rgba(10,18,28,.45)}.ops-acct-menu[hidden]{display:none}.ops-acct-who{display:flex;flex-direction:column;gap:5px;padding:2px 4px 10px;border-bottom:1px solid rgba(255,255,255,.18)}.ops-acct-who small{font:700 10px/1 var(--x-sans);letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.7)}.ops-acct-who strong{font:700 13px/1.2 var(--x-mono);color:#fff;word-break:break-all}.ops-acct-out{margin-top:10px;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;border:0;border-radius:10px;background:var(--x-red);color:#fff;font:800 13px var(--x-sans);letter-spacing:.02em;cursor:pointer}.ops-acct-out:hover{filter:brightness(1.1)}
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
  position:absolute !important;top:60.66% !important;right:.68% !important;bottom:auto !important;left:auto !important;
  display:grid !important;grid-template-columns:repeat(4,1fr) !important;gap:7px !important;align-items:stretch !important;
  width:16.6% !important;height:28.2% !important;flex:none !important;padding:7px !important;border:1px solid rgba(255,255,255,.76) !important;border-radius:14px !important;margin:0 !important;z-index:20 !important;background:rgba(244,247,249,.88) !important;box-shadow:0 10px 24px rgba(20,36,52,.22),inset 0 1px 0 rgba(255,255,255,.9) !important;backdrop-filter:blur(14px) saturate(1.15) !important;
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
  position:absolute !important;top:39.34% !important;width:3.7% !important;height:21.64% !important;min-width:0 !important;
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
.aside-head{top:237px !important}
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
.aside-head .mode,.modes .mode{font-size:15.5px !important;line-height:1.4 !important;font-weight:650 !important}
.aside-head .mode#mFplText,.modes .mode#mFplText{font-size:14px !important}
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
    try{ z=parseFloat(getComputedStyle(document.documentElement).zoom)||1; }catch(e){}
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




async function page(): Promise<string> {
  if (cached) return cached;
  const raw = (await import("@/tool/page.html?raw")).default as string;
  cached = raw
    // The embedded source stays intact; account fixes belong in this shim.
    .replace('>V 2.5</span>', '>V 2.45</span>')
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
    // Shared pilot formatting for KHB load/pick/edit/export; source names remain intact.
    .replace('function ftCrewLabel(person){', khbPilotNameScript.replace('export function', 'function') + '\nfunction ftCrewLabel(person){')
    .replace('if(person && person.label) return String(person.label);', 'if(person && person.label) return limitKhbPilotName(person.label);')
    .replace('return ((person && person.id) ? person.id + " " : "") + ((person && person.name) || "");', 'return limitKhbPilotName(((person && person.id) ? person.id + " " : "") + ((person && person.name) || ""));')
    .replace('st.cptText = cpt ? ftCrewLabel(cpt).trim() : (f.cpt || "");', 'st.cptText = limitKhbPilotName(cpt ? ftCrewLabel(cpt) : f.cpt);')
    .replace('st.foText = fo ? ftCrewLabel(fo).trim() : (f.fo || "");', 'st.foText = limitKhbPilotName(fo ? ftCrewLabel(fo) : f.fo);')
    .replace('  const td = document.createElement("td");\n  td.className = "ftflt";\n  if(list.length >= 2){', '  st[key] = limitKhbPilotName(st[key]);\n  const td = document.createElement("td");\n  td.className = "ftflt";\n  if(list.length >= 2){')
    .replace('inp.addEventListener("input", function(){ st[key] = inp.value; });\n  td.appendChild(inp);\n  return ftPack(td);\n}\nfunction ftTafPlace', 'inp.addEventListener("input", function(){ st[key] = inp.value; });\n  inp.addEventListener("change", function(){ st[key] = limitKhbPilotName(inp.value); inp.value = st[key]; });\n  td.appendChild(inp);\n  return ftPack(td);\n}\nfunction ftTafPlace')
    .replace('    const typedCpt = String(st.cptText || "").trim().match', '    st.cptText = limitKhbPilotName(st.cptText);\n    st.foText = limitKhbPilotName(st.foText);\n    const typedCpt = String(st.cptText || "").trim().match')
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
    out[i] = hit;
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
    .replace('  const tracked = !!(nmTrackData && String(tf.id || "") === id);', '  const tracked = !!(nmTrackData && String(tf.id || "") === id);\n  if(tracked && nmTrackData.verdict && (nmTrackData.verdict.sections || []).length) return Object.assign({}, nmTrackData.verdict, {callsign:f.callsign, dep:f.dep, dest:f.dest});')
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
      #wrapNmTrack .nm-track-head #nmTrackHead{flex:0 0 auto;min-width:320px}
      #wrapNmTrack .nm-track-head #nmTrackHead:empty{min-width:0;display:none}
      #wrapNmTrack .nm-th-tools{flex-wrap:nowrap;white-space:nowrap;flex:0 0 auto}
      .nm-storm-lbl{background:rgba(17,24,39,.85);color:#fff;border:0;font:700 11px/1.2 sans-serif;padding:2px 5px;box-shadow:none}
      #wrapNmTrack .nm-th-arrow{position:sticky;z-index:3;flex:0 0 auto;align-self:stretch;min-width:28px;border:0;background:var(--x-red);color:#fff;font-size:13px;cursor:pointer;padding:0 6px}
      #wrapNmTrack .nm-th-arrow[hidden]{display:none}
      #wrapNmTrack .nm-th-l{left:0}
      #wrapNmTrack .nm-th-r{right:0;margin-left:auto}
    </style><script>${aftnBookScript}</script><script>${notamGeometryFixes}</script><script>${ddScript}</script><script>${khbEzfwScript}</script><script>${stormToolbarScript}</script></body>`)
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
    .replaceAll('A product by Rosie', 'Dispatch Board')
    .replace('Roise x HN', 'Hy x HN')
    ;
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
