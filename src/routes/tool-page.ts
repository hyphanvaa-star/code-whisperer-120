import { createFileRoute } from "@tanstack/react-router";
import icaoCountries from "@/lib/tool/data/icao-countries.json";
import dispatchSkyHeader from "@/assets/dispatch-sky-header.jpg";
import dispatchAirportClean from "@/assets/vietjet-starlink-header-web.jpg?inline";
import vietjetLogo from "@/assets/vj-logo.png";
import notamGeometryFixes from '@/tool/notam-geometry.js?raw';

// Serves the original Dispatch Board screen (web.py PAGE) unchanged, plus a tiny
// shim that (1) skips the local passcode gate because the web app has real login,
// and (2) attaches the signed-in user's token to every /api/ call.
const SHIM = `<script>
(function(){
  window.__WEB_AUTH = true;
  if (window.parent === window) { location.replace('/tool'); return; }
  function tok(){ try { return window.parent.__fbToken ? window.parent.__fbToken() : null; } catch(e){ return null; } }
  function isApi(u){ return typeof u === 'string' && (u.indexOf('/api/') === 0 || u.indexOf(location.origin + '/api/') === 0); }
  var of = window.fetch.bind(window);
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (isApi(url)) {
      init = Object.assign({}, init || {});
      var h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
      var t = tok(); if (t) h.set('Authorization', 'Bearer ' + t);
      init.headers = h;
    }
    return of(input, init).then(function(r){
      if (r.status === 401 && isApi(url)) { try { window.parent.location.href = '/auth'; } catch(e){} }
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
    de.style.overflowX = 'hidden';
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
      if(board)board.insertAdjacentHTML('afterbegin',iconSvg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18M9 9h12M9 15h12"/>'));
      if(theme)theme.insertAdjacentHTML('afterbegin',iconSvg('<path d="M12 3a9 9 0 1 0 9 9c0-1.1-.2-2.1-.5-3A7 7 0 0 1 12 3Z"/>'));
    }
    if(room && !document.getElementById('opsHeaderBrand')){
      var brand=document.createElement('div');
      brand.id='opsHeaderBrand'; brand.className='ops-header-brand';
      var _v=(document.getElementById('appVersion')||{}).textContent||'';
      brand.innerHTML='<div class="ops-vj-mark"><span class="ops-vj-logo" aria-label="Vietjet Air"></span><span>OPERATION<br>CONTROL</span></div><div class="ops-sohee"><strong>Sohee</strong><span>— A product by Rosie</span>'+(_v?'<b title="Phiên bản tool" style="margin-left:8px;font:700 12px/1.4 monospace;padding:2px 8px;border-radius:10px;background:#fff;color:#E31937;vertical-align:middle">'+_v+'</b>':'')+'</div>';
      var live=document.createElement('div');
      live.className='ops-header-live';
      live.innerHTML='<div class="ops-weather" title="Thời tiết hiện tại tại TP. Hồ Chí Minh"><span class="ops-weather-icon">☀</span><strong id="opsWeatherTemp">--°C</strong><span><b>HO CHI MINH</b><small id="opsWeatherText">Đang cập nhật…</small></span></div><div class="ops-clock-wrap"><span class="ops-clock-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span><div class="ops-clock" title="Giờ địa phương TP. Hồ Chí Minh"><strong id="opsClockTime">--:--</strong><span id="opsClockDate">-- --- ----</span></div></div><div class="ops-account"><button type="button" class="ops-account-btn" id="opsAccountBtn" aria-haspopup="true" aria-expanded="false" title="Tài khoản đang đăng nhập"><span class="ops-avatar" id="opsAvatar">••</span><span class="ops-account-chevron" aria-hidden="true"></span></button><div class="ops-acct-menu" id="opsAcctMenu" hidden><div class="ops-acct-who"><small>Đang đăng nhập</small><strong id="opsAcctMail">…</strong></div><button type="button" class="ops-acct-out" id="opsSignOut">Đăng xuất</button></div></div>';
      room.appendChild(brand); room.appendChild(live);
      var acctBtn=document.getElementById('opsAccountBtn'),acctMenu=document.getElementById('opsAcctMenu'),acctMail=document.getElementById('opsAcctMail'),acctAvatar=document.getElementById('opsAvatar'),acctOut=document.getElementById('opsSignOut');
      var setAcctMail=function(mail){ if(!acctMail||!mail)return; acctMail.textContent=mail; if(acctAvatar){var nm=String(mail).split('@')[0].replace(/[^a-z0-9]/gi,''); acctAvatar.textContent=nm.slice(0,2).toUpperCase()||'••';} };
      var setAcctOpen=function(on){ if(!acctMenu||!acctBtn)return; acctMenu.hidden=!on; acctBtn.setAttribute('aria-expanded',on?'true':'false'); };
      if(acctBtn)acctBtn.addEventListener('click',function(e){ e.stopPropagation(); setAcctOpen(acctMenu.hidden); });
      if(acctMenu)acctMenu.addEventListener('click',function(e){ e.stopPropagation(); });
      document.addEventListener('click',function(){ setAcctOpen(false); });
      if(acctOut)acctOut.addEventListener('click',function(){ try{ window.parent.postMessage({type:'sohee-signout'},window.location.origin); }catch(e){} });
      window.addEventListener('message',function(ev){ if(ev.origin!==window.location.origin)return; var d=ev.data||{}; if(d.type==='sohee-account')setAcctMail(d.email); });
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

const GATE_SKIP = `(async function gateBoot(){ if(window.__WEB_AUTH){ try{ var g=document.getElementById("gate"); if(g) g.style.display="none"; unlockUI(); }catch(e){ console.error(e); } return; }`;

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
.body{grid-template-columns:minmax(0,1fr) calc(420px + 5cm) !important;padding-left:248px !important;gap:12px !important;padding-top:12px !important;padding-right:12px !important}
/* Check NOTAM: bản đồ bên phải nới rộng sang trái thêm 5cm */
.app > .body:has(#wrapNotam:not([style*="none"])){grid-template-columns:minmax(0,1fr) calc(420px + 10cm) !important}
.aside-head{
  position:fixed !important;left:0 !important;top:var(--x-top,99px) !important;bottom:0 !important;width:236px !important;display:block !important;z-index:30 !important;
  background:#fff !important;border-right:1px solid var(--x-line) !important;border-bottom:0 !important;padding:16px 10px !important;overflow-y:auto !important;
}
.aside-head::before{content:"CHỨC NĂNG";display:block;font:600 10px var(--x-sans);letter-spacing:.14em;color:var(--x-mute);padding:0 10px 10px}
.aside-head .modes{flex-direction:column !important;align-items:stretch !important;gap:2px !important;padding:0 !important;background:transparent !important;flex-wrap:nowrap !important;overflow:visible !important}
/*x*/.aside-head .mode,.mode{
  white-space:nowrap !important;overflow:visible !important;justify-content:flex-start !important;text-align:left !important;flex:0 0 auto !important;width:100% !important;margin:0 !important;
  padding:9px 12px !important;height:auto !important;
  background:transparent !important;color:var(--x-ink2) !important;-webkit-text-fill-color:var(--x-ink2) !important;
  border-radius:8px !important;box-shadow:none !important;font-size:13px !important;font-weight:500 !important;gap:10px !important;
}
.mode *:not(.mode-bang):not(.mode-bang *){color:inherit !important;-webkit-text-fill-color:inherit !important}
.mode svg,.mode svg *{stroke:var(--x-mute) !important}
.aside-head .mode:hover,.mode:hover{background:var(--x-bg) !important;color:var(--x-ink) !important;-webkit-text-fill-color:var(--x-ink) !important}
.aside-head .mode.on,.mode.on{
  background:var(--x-red-50) !important;color:var(--x-red) !important;-webkit-text-fill-color:var(--x-red) !important;font-weight:700 !important;
  box-shadow:inset 3px 0 0 var(--x-red) !important;
}
.mode.on svg,.mode.on svg *{stroke:var(--x-red) !important}
.mode-bang,.mode .mode-bang{top:50% !important;transform:translateY(-50%);right:10px !important;left:auto !important;border-color:#fff !important}

/* Bảng: không khối đỏ — đầu bảng trắng chữ đỏ, gạch đỏ; dòng thoáng phẳng */
aside,main.split2{border-radius:12px !important;overflow:hidden}
table thead th,table > tr:first-child > th,.tooltbl th{
  background:var(--x-red) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;
  border-bottom:2px solid var(--x-yel) !important;
}
table thead th *{color:#fff !important;-webkit-text-fill-color:#fff !important}
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
.ops-account-btn{display:flex;align-items:center;gap:11px;margin:0;padding:0;border:0;background:none;cursor:pointer;font:inherit}.ops-acct-menu{position:absolute;right:17px;top:calc(100% - 6px);min-width:238px;z-index:60;display:flex;flex-direction:column;padding:10px;border:1px solid rgba(255,255,255,.28);border-radius:14px;background:linear-gradient(180deg,rgba(20,30,40,.97),rgba(12,22,32,.99));box-shadow:0 18px 42px rgba(10,18,28,.45)}.ops-acct-menu[hidden]{display:none}.ops-acct-who{display:flex;flex-direction:column;gap:5px;padding:2px 4px 10px;border-bottom:1px solid rgba(255,255,255,.18)}.ops-acct-who small{font:700 10px/1 var(--x-sans);letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.7)}.ops-acct-who strong{font:700 13px/1.2 var(--x-mono);color:#fff;word-break:break-all}.ops-acct-out{margin-top:10px;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;border:0;border-radius:10px;background:var(--x-red);color:#fff;font:800 13px var(--x-sans);letter-spacing:.02em;cursor:pointer}.ops-acct-out:hover{filter:brightness(1.1)}
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
#wrapFplText .ftdsp.ftefb{padding:4px 8px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;display:flex;align-items:center;gap:6px;font-weight:700;white-space:nowrap}
#wrapFplText .ftdsp.ftefb input{width:150px;background:#fff;border:1px solid var(--line);border-radius:var(--radius)}
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

let cached: string | null = null;

async function page(): Promise<string> {
  if (cached) return cached;
  const raw = (await import("@/tool/page.html?raw")).default as string;
  cached = raw
    .replace('</body>', `<script>${notamGeometryFixes}</script></body>`)
    .replace("<head>", "<head>" + FONTS + SHIM)
    .replace("</head>", SKIN + POPART + PRO + `<style>:root{--dispatch-sky:url("${dispatchSkyHeader}");--airport-clean:url("${dispatchAirportClean}");--vj-logo:url("${vietjetLogo}")}</style>` + "</head>")
    .replace("(async function gateBoot(){", GATE_SKIP)
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
    .replace("    if(ok) await defPullSummary({quiet: true});", "    /* defect summary chỉ tải khi bấm nút */")
    // Tải defect summary: GỘP với bảng hiện có thay vì ghi đè — giữ nguyên
    // các dòng LOW EGT mặc định và các dòng người dùng tự thêm, chỉ thay
    // phần defect lấy từ mail summary.
    .replace(
      "    limData.aircraft = limPad(d.aircraft || [], LIM_ROWS, limBlankAc);",
      "    limData.aircraft = limPad(limMergeDefect(limData.aircraft, d.aircraft || []), LIM_ROWS, limBlankAc);",
    )
    .replace(
      "async function defPullSummary(opts){",
      "function limMergeDefect(oldRows, newRows){\n"
      + "  const isEgt = r => /^\\s*LOW\\s+EGT/i.test(String((r && r.defect) || \"\"));\n"
      + "  const key = r => String((r && r.reg) || \"\").toUpperCase().replace(/[^A-Z0-9]/g, \"\") + \"\\u0000\" + String((r && r.defect) || \"\").toUpperCase().replace(/\\s+/g, \" \").trim();\n"
      + "  const kept = (oldRows || []).filter(r => r && String(r.reg || \"\").trim() && (isEgt(r) || !String(r.defect || \"\").trim()));\n"
      + "  const seen = new Set(kept.map(key));\n"
      + "  const added = (newRows || []).filter(r => r && String(r.reg || \"\").trim() && !seen.has(key(r)));\n"
      + "  return kept.concat(added);\n"
      + "}\n"
      + "async function defPullSummary(opts){",
    )
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
