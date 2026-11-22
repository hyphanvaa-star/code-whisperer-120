/* Database access: DSP thường chỉ xem Cost Index / Taxi fuel / Route / PCR / Data Convert (Admin mới sửa);
   ALT route, ERA, AFTN Address là bản riêng từng tài khoản. Server cũng chặn ghi, đây chỉ là giao diện. */
(function(){
  var RO = ["ftCost", "ftTaxi", "ftRoute", "ftPcr", "ftConv"];
  var RO_CARDS = ["ftCostBtn", "ftTaxiBtn", "ftRouteBtn", "ftPcrBtn", "ftConvBtn"];
  var OWN_CARDS = ["ftAltBtn", "ftEraBtn", "dbxAftnBook"];
  function lockInputs(root){
    root.querySelectorAll("input,textarea").forEach(function(el){
      if(el.closest(".sheet-head")) return;
      if(!el.readOnly){ el.readOnly = true; el.tabIndex = -1; el.title = "Chỉ xem — Admin mới sửa được"; }
    });
  }
  function readOnlyUi(){
    document.body.classList.add("dsp-ro");
    var st = document.createElement("style");
    st.textContent = RO.map(function(p){ return ".dsp-ro #"+p+"Modal .crew-foot .btn:not(.x),.dsp-ro #"+p+"Modal [id$=Add],.dsp-ro #"+p+"Modal [id$=Save]"; }).join(",")
      + "{display:none!important}"
      + RO.map(function(p){ return ".dsp-ro #"+p+"Modal .sheet-body input"; }).join(",")
      + "{background:var(--x-bg)!important;cursor:default}"
      + ".dsp-ro-note{display:inline-block;margin-right:auto;padding:3px 10px;border-radius:12px;font:700 12px/1.6 system-ui,sans-serif;color:var(--x-ink2);background:var(--x-bg);border:1px solid var(--x-line)}"
      + ".dbx-own-tag{display:inline-block;margin-top:6px;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700;border:1px solid var(--x-line);color:var(--x-ink2)}";
    document.head.appendChild(st);
    RO.forEach(function(p){
      var modal = document.getElementById(p + "Modal");
      if(!modal) return;
      var msg = document.getElementById(p + "Msg");
      if(msg && !modal.querySelector(".dsp-ro-note")){
        var n = document.createElement("span");
        n.className = "dsp-ro-note";
        n.textContent = "🔒 Chỉ xem — bảng chung do Admin cập nhật";
        msg.parentNode.insertBefore(n, msg);
      }
      lockInputs(modal);
      new MutationObserver(function(){ lockInputs(modal); }).observe(modal, {childList: true, subtree: true});
    });
  }
  function tagCards(admin){
    var tag = function(ids, text){
      ids.forEach(function(id){
        var c = document.querySelector('.dbx-card[data-btn="'+id+'"]');
        if(!c || c.querySelector(".dbx-own-tag")) return;
        var t = document.createElement("span"); t.className = "dbx-own-tag"; t.textContent = text;
        var go = c.querySelector(".dbx-go"); c.insertBefore(t, go || null);
      });
    };
    if(!admin) tag(RO_CARDS, "🔒 Chỉ xem");
    tag(OWN_CARDS, "👤 Bản riêng của bạn");
  }
  /* AFTN Address: lưu theo tài khoản trên máy chủ, không theo máy (máy văn phòng dùng chung). */
  function aftnSync(uid){
    var src = document.getElementById("afBook");
    if(!src || !uid) return;
    var ready = false, applying = false, timer = null;
    function save(){
      fetch("/api/aftn/book", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({text: src.value})})
        .then(function(r){ return r.json(); }).then(function(d){ if(d && d.error) console.warn("AFTN Address:", d.error); })
        .catch(function(){});
    }
    src.addEventListener("input", function(){
      if(!ready || applying) return;
      try{ localStorage.setItem("aftn.book.owner", uid); }catch(e){}
      clearTimeout(timer); timer = setTimeout(save, 1200);
    });
    function apply(text){
      applying = true;
      src.value = text;
      src.dispatchEvent(new Event("input", {bubbles: true}));
      applying = false;
    }
    fetch("/api/aftn/book").then(function(r){ return r.json(); }).then(function(d){
      if(!d || !d.ok) return;
      var owner = null; try{ owner = localStorage.getItem("aftn.book.owner"); }catch(e){}
      if(typeof d.text === "string") apply(d.text);
      else if(owner && owner !== uid && typeof window.__aftnSuppliedBook === "string") apply(window.__aftnSuppliedBook);
      else if(localStorage.getItem("aftn.book") !== null) save();
      try{ localStorage.setItem("aftn.book.owner", uid); }catch(e){}
      ready = true;
    }).catch(function(){});
  }
  function go(){
    fetch("/api/settings/scope").then(function(r){ return r.json(); }).then(function(d){
      if(!d || !d.ok) return;
      aftnSync(d.uid);
      if(!d.admin) readOnlyUi();
      tagCards(!!d.admin);
    }).catch(function(){});
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
})();
