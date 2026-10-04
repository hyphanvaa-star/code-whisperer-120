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
})();
</script>`;

const GATE_SKIP = `(async function gateBoot(){ if(window.__WEB_AUTH){ try{ var g=document.getElementById("gate"); if(g) g.style.display="none"; unlockUI(); }catch(e){ console.error(e); } return; }`;

let cached: string | null = null;

async function page(): Promise<string> {
  if (cached) return cached;
  const raw = (await import("@/tool/page.html?raw")).default as string;
  cached = raw
    .replace("<head>", "<head>" + SHIM)
    .replace("(async function gateBoot(){", GATE_SKIP)
    .split("/static/shanghai-bund-inner-true-hd.jpg").join("/static/shanghai-bund-night-hq.webp")
    .split("/static/shanghai-bund-clock-night-true-hd.jpg").join("/static/shanghai-bund-clock-night-hq.webp");
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
