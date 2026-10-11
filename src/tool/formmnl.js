/* ===== FORM MNL (CAAP flight plan from JetPlan View ICAO) ===== */
(function(){
const mnlBtn=document.createElement('button');
mnlBtn.type='button';mnlBtn.className='btn small';mnlBtn.id='ftMnlBtn';mnlBtn.textContent='FORM MNL';
mnlBtn.title='Tạo FORM MNL (CAAP) từ View ICAO JetPlan cho chuyến đã tick';
$('#ftCkBtn').insertAdjacentElement('afterend',mnlBtn);
function mnlScript(src,name){return window[name]?Promise.resolve():new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(new Error('Không tải được '+src));document.head.appendChild(s);});}
function mnlTime(date,utc){
  const d=String(date||''),u=/(\d{1,2}):?(\d{2})/.exec(String(utc||''));
  let m=/(\d{4})-(\d{2})-(\d{2})/.exec(d),y,mo,da;
  if(m){y=+m[1];mo=+m[2];da=+m[3];}else if((m=/(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d))){da=+m[1];mo=+m[2];y=+m[3];}else return 0;
  return Date.UTC(y,mo-1,da,u?+u[1]:0,u?+u[2]:0);
}
async function mnlShot(html){
  const fr=document.createElement('iframe');
  fr.style.cssText='position:fixed;left:-10000px;top:0;width:720px;height:1400px;border:0;background:#fff';
  document.body.appendChild(fr);
  try{
    fr.contentDocument.open();fr.contentDocument.write(html);fr.contentDocument.close();
    await new Promise(r=>setTimeout(r,300));
    const body=fr.contentDocument.body;body.style.margin='0';body.style.background='#fff';
    const form=body.querySelector('form')||body;
    // html2canvas clips input text: swap every field for a same-size span.
    for(const inp of [...form.querySelectorAll('input')]){
      const cs=fr.contentWindow.getComputedStyle(inp),sp=fr.contentDocument.createElement('span');
      sp.textContent=inp.value||'';
      for(const k of ['width','height','borderTop','borderRight','borderBottom','borderLeft','paddingLeft','paddingRight','fontFamily','fontSize','fontWeight','color','backgroundColor','verticalAlign','boxSizing','marginLeft','marginRight'])sp.style[k]=cs[k];
      sp.style.display='inline-block';sp.style.lineHeight=cs.height;sp.style.whiteSpace='pre';sp.style.overflow='hidden';sp.style.paddingTop='0';sp.style.paddingBottom='0';
      inp.replaceWith(sp);
    }
    const c=await html2canvas(form,{backgroundColor:'#fff',scale:2,windowWidth:720});
    return c;
  } finally { fr.remove(); }
}
let MNL_TPL=null;
async function mnlTemplate(){
  if(!MNL_TPL){const r=await fetch(FORM_MNL_TEMPLATE_URL);if(!r.ok)throw new Error('Không tải được mẫu FORM MNL');MNL_TPL=await r.arrayBuffer();}
  return MNL_TPL;
}
async function mnlCert(zip,lic){
  const png=await zip.file('word/media/image2.png').async('blob');
  const img=await createImageBitmap(png);
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
  const g=c.getContext('2d');g.drawImage(img,0,0);
  g.fillStyle='#fff';g.fillRect(820,106,84,30);
  if(lic){g.fillStyle='#000';g.font='16px "Times New Roman", Times, serif';g.textAlign='center';g.textBaseline='alphabetic';g.fillText(lic,861,128);}
  return new Promise(r=>c.toBlob(r,'image/png'));
}
async function mnlBuild(html,lic){
  const zip=await JSZip.loadAsync(await mnlTemplate());
  const shot=await mnlShot(html);
  zip.file('word/media/image1.png',await new Promise(r=>shot.toBlob(r,'image/png')));
  zip.file('word/media/image2.png',await mnlCert(zip,lic));
  let xml=await zip.file('word/document.xml').async('string');
  let cx=7117080,cy=Math.round(cx*shot.height/shot.width);
  if(cy>7170420){cy=7170420;cx=Math.round(cy*shot.width/shot.height);}
  xml=xml.replace(/(<wp:extent cx=")7117080(" cy=")7170420(")/,'$1'+cx+'$2'+cy+'$3').replace(/(<a:ext cx=")7117699(" cy=")7171044(")/,'$1'+cx+'$2'+cy+'$3');
  zip.file('word/document.xml',xml);
  return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
mnlBtn.onclick=async function(){
  const legs=[];
  for(const f of ftRows){
    if(!f) continue; const st=ftSt(f); if(!st.on) continue;
    const digits=String(f.flt||'').replace(/\D/g,'');
    legs.push({digits,flt:'VJ'+digits,dep:String(st.dep||'').toUpperCase(),arr:String(st.arr||'').toUpperCase(),date:st.date,t:mnlTime(st.date,st.utc)});
  }
  if(!legs.length){alert('Tick ít nhất một chuyến.');return;}
  const lic=($('#ftLicInput').value||'').trim();
  if(!lic && !confirm('Chưa nhập DSP License — ô số dưới chữ ký sẽ để trống. Vẫn tạo?')) return;
  if(mnlBtn.disabled)return; mnlBtn.disabled=true;
  const files=[],errs=[];
  try{
    await Promise.all([mnlScript('/vendor/jszip.min.js','JSZip'),mnlScript('/vendor/html2canvas.min.js','html2canvas')]);
    for(const leg of legs){
      $('#ftStat').textContent='Đang lấy View ICAO JetPlan '+leg.flt+'…';
      try{
        const r=await fetch('/api/jetplan/icao?flt='+leg.digits+'&t='+leg.t);
        const j=await r.json();
        if(!j || j.error) throw new Error(j&&j.error||('HTTP '+r.status));
        const blob=await mnlBuild(j.html,lic);
        files.push({url:URL.createObjectURL(blob),name:'ATC_FPL_'+leg.flt+'_'+(j.pod||leg.dep)+'-'+(j.poa||leg.arr)+'_'+String(j.etd||leg.date||'').split(',')[0].replace(/[^0-9A-Za-z-]/g,'')+'.docx'});
      }catch(e){errs.push(leg.flt+': '+e.message);}
    }
    const box=document.createElement('dialog');
    box.style.cssText='background:var(--vj-dark);color:var(--vj-dark-ink);border:1px solid var(--line);border-radius:8px;padding:18px;min-width:320px';
    box.innerHTML='<div style="font-weight:700;margin-bottom:10px">FORM MNL: '+files.length+'/'+legs.length+' file</div>';
    for(const f of files){const a=document.createElement('a');a.href=f.url;a.download=f.name;a.textContent='⬇ '+f.name;a.className='btn';a.style.cssText='display:block;margin:6px 0;text-align:left';box.appendChild(a);}
    for(const e of errs){const d=document.createElement('div');d.style.cssText='color:#ffb4ac;margin:4px 0';d.textContent='✗ '+e;box.appendChild(d);}
    const all=document.createElement('button');all.type='button';all.className='btn';all.textContent='Tải tất cả';all.style.marginRight='8px';
    all.onclick=async()=>{for(const a of box.querySelectorAll('a')){a.click();await new Promise(r=>setTimeout(r,800));}};
    const close=document.createElement('button');close.type='button';close.className='btn';close.textContent='Đóng';
    close.onclick=()=>{box.close();box.remove();files.forEach(f=>URL.revokeObjectURL(f.url));};
    const row=document.createElement('div');row.style.marginTop='12px';if(files.length)row.append(all);row.append(close);box.appendChild(row);
    document.body.appendChild(box);box.showModal();
    $('#ftStat').textContent='FORM MNL: '+files.length+'/'+legs.length+' file.';
  }catch(e){alert('Lỗi FORM MNL: '+e.message);}
  finally{mnlBtn.disabled=false;}
};
})();
