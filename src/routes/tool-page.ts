import { createFileRoute } from "@tanstack/react-router";

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
  window.addEventListener('load', function(){ fit(); setTimeout(fit, 800); setTimeout(fit, 2500); });
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

/* ---------- Ô NHẬP ---------- */
input[type=text],input[type=search],input[type=number],input[type=password],input[type=date],input[type=time],input:not([type]),select,textarea{
  font-family:var(--x-sans) !important;font-size:12px !important;color:var(--x-ink) !important;
  background:#fff !important;border:1px solid var(--x-line) !important;border-radius:6px !important;box-shadow:none !important;
}
input:focus,select:focus,textarea:focus{outline:none !important;border-color:var(--x-red) !important;box-shadow:0 0 0 3px rgba(227,25,55,.12) !important}
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
  font-size:12px !important;color:var(--x-ink) !important;padding:5px 8px !important;
  border:0 !important;border-bottom:1px solid var(--x-line2) !important;background:#fff;
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

/* ---------- THẺ CHI TIẾT CHUYẾN (chuyển sang sáng) ---------- */
.fi-pane,#pane.fi-pane{background:var(--x-bg) !important}
.fi-board{color:var(--x-ink) !important}
.fi-card,.fi-card.fi-acft{background:#fff !important;border:1px solid var(--x-line) !important;border-radius:var(--x-r) !important;box-shadow:var(--x-sh) !important}
.fi-k,.fi-fuel .lab,.fi-grid .lab,.fi-leg .dir,.fi-oooi .k,.fi-load th{color:var(--x-red) !important;font-family:var(--x-sans) !important;font-weight:700 !important;background:transparent !important;-webkit-text-fill-color:var(--x-red) !important;border:0 !important;text-transform:uppercase}
.fi-id,.fi-reg,.fi-leg .codes,.fi-type b,.fi-fuel .val,.fi-grid .val,.fi-load tr.tot td,.fi-files li{color:var(--x-ink) !important}
.fi-id .rt,.fi-date,.fi-leg .meta,.fi-fuel .u,.fi-files .who,.fi-files-empty,.fi-spec{color:var(--x-mute) !important}
.fi-leg .nm,.fi-load td,.fi-type{color:var(--x-ink2) !important}
.fi-load td{background:transparent !important;border-top:1px solid var(--x-line2) !important;border-bottom:0 !important}
.fi-leg + .fi-leg,.fi-files li{border-color:var(--x-line2) !important}
.fi-oooi .dot{background:#D5D9E0 !important;border-color:#D5D9E0 !important}
.fi-oooi li:not(:last-child)::after{background:#E4E6EA !important}
.fi-oooi li.done .dot{background:var(--x-ok) !important;border-color:var(--x-ok) !important;box-shadow:none !important}
.fi-oooi li.now .dot{box-shadow:0 0 0 4px rgba(21,128,61,.18) !important}
.fi-oooi li.done:not(:last-child)::after{background:var(--x-ok) !important;box-shadow:none !important}
.fi-oooi .t{color:var(--x-mute) !important;text-shadow:none !important}
.fi-oooi li.done .t{color:var(--x-ok) !important;text-shadow:none !important}
.fi-board .lim-banner{background:var(--x-red-50) !important;border:1px solid var(--x-red-100) !important;color:var(--x-red-d) !important}
.fi-board .lim-banner *{color:var(--x-red-d) !important}
.fi-board .vd.air{color:#1D4ED8 !important;background:#E6EEFF !important}
.fi-board .vd.taxi{color:var(--x-warn) !important;background:var(--x-warn-bg) !important}
.fi-board .vd.off{color:#C2410C !important;background:#FFEDE3 !important}
.fi-board .vd.gnd,.fi-board .vd.dim{color:var(--x-ink2) !important;background:#EEF0F3 !important}
.fi-board .vd.done,.fi-board .vd.complete{color:var(--x-ok) !important;background:var(--x-ok-bg) !important}
.fi-board .vd.in{color:#0F766E !important;background:#E3F7F3 !important}

/* gọn: dòng thấp, nhiều dòng */
table tbody tr{height:auto !important}
table tbody td{padding:3px 8px !important;line-height:1.25 !important;height:auto !important}
.aside-head{background:#fff !important;background-image:none !important;border:0 !important;box-shadow:none !important;border-bottom:1px solid var(--x-line) !important}
.aside-head .modes{border:0 !important;box-shadow:none !important}
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
    .replace("<head>", "<head>" + FONTS + SHIM)
    .replace("</head>", SKIN + POPART + PRO + "</head>")
    .replace("(async function gateBoot(){", GATE_SKIP)
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
            "Cache-Control": "no-store",
            "X-Frame-Options": "SAMEORIGIN",
          },
        }),
    },
  },
});
