(function () {
  const ASSET = "/hanyi/";
  const flavors = [
    { id: "berry", name: "Berry", n: "01", price: 21.00, tile: "kumo-tile-berry.png", cup: "kumo-clean-cranberry.png?v=5", desc: "Mixed berry folded into ceremonial grade. Color shifts warm. Still earthy." },
    { id: "strawberry", name: "Strawberry", n: "02", price: 22.00, tile: "kumo-tile-strawberry.png", cup: "kumo-clean-strawberry.png?v=5", desc: "Ripe strawberry over thick foam. Bright, then back to leaf." },
    { id: "blueberry", name: "Blueberry", n: "03", price: 19.33, tile: "kumo-tile-blueberry.png", cup: "kumo-clean-original.png?v=5", desc: "Blueberry skin, cooler olive, a dusk cup. The first blend." },
    { id: "cranberry", name: "Cranberry", n: "04", price: 21.50, tile: "kumo-tile-cranberry.png", cup: "kumo-clean-cranberry.png?v=5", desc: "Tart skin, deep red dust. A sharper cup than berry." },
    { id: "mango", name: "Mango", n: "05", price: 23.00, tile: "kumo-tile-mango.png", cup: "kumo-clean-mango.png?v=5", desc: "Ripe mango over first flush. Soft, then back to grass." },
    { id: "kiwi", name: "Kiwi", n: "06", price: 22.50, tile: "kumo-tile-kiwi.png", cup: "kumo-clean-kiwi.png?v=5", desc: "Green fruit, cooler foam. A morning blend." },
    { id: "peach", name: "Peach", n: "07", price: 21.80, tile: "kumo-tile-peach.png", cup: "kumo-clean-peach.png?v=5", desc: "Soft peach skin, quiet sweetness — no syrup, no noise." },
    { id: "lemon", name: "Lemon", n: "08", price: 20.50, tile: "kumo-tile-lemon.png", cup: "kumo-clean-lemon.png?v=5", desc: "Citrus peel over thick foam. Bright, then back to leaf." },
    { id: "yuzu", name: "Yuzu", n: "09", price: 23.40, tile: "kumo-tile-yuzu.png", cup: "kumo-clean-lemon.png?v=5", desc: "Yuzu haze. Citrus, then a quiet return to matcha." }
  ];
  const arc = document.getElementById("arc");
  if (!arc) return;
  flavors.forEach((f) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tile";
    b.dataset.id = f.id;
    b.innerHTML = '<img src="' + ASSET + f.tile + '" alt="' + f.name + '">';
    arc.appendChild(b);
  });
  function money(n) { return n.toFixed(2) + "$"; }
  let currentId = "";
  let qty = 1;
  const bag = {};
  let bagTotal = 0;
  let hyTyped = false;
  window._hanyiLocked = false;

  function idleMenu() {
    currentId = "";
    document.getElementById("flavor").textContent = "";
    document.getElementById("tagPrice").textContent = "00.00$";
    document.getElementById("billKicker").textContent = "— blend";
    document.getElementById("billName").textContent = "";
    document.getElementById("billDesc").textContent = "Pick a cup on the shelf.";
    document.getElementById("billUnit").textContent = "00.00$";
    document.querySelectorAll("#matchaShop .tile").forEach(t => t.classList.remove("on"));
  }
  function setFlavor(id) {
    const f = flavors.find(x => x.id === id);
    if (!f) { idleMenu(); return; }
    currentId = f.id;
    document.getElementById("cup").src = ASSET + f.cup;
    document.getElementById("flavor").textContent = f.name;
    document.getElementById("tagPrice").textContent = money(f.price);
    document.getElementById("billKicker").textContent = f.n + " — blend";
    document.getElementById("billName").textContent = f.name;
    document.getElementById("billDesc").textContent = f.desc;
    document.getElementById("billUnit").textContent = money(f.price);
    document.querySelectorAll("#matchaShop .tile").forEach(t => t.classList.toggle("on", t.dataset.id === id));
    const bill = document.getElementById("bill");
    bill.style.animation = "none";
    void bill.offsetWidth;
    bill.style.animation = "hyBillIn .55s cubic-bezier(.34,1.3,.64,1)";
  }
  function hint(t) {
    const el = document.querySelector("#matchaShop .bill .hint");
    if (el) el.textContent = t;
  }
  function persistBag() {
    try { sessionStorage.setItem("hanyi-bag", JSON.stringify({ bag, qty })); } catch (e) {}
  }
  function loadBag() {
    try {
      const d = JSON.parse(sessionStorage.getItem("hanyi-bag") || "null");
      if (!d || !d.bag) return;
      Object.keys(d.bag).forEach(k => { bag[k] = d.bag[k]; });
      if (d.qty) qty = d.qty;
    } catch (e) {}
  }
  function cartCount() {
    return flavors.reduce((n, f) => n + (bag[f.id] || 0), 0);
  }
  function hasOrder() {
    return cartCount() > 0 && bagTotal > 0;
  }
  function renderBag() {
    const list = document.getElementById("cartList");
    const lines = flavors.filter(f => bag[f.id]);
    const count = lines.reduce((n, f) => n + bag[f.id], 0);
    const total = lines.reduce((n, f) => n + f.price * bag[f.id], 0);
    bagTotal = total;
    const badge = document.getElementById("cartN");
    badge.textContent = count;
    badge.classList.toggle("on", count > 0);
    const payBtn = document.getElementById("payBtn");
    if (payBtn) payBtn.textContent = count ? "Thanh toan " + money(total) : "Thanh toan";
    persistBag();
    if (!lines.length) {
      list.innerHTML = "";
      return;
    }
    list.innerHTML = lines.map(f =>
      '<div class="cart-line"><span>' + bag[f.id] + " × " + f.name + '</span><span>' + money(f.price * bag[f.id]) + '</span><button type="button" data-drop="' + f.id + '" aria-label="xoa ' + f.name + '">×</button></div>'
    ).join("") + '<div class="cart-total"><span>Total</span><span>' + money(total) + "</span></div>";
  }
  function setQty(n) {
    qty = Math.max(1, Math.min(9, n));
    document.getElementById("qtyVal").textContent = qty;
  }
  function clearBag() {
    Object.keys(bag).forEach(k => { delete bag[k]; });
    setQty(1);
    renderBag();
    hint("Don da xoa. Chon mon roi Add to cart.");
  }
  function dropLine(id) {
    delete bag[id];
    renderBag();
    hint(Object.keys(bag).length ? "Da xoa 1 dong." : "pls order your drink");
  }

  window.hyLockShop = function (msg) {
    window._hanyiLocked = true;
    hint(msg || "het luot — F5 de thu lai");
    const go = document.getElementById("visaGo");
    if (go) { go.disabled = true; go.textContent = "Da khoa"; }
    const pin = document.getElementById("visaPin");
    if (pin) { pin.disabled = true; pin.placeholder = "da khoa"; }
    const err = document.getElementById("visaErr");
    if (err) err.textContent = msg || "Da khoa";
  };

  loadBag();
  idleMenu();
  setQty(qty);
  renderBag();

  const wrap = document.getElementById("cupWrap");
  const stage = document.getElementById("stage");
  const live = {
    x: 50, y: 42, w: 197, fade: 0, rot: 0, shadow: 10,
    tile: 98, arcR: 470, arcY: 22,
    hills: 60, fs: 35, pw: 108, hs: 65, anim: 7,
    fx: 49.3, fy: 62.2, px: 49.7, py: 72.9, hx: 50.5, hy: 92,
    fruitPos: {}, animOn: true
  };
  function arcSpotU(u, s) {
    const t0 = Math.max(-0.5, Math.min(0.5, u - 0.5));
    const ang = t0 * Math.PI * 1.08;
    const rect = stage.getBoundingClientRect();
    const dx = Math.sin(ang) * s.arcR;
    const dy = (1 - Math.cos(ang)) * s.arcR * 0.28 - 6;
    return {
      x: +(50 + (dx / Math.max(rect.width, 1)) * 100).toFixed(2),
      y: +(s.arcY + (dy / Math.max(rect.height, 1)) * 100).toFixed(2)
    };
  }
  function layoutTiles(s, shift) {
    const tiles = document.querySelectorAll("#matchaShop .tile");
    const n = flavors.length;
    tiles.forEach((t, i) => {
      t.style.setProperty("--tile", s.tile + "px");
      if (s.animOn && shift != null) {
        const u = Math.max(0, Math.min(1, (n === 1 ? 0.5 : i / (n - 1)) + shift));
        const pos = arcSpotU(u, s);
        t.style.setProperty("--tx", pos.x + "%");
        t.style.setProperty("--ty", pos.y + "%");
        return;
      }
      const u = n === 1 ? 0.5 : i / (n - 1);
      const pos = arcSpotU(u, s);
      t.style.setProperty("--tx", pos.x + "%");
      t.style.setProperty("--ty", pos.y + "%");
    });
  }
  function apply(s) {
    wrap.style.setProperty("--cx", s.x + "%");
    wrap.style.setProperty("--cy", s.y + "%");
    wrap.style.setProperty("--cw", s.w + "px");
    wrap.style.setProperty("--fade", s.fade + "%");
    wrap.style.setProperty("--rot", s.rot + "deg");
    wrap.style.setProperty("--shadow", s.shadow);
    stage.style.setProperty("--hills", s.hills + "%");
    document.getElementById("flavorBox").style.setProperty("--ix", s.fx + "%");
    document.getElementById("flavorBox").style.setProperty("--iy", s.fy + "%");
    document.getElementById("flavorBox").style.setProperty("--flavor-s", s.fs + "px");
    document.getElementById("priceBox").style.setProperty("--ix", s.px + "%");
    document.getElementById("priceBox").style.setProperty("--iy", s.py + "%");
    document.getElementById("priceBox").style.setProperty("--price-w", s.pw + "px");
    document.getElementById("headBox").style.setProperty("--ix", s.hx + "%");
    document.getElementById("headBox").style.setProperty("--iy", s.hy + "%");
    document.getElementById("headBox").style.setProperty("--head-s", s.hs + "px");
    layoutTiles(s, lastShift);
  }
  let lastShift = 0;
  apply(live);
  document.querySelectorAll("#matchaShop .tile").forEach(t => {
    t.onclick = () => setFlavor(t.dataset.id);
  });
  let animClock = 0;
  let lastTs = 0;
  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (live.animOn) {
      animClock += dt * ((live.anim || 12) / 12) * 0.22;
      const cycle = animClock % 2;
      const ping = cycle < 1 ? cycle : 2 - cycle;
      lastShift = (ping - 0.5) * 0.42;
      layoutTiles(live, lastShift);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.addEventListener("resize", () => layoutTiles(live, lastShift));

  document.getElementById("qtyMinus").onclick = () => setQty(qty - 1);
  document.getElementById("qtyPlus").onclick = () => setQty(qty + 1);
  document.getElementById("addBtn").onclick = () => {
    if (!currentId) { hint("pls order your drink"); return; }
    const f = flavors.find(x => x.id === currentId);
    bag[f.id] = (bag[f.id] || 0) + qty;
    renderBag();
    hint("Da them " + qty + " × " + f.name + " vao cart.");
  };
  document.getElementById("resetBill").onclick = () => clearBag();
  document.getElementById("cartList").onclick = ev => {
    const btn = ev.target.closest("[data-drop]");
    if (btn) dropLine(btn.dataset.drop);
  };
  document.getElementById("cartBtn").onclick = () => {
    document.getElementById("bill").scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const visaVeil = document.getElementById("visaVeil");
  const visaPin = document.getElementById("visaPin");
  const visaErr = document.getElementById("visaErr");
  function openVisa(msg) {
    document.getElementById("visaAmt").textContent = money(bagTotal);
    visaErr.textContent = msg || "";
    visaPin.value = "";
    hyTyped = false;
    visaVeil.classList.add("on");
  }
  function closeVisa() {
    visaVeil.classList.remove("on");
    visaPin.value = "";
    visaErr.textContent = "";
  }
  function submitOrder() {
    if (!hasOrder()) {
      visaErr.textContent = "pls order your drink";
      hint("pls order your drink");
      return;
    }
    try { sessionStorage.removeItem("hanyi-bag"); } catch (e) {}
    clearBag();
    hint("Cam on — don da dat.");
    visaErr.textContent = "Cam on!";
    window.setTimeout(closeVisa, 800);
  }
  document.getElementById("payBtn").onclick = () => {
    if (!hasOrder()) {
      closeVisa();
      hint("pls order your drink");
      return;
    }
    openVisa();
  };
  document.getElementById("visaCancel").onclick = () => closeVisa();
  document.getElementById("visaGo").onclick = () => submitOrder();
  visaPin.onkeydown = ev => {
    if (ev.key === "Enter") document.getElementById("visaGo").click();
  };
  const closeBtn = document.getElementById("matchaClose");
  if (closeBtn) closeBtn.onclick = () => {
    if (typeof closeMatchaShop === "function") closeMatchaShop();
  };
})();
