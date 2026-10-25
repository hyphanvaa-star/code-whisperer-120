/** Only non-secret account metadata is remembered; passwords stay on the server. */
export function patchAccountMemoryPage(html: string): string {
  return html
    .replace(/function acRefresh\(\)\{[\s\S]*?(?=\nconst AC_DEF_USER)/, ACCOUNT_MEMORY_SCRIPT + '\n')
    .replace('    if(d.ok){\n      msg.className = "acmsg ok";', '    if(d.ok){\n      acRememberSaved(kind, pf, Boolean(pass));\n      msg.className = "acmsg ok";')
    .replace('acPwSetup(); acRefresh(); $("#accModal").classList.add("open");', 'acPwSetup(); acRestore(); acRefresh(); $("#accModal").classList.add("open");')
    .replace('function acPwSetup(){', 'function acPwSetup(){\n  acWatchEdits();');
}

export const ACCOUNT_MEMORY_SCRIPT = `
const AC_FIELDS = [["flitebrief","Fb"],["omni","Omni"],["outlook","Outlook"],["owa","Owa"],["aviweb","Aviweb"],["opscore","Opscore"]];
let acRevision = 0;
let acOwner = "";
let acMetadata = {};
function acUserId(){
  try { return window.parent.__fbUserId ? window.parent.__fbUserId() || "" : ""; } catch(e){ return ""; }
}
function acSafeAccounts(accounts){
  const safe = {};
  for(const [kind] of AC_FIELDS){
    const info = accounts[kind];
    if(!info || typeof info !== "object") continue;
    safe[kind] = {
      username: typeof info.username === "string" ? info.username : "",
      mailbox: typeof info.mailbox === "string" ? info.mailbox : "",
      source: ["file","env","default","none"].includes(info.source) ? info.source : "none",
      has_password: info.has_password === true
    };
  }
  return safe;
}
function acWriteCache(){
  const uid = acUserId();
  if(!uid || uid !== acOwner) return;
  try { localStorage.setItem("sohee:accounts:v1:" + uid, JSON.stringify(acSafeAccounts(acMetadata))); } catch(e){}
}
function acSelectOwner(){
  const uid = acUserId();
  if(!uid) return false;
  if(acOwner !== uid){
    acOwner = uid; acMetadata = {}; acRevision++;
    for(const [,pf] of AC_FIELDS){
      for(const suffix of ["User","Pass","Box"]){
        const input = $("#ac"+pf+suffix);
        if(input){ input.value = ""; input.dataset.dirty = ""; input.dataset.saved = ""; input.dataset.mask = ""; if(suffix === "Pass") input.type = "password"; }
      }
      const msg = $("#ac"+pf+"Msg"); if(msg) msg.textContent = "";
    }
    try { acMetadata = acSafeAccounts(JSON.parse(localStorage.getItem("sohee:accounts:v1:" + uid) || "{}")); } catch(e){}
  }
  return true;
}
function acWatchEdits(){
  for(const [,pf] of AC_FIELDS){
    for(const suffix of ["User","Pass","Box"]){
      const input = $("#ac"+pf+suffix);
      if(input && !input.dataset.acWatch){ input.dataset.acWatch = "1"; input.addEventListener("input", () => { input.dataset.dirty = "1"; }); }
    }
  }
}
function acRenderAccounts(checking){
  for(const [kind,pf] of AC_FIELDS){
    const user = $("#ac"+pf+"User"); if(!user) continue;
    const info = acMetadata[kind];
    const src = $("#ac"+pf+"Src");
    if(!info){ if(src) src.textContent = checking ? "Đang kiểm tra tài khoản đã lưu…" : "Chưa có tài khoản lưu"; continue; }
    const fallback = kind === "outlook" ? (acMetadata.owa?.username || "") : (AC_DEF_USER[kind] || "");
    if(!user.dataset.dirty) user.value = info.username || fallback;
    const box = $("#ac"+pf+"Box"); if(box && !box.dataset.dirty) box.value = info.mailbox || "";
    const pi = $("#ac"+pf+"Pass");
    if(pi && !pi.dataset.dirty){
      pi.type = "password"; pi.dataset.saved = info.source === "file" && info.has_password ? "1" : "";
      pi.dataset.mask = info.has_password ? "1" : ""; pi.value = info.has_password ? AC_MASK : ""; pi.placeholder = "nhập mật khẩu";
      const eye = pi.parentNode.querySelector(".aceye"); if(eye) eye.textContent = "👁";
    }
    if(src){
      src.className = "use";
      src.textContent = info.source === "file" && info.has_password ? "✓ Đã có tài khoản lưu" : info.source === "env" ? "Đang dùng tài khoản chung" : info.has_password ? "Đã có mật khẩu" : "Chưa có mật khẩu";
      if(info.source === "file" && info.has_password) src.classList.add("ok");
      if(checking) src.textContent += " · Đang kiểm tra…";
    }
  }
}
function acRestore(){
  if(acSelectOwner()) acRenderAccounts(true);
  acWatchEdits();
}
async function acRefresh(){
  if(!acSelectOwner()) return;
  const uid = acOwner, revision = ++acRevision;
  acRenderAccounts(true); acWatchEdits();
  try{
    const r = await fetch("/api/credentials", {cache:"no-store"});
    if(!r.ok) throw new Error("Không tải được tài khoản");
    const d = await r.json();
    if(uid !== acUserId() || revision !== acRevision) return;
    if(d.error || !d.accounts || typeof d.accounts !== "object") throw new Error("Không tải được tài khoản");
    acMetadata = acSafeAccounts(d.accounts); acWriteCache(); acRenderAccounts(false);
    const fb = acMetadata.flitebrief || {};
    $("#accWho").textContent = "Acc";
    $("#btnAcc").title = "Tài khoản" + (fb.username ? " — đang dùng: " + fb.username : "");
  }catch(e){
    if(uid !== acUserId() || revision !== acRevision) return;
    acRenderAccounts(false);
    for(const [,pf] of AC_FIELDS){ const src = $("#ac"+pf+"Src"); if(src) src.textContent += " · Chưa kiểm tra được, mở lại để thử"; }
  }
}
function acRememberSaved(kind,pf,hasPassword){
  if(!acOwner || acOwner !== acUserId()) return;
  const previous = acMetadata[kind] || {};
  acMetadata[kind] = {username: $("#ac"+pf+"User").value.trim(), mailbox: $("#ac"+pf+"Box")?.value.trim() || "", source:"file", has_password:hasPassword || previous.has_password === true};
  for(const suffix of ["User","Pass","Box"]){ const input = $("#ac"+pf+suffix); if(input) input.dataset.dirty = ""; }
  acWriteCache();
}
`;