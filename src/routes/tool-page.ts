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
:root{
  --stone:#F4F5F7; --stone-2:#E8EAEE;
  --ink:#15181F; --ink-soft:#5A6070;
  --console:#12151D; --console-ink:#D8DBE4;
  --klein:#C41E3A; --klein-soft:rgba(196,30,58,.08);
  --amber:#B26A00; --green:#15803D; --red:#C0362C;
  --line:rgba(21,24,31,.10); --radius:12px;
  --glow:0 1px 2px rgba(21,24,31,.05),0 4px 14px rgba(196,30,58,.07);
}
body{letter-spacing:0}
/* Header: nền kính mờ, bóng mềm, mép dưới tinh tế */
header{
  background:rgba(255,255,255,.72);
  backdrop-filter:blur(14px) saturate(1.4);
  -webkit-backdrop-filter:blur(14px) saturate(1.4);
  border-bottom:1px solid rgba(21,24,31,.08);
  box-shadow:0 6px 24px rgba(10,16,40,.12);
}
.brand h1{letter-spacing:.01em}
/* Ô lọc / nhập liệu: nền trắng sạch, viền mảnh, focus đỏ Vietjet */
input,select,textarea{
  border-radius:9px !important;
  transition:border-color .15s ease,box-shadow .15s ease,background .15s ease;
}
input:focus,select:focus,textarea:focus{
  outline:none;
  border-color:var(--klein) !important;
  box-shadow:0 0 0 3px rgba(196,30,58,.14) !important;
}
/* Nút bấm: nâng nhẹ khi hover, bóng đỏ nhạt cho nút chính */
button{
  transition:transform .12s ease,box-shadow .15s ease,background .15s ease,
             border-color .15s ease,color .15s ease,filter .15s ease;
}
button:hover{filter:brightness(1.03)}
button:active{transform:translateY(1px) scale(.99)}
/* Tab pill: bo tròn hơn, tab đang chọn nổi bật bằng bóng thay vì màu đặc */
.tabs button,.tab,[class*="tab"] button{
  border-radius:999px;
}
/* Thẻ / panel: bo góc lớn, viền mảnh, bóng nhiều lớp mềm */
.card,.panel,.box,[class*="card"],[class*="panel"]{
  border-radius:14px;
}
/* Bảng dữ liệu: đầu bảng dính, nền mờ, dòng hover rõ, zebra rất nhạt */
table{border-collapse:separate;border-spacing:0}
thead th{
  position:sticky;top:0;z-index:3;
  background:rgba(244,245,247,.92);
  backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px);
  font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-soft);
  border-bottom:1px solid var(--line) !important;
}
tbody tr{transition:background .12s ease}
tbody tr:hover{background:rgba(196,30,58,.045)}
tbody tr:nth-child(even){background:rgba(21,24,31,.018)}
tbody tr:hover:nth-child(even){background:rgba(196,30,58,.05)}
td{border-bottom:1px solid rgba(21,24,31,.05)}
/* Chip trạng thống kê trên header */
.hstat > span,.head-ops .xls-name{
  background:rgba(255,255,255,.75);
  border:1px solid rgba(21,24,31,.07);
  box-shadow:0 1px 2px rgba(21,24,31,.05);
  border-radius:999px;
}
/* Thanh cuộn mảnh, hiện đại */
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{
  background:rgba(21,24,31,.18);border-radius:99px;
  border:2px solid transparent;background-clip:padding-box;
}
::-webkit-scrollbar-thumb:hover{background:rgba(196,30,58,.4);background-clip:padding-box}
/* Hộp thoại / popup: bo lớn, bóng sâu, viền mảnh */
.modal,.popup,.dialog,[class*="modal"],[class*="popup"]{
  border-radius:16px !important;
  box-shadow:0 12px 48px rgba(10,16,40,.22),0 2px 8px rgba(10,16,40,.10) !important;
}
/* Chọn văn bản: đỏ Vietjet nhạt */
::selection{background:rgba(196,30,58,.18)}
/* ===== Hiện đại hoá tổng thể: bỏ tông hồng/magenta, chuyển sang
   xám than chuyên nghiệp + đỏ Vietjet. Chỉ đổi màu/hình thức. ===== */
/* Đầu bảng chính và mọi đầu bảng magenta -> xám than đậm, chữ trắng */
#wrapGeneral .gtable thead th,
.xlstbl thead th,
#wrapCompare .cmptbl thead th,
#wrapVer .tooltbl thead th,
#wrapAtcCheck #acTbl thead th{
  background:linear-gradient(180deg,#262E3B 0%,#1B222D 100%) !important;
  color:#E8ECF3 !important;
  border-color:#1B222D !important;
  border-bottom:2px solid var(--klein) !important;
  text-shadow:none;
  font-size:10px;letter-spacing:.09em;
}
#wrapGeneral .gtable thead th:first-child::before{
  background:rgba(255,255,255,.10);
  border-color:rgba(255,255,255,.16);
}
/* Đầu bảng hồng nhạt -> xám sáng trung tính, chữ đỏ đậm */
#wrapTool .tooltbl thead th,
#wrapLimits .limtbl thead th{
  background:#EEF1F5 !important;
  color:#9F1B32 !important;
  border-bottom:2px solid var(--klein) !important;
}
/* Các điểm nhấn hồng đậm -> đỏ Vietjet */
.cmp-pick .hd,.nm-place .uses,.nm-tune-pop h5,.nm-place-head,#ftAtcMiss{color:var(--klein) !important}
.nm-find > button{background:var(--klein) !important}
.ftci input:focus,.fttx input:focus{border-color:var(--klein) !important}
.ftcrew-menu button.on{background:rgba(196,30,58,.12) !important}
/* Hàng được chọn trong bảng chính: nền đỏ nhạt + gạch trái đỏ */
#wrapGeneral .gtable tbody tr.sel td,
#wrapGeneral .gtable tbody tr.on td{
  background:rgba(196,30,58,.07) !important;
  box-shadow:inset 3px 0 0 var(--klein);
}
/* Ô ngày/giờ trong bảng: font số đều, dễ đọc */
#wrapGeneral .gtable td{font-variant-numeric:tabular-nums}
/* Thanh tab chức năng (Tạo KHB, Giao ca...): nền trắng sạch, pill rõ ràng */
.toolbars,nav.tabs,.subtabs{
  background:rgba(255,255,255,.66);
  backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
}
/* Nút bấm chính: gradient đỏ Vietjet thay xanh tím */
.btn.primary,.toolbars .btn.t-go{
  background:linear-gradient(135deg,#D8263F,#A31328) !important;
  box-shadow:0 2px 10px rgba(196,30,58,.28);
}
.btn.primary:hover,.toolbars .btn.t-go:hover{
  background:linear-gradient(135deg,#C41E3A,#8F1123) !important;
}
/* Khung chi tiết bên phải: viền mảnh, bo góc đồng bộ */
#detailWrap{
  border-radius:14px;
  overflow:hidden;
  box-shadow:0 8px 28px rgba(10,16,40,.14);
}
.detail-tabs{
  background:rgba(255,255,255,.8);
  backdrop-filter:blur(10px);
}
.dtab.on{color:var(--klein);box-shadow:inset 0 -2px 0 var(--klein)}
/* Thanh tab chế độ (Tạo KHB / Giao ca / Hiển thị chung...): bỏ hồng,
   chuyển sang xám trung tính + tab đang chọn đỏ Vietjet */
.modes{
  background:rgba(255,255,255,.78) !important;
  border:1px solid rgba(21,24,31,.10) !important;
  backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);
}
.mode{
  color:#4A5160 !important;
  background:transparent !important;
  border:1px solid transparent !important;
}
.mode:hover{background:rgba(21,24,31,.05) !important}
.mode.on{
  color:#fff !important;
  background:linear-gradient(135deg,#D8263F,#A31328) !important;
  box-shadow:0 2px 8px rgba(196,30,58,.30);
}
/* Header: tăng độ đục để nền ảnh không loang hồng qua */
header{background:rgba(255,255,255,.88) !important}
/* Nút hành động trên header (Acc/TAF/Crew/Refresh/OFP): giữ màu trạng thái,
   chỉ làm bóng và bo góc hiện đại hơn */
.btn.act{border-radius:10px;box-shadow:0 2px 8px rgba(10,16,40,.14)}
.btn.act:hover:not(:disabled){box-shadow:0 5px 16px rgba(10,16,40,.20)}
/* Giảm gắt ảnh nền: lớp phủ sáng mỏng để chữ nổi hơn */
body::before{
  content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(10,16,40,.10));
}
</style>`;

let cached: string | null = null;

async function page(): Promise<string> {
  if (cached) return cached;
  const raw = (await import("@/tool/page.html?raw")).default as string;
  cached = raw
    .replace("<head>", "<head>" + SHIM)
    .replace("</head>", SKIN + "</head>")
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
