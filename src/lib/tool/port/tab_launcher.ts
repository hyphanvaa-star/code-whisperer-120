// Open a visible tool tab directly in a new browser tab. The launcher only
// activates the existing button; it never starts an operational job itself.
export const TOOL_TAB_BY_BUTTON_ID: Readonly<Record<string, string>> = Object.freeze({
  mFplText: 'fpltext',
  mHandover: 'handover',
  mCompare: 'compare',
  mTool: 'tool',
  mNotam: 'notam',
  mLimits: 'limits',
  mNoticeRules: 'notice_rules',
  mDatabase: 'database',
  opsAcctManage: 'accounts',
});

const TOOL_BUTTON_ID_BY_TAB: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(TOOL_TAB_BY_BUTTON_ID).map(([id, tab]) => [tab, id])),
);

export function normalizeToolTab(value: unknown): string {
  const tab = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(TOOL_BUTTON_ID_BY_TAB, tab) ? tab : '';
}

export function toolTabUrl(buttonId: string): string {
  const tab = TOOL_TAB_BY_BUTTON_ID[buttonId] || '';
  return tab ? `/tool?tab=${encodeURIComponent(tab)}` : '';
}

const MENU_CSS = `
.tool-tab-new-menu{position:fixed;z-index:100000;min-width:190px;padding:6px;border:1px solid var(--x-line,#e2e8f0);border-radius:12px;background:var(--x-card,#fff);box-shadow:0 16px 42px rgba(15,23,42,.22);font:600 14px/1.3 var(--x-sans,system-ui)}
.tool-tab-new-menu a{display:flex;align-items:center;gap:9px;padding:11px 12px;border-radius:8px;color:var(--x-ink,#0f172a);text-decoration:none;cursor:pointer}
.tool-tab-new-menu a:hover,.tool-tab-new-menu a:focus-visible{outline:none;background:var(--x-red,#e31937);color:#fff}
.tool-tab-new-menu svg{width:17px;height:17px;flex:none}
`;

export function patchTabLauncherPage(html: string): string {
  const script = `(function(){
  var buttonTabs=${JSON.stringify(TOOL_TAB_BY_BUTTON_ID)};
  var tabButtons=${JSON.stringify(TOOL_BUTTON_ID_BY_TAB)};
  var menu=null;
  function closeMenu(){ if(menu){ menu.remove(); menu=null; } }
  function openMenu(ev,url){
    closeMenu();
    menu=document.createElement('div');
    menu.className='tool-tab-new-menu'; menu.setAttribute('role','menu');
    var link=document.createElement('a'); link.href=url; link.target='_blank'; link.rel='noopener noreferrer';
    link.setAttribute('role','menuitem');
    link.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></svg><span>Mở tab mới ↗</span>';
    link.addEventListener('click',closeMenu); menu.appendChild(link); document.body.appendChild(menu);
    var scale=menu.getBoundingClientRect().width/menu.offsetWidth||1;
    var left=ev.clientX/scale,top=ev.clientY/scale;
    left=Math.max(8,Math.min(left,window.innerWidth/scale-menu.offsetWidth-8));
    top=Math.max(8,Math.min(top,window.innerHeight/scale-menu.offsetHeight-8));
    menu.style.left=left+'px'; menu.style.top=top+'px'; link.focus();
  }
  document.addEventListener('contextmenu',function(ev){
    closeMenu();
    var target=ev.target;
    var btn=target&&target.closest?target.closest('.aside-head .modes .mode'):null;
    if(!btn||btn.hidden||btn.getAttribute('aria-hidden')==='true'||btn.style.display==='none')return;
    var tab=buttonTabs[btn.id]; if(!tab)return;
    ev.preventDefault(); ev.stopPropagation();
    openMenu(ev,'/tool?tab='+encodeURIComponent(tab));
  },true);
  document.addEventListener('click',function(ev){ if(menu&&!menu.contains(ev.target))closeMenu(); },true);
  document.addEventListener('keydown',function(ev){
    if(!menu||ev.key!=='Escape')return;
    ev.preventDefault(); ev.stopImmediatePropagation(); closeMenu();
  },true);
  window.addEventListener('blur',closeMenu);
  window.addEventListener('resize',closeMenu);
  function openRequestedTab(){
    var requested='';
    try{ requested=new URLSearchParams(window.location.search).get('tab')||''; }catch(e){}
    var id=tabButtons[requested];
    if(!id||id==='opsAcctManage')return;
    var btn=document.getElementById(id);
    if(!btn||btn.hidden||btn.getAttribute('aria-hidden')==='true'||btn.style.display==='none')return;
    btn.click();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(openRequestedTab,0);});
  else setTimeout(openRequestedTab,0);
})();`;
  return html
    .replace('</head>', () => `<style id="tool-tab-launcher">${MENU_CSS}</style></head>`)
    .replace('</body>', () => `<script>${script}</script></body>`);
}
