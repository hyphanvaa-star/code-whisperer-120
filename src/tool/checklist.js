/* Browser-only F-017 PDF overlay, injected in the original tool scope. */
const CK_VN = new Set('SGN HAN DAD CXR PQC HPH VII HUI VCA DLI UIH VCL PXU THD BMV VKG CAH TBB VDH VCS DIN VDO'.split(' '));
function ckLicKey(){ return 'ck.license.' + ($('#ftDspBox').value || '').trim().toUpperCase(); }
const ckLicense = document.createElement('label');
ckLicense.className = 'ftdsp';
ckLicense.innerHTML = 'DSP License : <input type="text" id="ftLicInput" autocomplete="off" spellcheck="false" aria-label="DSP License">';
$('#ftDspBox').closest('label').insertAdjacentElement('afterend', ckLicense);
function ckRestoreLicense(){ try { $('#ftLicInput').value = localStorage.getItem(ckLicKey()) || ''; } catch(e) { $('#ftLicInput').value = ''; } }
ckRestoreLicense();
$('#ftDspBox').addEventListener('input', ckRestoreLicense);
$('#ftDspBox').addEventListener('change', ckRestoreLicense);
$('#ftLicInput').addEventListener('input', function(){
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
$('#ftCkBtn').onclick = async function(){
  const dsp=($('#ftDspBox').value || '').trim();
  if(!dsp){alert('Chưa điền tên DSP.');$('#ftDspBox').focus();return;}
  const legs=[];
  for(const f of ftRows){
    if(!f) continue; const st=ftSt(f); if(!st.on) continue;
    const dep=String(st.dep || '').trim().toUpperCase(),arr=String(st.arr || '').trim().toUpperCase();
    legs.push({reg:st.reg,flt:'VJ'+String(f.flt || '').replace(/^VJC?/i,''),sector:dep+'-'+arr,
      date:st.date,etd:st.utc,eta:st.etaUtc,intl:!(CK_VN.has(dep) && CK_VN.has(arr))});
  }
  if(!legs.length){alert('Tick ít nhất một chuyến.');return;}
  const lic=($('#ftLicInput').value || '').trim();
  if(!lic && !confirm('Chưa nhập DSP License. Vẫn tạo Checklist?')) return;
  const button=this;button.disabled=true;let count=0;
  try {
    for(const leg of legs){
      $('#ftStat').textContent='Đang tạo PDF '+leg.flt+'…';
      const blob=await ckBuild(leg,dsp,lic),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='Checklist_F017_'+leg.flt+'_'+String(leg.date || '').replace(/[^0-9A-Za-z-]/g,'-')+'.pdf';
      document.body.appendChild(link);link.click();link.remove();count++;
      setTimeout(() => URL.revokeObjectURL(url),30000);
      await new Promise(resolve => setTimeout(resolve,400));
    }
    $('#ftStat').textContent='Đã tạo '+count+' PDF Checklist.';
  } catch(error){alert('Lỗi tạo Checklist: '+error.message);$('#ftStat').textContent='Đã tải '+count+'/'+legs.length+' PDF.';}
  finally{button.disabled=false;}
};
