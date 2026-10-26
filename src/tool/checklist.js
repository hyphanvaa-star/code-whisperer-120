/* Browser-only F-017/F-018 PDF overlays, injected in the original tool scope. */
const CK_VN = new Set('SGN HAN DAD CXR PQC HPH VII HUI VCA DLI UIH VCL PXU THD BMV VKG CAH TBB VDH VCS DIN VDO'.split(' '));
function ckLicKey(){ return 'ck.license.' + ($('#ftDspBox').value || '').trim().toUpperCase(); }
const ckLicense = document.createElement('label');
ckLicense.className = 'ftdsp';
ckLicense.innerHTML = 'DSP License : <input type="text" id="ftLicInput" autocomplete="off" spellcheck="false" aria-label="DSP License">';
$('#ftDspBox').closest('label').insertAdjacentElement('afterend', ckLicense);
function ckRestoreLicense(){ try { $('#ftLicInput').value = localStorage.getItem(ckLicKey()) || localStorage.getItem('ck.license.last') || ''; } catch(e) { $('#ftLicInput').value = ''; } }
try { if(!($('#ftDspBox').value || '').trim()) $('#ftDspBox').value = localStorage.getItem('ck.dsp.last') || ''; } catch(e) {}
ckRestoreLicense();
function ckSaveDsp(){ try { const v=($('#ftDspBox').value || '').trim(); if(v) localStorage.setItem('ck.dsp.last', v); } catch(e) {} }
$('#ftDspBox').addEventListener('input', function(){ ckSaveDsp(); ckRestoreLicense(); });
$('#ftDspBox').addEventListener('change', function(){ ckSaveDsp(); ckRestoreLicense(); });
$('#ftLicInput').addEventListener('input', function(){
  try { localStorage.setItem('ck.license.last', this.value.trim()); } catch(e) {}
  if(!($('#ftDspBox').value || '').trim()) return;
  try { localStorage.setItem(ckLicKey(), this.value.trim()); } catch(e) {}
});
let ckResources;
function ckScript(url, global){
  if(window[global]) return Promise.resolve(window[global]);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = url;
    script.onload = () => resolve(window[global]);
    script.onerror = () => { script.remove(); reject(new Error('Không tải được thư viện PDF.')); };
    document.head.appendChild(script);
  });
}
async function ckGetResources(){
  if(!ckResources) ckResources = Promise.all([
    ckScript('/vendor/pdf-lib.min.js', 'PDFLib'), ckScript('/vendor/fontkit.umd.min.js', 'fontkit'),
    ...['template.pdf','regular.ttf','bold.ttf','layout.json'].map(async file => {
      const response = await fetch('/checklist/' + file);
      if(!response.ok) throw new Error('Không tải được mẫu Checklist.');
      return file.endsWith('.json') ? response.json() : response.arrayBuffer();
    })
  ]).catch(error => { ckResources = null; throw error; });
  return ckResources;
}
async function ckBuild(leg, dsp, lic){
  const [lib, fontkit, template, regular, bold, layout] = await ckGetResources();
  const pdf = await lib.PDFDocument.load(template); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(regular,{subset:true}), strong = await pdf.embedFont(bold,{subset:true});
  const page = pdf.getPages()[0], height = page.getHeight();
  const write = (value,x,top,maxWidth,face=font,center=false) => {
    const text = String(value || ''); if(!text) return;
    let size=9; while(size>5 && face.widthOfTextAtSize(text,size)>maxWidth) size-=.25;
    const width=face.widthOfTextAtSize(text,size);
    page.drawText(text,{x:center ? x+(maxWidth-width)/2 : x,y:height-top-size,size,font:face});
  };
  [leg.reg,leg.flt,leg.sector,leg.date,leg.etd,leg.eta].forEach((value,i) => {
    const cell=layout.info[i]; write(value,cell.left,cell.top,cell.right-cell.left,font,true);
  });
  for(const cell of layout.ticks){
    const row=cell.row;
    // II.3/4 use content rows 35/37; headings and 8.1/8.2 labels stay blank.
    if([10,14,34,36].includes(row)) continue;
    if(row>=11 && row<=13 && leg.intl) continue;
    if(row>=15 && row<=17 && !leg.intl) continue;
    const x=cell.x,y=height-cell.y;
    // Draw a real checkmark, not a V or a font-dependent symbol.
    page.drawLine({start:{x:x-4,y},end:{x:x-1,y:y-3},thickness:1.35});
    page.drawLine({start:{x:x-1,y:y-3},end:{x:x+5,y:y+4},thickness:1.35});
  }
  const sig=layout.signature;
  write(dsp,sig.x,sig.nameTop,sig.maxWidth,strong);
  write('License No: '+(lic || '—'),sig.x,sig.licenseTop,sig.maxWidth);
  pdf.setTitle('Checklist F-017 '+leg.flt+' '+leg.date);
  return new Blob([await pdf.save()],{type:'application/pdf'});
}
let ckEdtoResources;
async function ckBuildEdto(leg,dsp,lic){
  const [lib,fontkit,,regular,bold] = await ckGetResources();
  if(!ckEdtoResources) ckEdtoResources=Promise.all([
    fetch(CK_EDTO_TEMPLATE_URL).then(response => {if(!response.ok) throw new Error('Không tải được mẫu EDTO.');return response.arrayBuffer();}),
    fetch('/checklist/edto-layout.json').then(response => {if(!response.ok) throw new Error('Không tải được vị trí điền EDTO.');return response.json();})
  ]).catch(error => {ckEdtoResources=null;throw error;});
  const [template,layout]=await ckEdtoResources;
  const pdf=await lib.PDFDocument.load(template);pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(regular,{subset:true}),strong=await pdf.embedFont(bold,{subset:true});
  const pages=pdf.getPages();
  const write=(page,value,cell,face=font) => {
    const text=String(value || '');if(!text)return;
    let size=9;const maxWidth=cell.right-cell.left;
    while(size>4 && face.widthOfTextAtSize(text,size)>maxWidth)size-=.25;
    page.drawText(text,{x:cell.left,y:page.getHeight()-cell.top-size,size,font:face});
  };
  layout.pages.forEach((positions,i) => {
    const page=pages[i];if(!page)throw new Error('Mẫu EDTO thiếu trang.');
    [leg.reg,leg.flt,leg.dep,leg.arr,leg.date].forEach((value,j) => write(page,value,positions.info[j]));
    for(const cell of positions.ticks){
      const x=cell.x,y=page.getHeight()-cell.y;
      page.drawLine({start:{x:x-4,y},end:{x:x-1,y:y-3},thickness:1.35});
      page.drawLine({start:{x:x-1,y:y-3},end:{x:x+5,y:y+4},thickness:1.35});
    }
  });
  const page=pages[pages.length-1],sig=layout.signature;
  write(page,dsp,{left:sig.x,right:sig.x+sig.maxWidth,top:sig.nameTop},strong);
  write(page,'License No: '+(lic || '—'),{left:sig.x,right:sig.x+sig.maxWidth,top:sig.licenseTop});
  pdf.setTitle('EDTO Checklist F-018 '+leg.flt+' '+leg.date);
  return new Blob([await pdf.save()],{type:'application/pdf'});
}
const ckChoice=document.createElement('dialog');
ckChoice.id='ckChoice';ckChoice.setAttribute('aria-label','Chọn Checklist');
ckChoice.innerHTML='<button type="button" class="btn" data-kind="normal">Normal Checklist</button><button type="button" class="btn" data-kind="edto">EDTO Checklist</button>';
const ckChoiceStyle=document.createElement('style');
ckChoiceStyle.textContent='#ckChoice{background:var(--vj-dark);color:var(--vj-dark-ink);border:1px solid var(--line);border-radius:8px;padding:18px;max-width:calc(100% - 32px)}#ckChoice[open]{display:flex;flex-wrap:wrap;gap:12px}#ckChoice .btn{min-height:42px;font-size:14px}';
document.head.appendChild(ckChoiceStyle);document.body.appendChild(ckChoice);
ckChoice.addEventListener('click',event => {if(event.target===ckChoice){const r=ckChoice.getBoundingClientRect();if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom)ckChoice.close();}});
$('#ftCkSaveBtn').onclick=function(){ckChoice.showModal();};
ckChoice.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click',() => {ckChoice.close();ckExport(button.dataset.kind);}));
async function ckExport(kind){
  const dsp=($('#ftDspBox').value || '').trim();
  if(!dsp){alert('Chưa điền tên DSP.');$('#ftDspBox').focus();return;}
  const legs=[];
  for(const f of ftRows){
    if(!f) continue; const st=ftSt(f); if(!st.on) continue;
    const dep=String(st.dep || '').trim().toUpperCase(),arr=String(st.arr || '').trim().toUpperCase();
    legs.push({reg:st.reg,flt:'VJ'+String(f.flt || '').replace(/^VJC?/i,''),dep,arr,sector:dep+'-'+arr,
      date:st.date,etd:st.utc,eta:st.etaUtc,intl:!(CK_VN.has(dep) && CK_VN.has(arr))});
  }
  if(!legs.length){alert('Tick ít nhất một chuyến.');return;}
  const lic=($('#ftLicInput').value || '').trim();
  if(!lic && !confirm('Chưa nhập DSP License. Vẫn tạo Checklist?')) return;
  const button=$('#ftCkSaveBtn');if(button.disabled)return;button.disabled=true;let count=0;const files=[];
  try {
    for(const leg of legs){
      $('#ftStat').textContent='Đang tạo PDF '+leg.flt+'…';
      const blob=await (kind==='edto' ? ckBuildEdto(leg,dsp,lic) : ckBuild(leg,dsp,lic));
      files.push({blob,name:'Checklist_'+(kind==='edto' ? 'EDTO_F018_' : 'F017_')+leg.flt+'_'+String(leg.date || '').replace(/[^0-9A-Za-z-]/g,'-')+'.pdf'});
      count++;
    }
    // Lưu thẳng tất cả vào folder checklist trên máy công ty qua trợ lý PC.
    $('#ftStat').textContent='Đang lưu '+count+' Checklist về PC…';
    try{
      const d=await ckSaveToPc(files);
      $('#ftStat').textContent='✓ Đã lưu '+d.ok+' Checklist vào '+d.dir;
      alert('Đã lưu '+d.ok+' Checklist vào:\n'+(d.paths||[]).join('\n'));
    }catch(pcError){
      // Trợ lý PC chưa mở: giữ danh sách bấm tải để không mất file vừa tạo.
      $('#ftStat').textContent='Không lưu về PC được: '+pcError.message;
      ckShowDownloads(files);
    }
  } catch(error){alert('Lỗi tạo Checklist: '+error.message);$('#ftStat').textContent='Đã tạo '+count+'/'+legs.length+' PDF.';}
  finally{button.disabled=false;}
}
function ckB64(blob){
  return new Promise((ok,bad)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]||'');r.onerror=()=>bad(new Error('Không đọc được file vừa tạo'));r.readAsDataURL(blob);});
}
async function ckSaveToPc(files){
  const payload=[];
  for(const f of files) payload.push({name:f.name,data_b64:await ckB64(f.blob)});
  const response=await fetch('/api/pc/save-files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'checklist',files:payload})});
  const d=await response.json().catch(()=>null);
  if(!d || d.error) throw new Error((d && d.error) || 'Máy chủ không trả lời');
  return d;
}
function ckShowDownloads(files){
  const box=document.createElement('dialog');box.id='ckFiles';
  box.style.cssText='background:var(--vj-dark);color:var(--vj-dark-ink);border:1px solid var(--line);border-radius:8px;padding:18px;min-width:320px';
  box.innerHTML='<div style="font-weight:700;margin-bottom:10px">Đã tạo '+files.length+' PDF — trợ lý PC chưa mở nên bấm từng file để tải</div>';
  for(const f of files){const url=URL.createObjectURL(f.blob);const a=document.createElement('a');a.href=url;a.download=f.name;a.textContent='⬇ '+f.name;a.className='btn';a.style.cssText='display:block;margin:6px 0;text-align:left';a.onclick=()=>{a.style.opacity='.55';};box.appendChild(a);}
  const all=document.createElement('button');all.type='button';all.className='btn';all.textContent='Tải tất cả';all.style.marginRight='8px';
  all.onclick=async()=>{for(const a of box.querySelectorAll('a')){a.click();await new Promise(r=>setTimeout(r,800));}};
  const close=document.createElement('button');close.type='button';close.className='btn';close.textContent='Đóng';
  close.onclick=()=>{box.close();box.remove();};
  const row=document.createElement('div');row.style.marginTop='12px';row.append(all,close);box.appendChild(row);
  document.body.appendChild(box);box.showModal();
}
