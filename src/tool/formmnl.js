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
    const st=fr.contentDocument.createElement('style');st.textContent='*{letter-spacing:normal!important;word-spacing:normal!important;font-kerning:none!important;font-variant-ligatures:none!important;text-rendering:auto!important}';fr.contentDocument.head.appendChild(st);
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
    const fw=form.scrollWidth;form.style.width=fw+'px';form.style.display='inline-block';const W=fw+4;fr.style.width=W+'px';await new Promise(r=>setTimeout(r,50));
    const c=await html2canvas(form,{backgroundColor:'#fff',scale:2,windowWidth:W,width:form.scrollWidth+2,height:form.scrollHeight+2});
    return c;
  } finally { fr.remove(); }
}
let MNL_TPL=null;
async function mnlTemplate(){
  if(!MNL_TPL){const r=await fetch(FORM_MNL_TEMPLATE_URL);if(!r.ok)throw new Error('Không tải được mẫu FORM MNL');MNL_TPL=await r.arrayBuffer();}
  return MNL_TPL;
}
async function mnlCert(png,lic){
  const img=await createImageBitmap(png);
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
  const g=c.getContext('2d');g.drawImage(img,0,0);
  g.fillStyle='#fff';g.fillRect(760,140,150,52);
  if(lic){g.fillStyle='#000';g.font='15px "Times New Roman", Times, serif';g.textAlign='center';g.textBaseline='alphabetic';g.fillText(lic,830,190);}
  return new Promise(r=>c.toBlob(r,'image/png'));
}
async function mnlSig(png){
  const img=await createImageBitmap(png),sr=await fetch(FORM_MNL_SIG_URL);
  const sig=await createImageBitmap(await sr.blob());
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
  const g=c.getContext('2d');g.drawImage(img,0,0);
  g.fillStyle='#fff';g.fillRect(575,140,170,56);g.fillRect(760,140,150,52);
  const h=54,w=h*sig.width/sig.height;g.filter='contrast(4) brightness(0.5)';for(let i=0;i<3;i++)g.drawImage(sig,655-w/2,142,w,h);g.filter='none';
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
function mnlSync(doc){
  for(const i of doc.querySelectorAll('input'))i.setAttribute('value',i.value);
  for(const t of doc.querySelectorAll('textarea'))t.textContent=t.value;
  for(const o of doc.querySelectorAll('option'))o.selected?o.setAttribute('selected',''):o.removeAttribute('selected');
  return '<!doctype html>'+doc.documentElement.outerHTML.replace(/contenteditable="true"/g,'');
}
async function mnlPdf(html,certPng,lic){
  const shot=await mnlShot(html);
  const cert=await createImageBitmap(await mnlCert(certPng,lic));
  const cc=document.createElement('canvas');cc.width=cert.width;cc.height=cert.height;cc.getContext('2d').drawImage(cert,0,0);
  const pdf=await PDFLib.PDFDocument.create();
  const cou=await pdf.embedFont(PDFLib.StandardFonts.Courier),coub=await pdf.embedFont(PDFLib.StandardFonts.CourierBold),hel=await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
  let first=true;
  for(const c of [shot,cc]){
    const img=await pdf.embedPng(c.toDataURL('image/png'));
    const pg=pdf.addPage([612,792]);let top=36,H=720;
    if(first){
      pg.drawText('CAAP FORM ATS No.2019 -1',{x:40,y:760,size:9,font:cou});
      pg.drawText('FLIGHT PLAN',{x:40,y:749,size:9,font:cou});
      const ctr=(t,f,z,y)=>pg.drawText(t,{x:306-f.widthOfTextAtSize(t,z)/2,y,size:z,font:f});
      ctr('Republic of the Philippines',cou,10,732);ctr('CIVIL AVIATION AUTHORITY OF THE PHILIPPINES',coub,10.5,718);ctr('Old MIA Rd. Pasay City, Metro Manila 1300',hel,10,704);
      top=96;H=792-top-30;
    }
    const W=540;let w=W,h=w*c.height/c.width;if(h>H){h=H;w=h*c.width/c.height;}
    const x=(612-w)/2,y=792-top-h;
    pg.drawImage(img,{x,y,width:w,height:h});
    pg.drawRectangle({x:x-3,y:y-3,width:w+6,height:h+6,borderWidth:1,borderColor:PDFLib.rgb(0,0,0)});
    first=false;
  }
  return new Blob([await pdf.save()],{type:'application/pdf'});
}
function mnlEditor(files,errs,lic,certPng){
  const box=document.createElement('dialog');
  box.style.cssText='background:var(--vj-dark);color:var(--vj-dark-ink);border:1px solid var(--line);border-radius:8px;padding:14px;width:min(820px,96vw);max-height:94vh;overflow:auto';
  box.innerHTML='<div style="font-weight:700;margin-bottom:8px">FORM MNL — bấm vào bất kỳ chữ/ô nào để sửa, xong bấm Xuất PDF</div>';
  for(const e of errs){const d=document.createElement('div');d.style.cssText='color:#ffb4ac;margin:4px 0';d.textContent='✗ '+e;box.appendChild(d);}
  const certUrl=URL.createObjectURL(certPng);
  for(const f of files){
    const sec=document.createElement('div');sec.style.cssText='margin:10px 0 18px;border-top:1px solid var(--line);padding-top:10px';
    const name=document.createElement('input');name.value=f.name;name.style.cssText='width:100%;margin-bottom:6px';
    const fr=document.createElement('iframe');fr.style.cssText='width:100%;height:560px;border:0;background:#fff';
    const cw=document.createElement('div');cw.style.cssText='position:relative;margin-top:8px;background:#fff';
    const im=document.createElement('img');im.src=certUrl;im.style.cssText='width:100%;display:block';
    const li=document.createElement('input');li.value=lic;li.title='Số license';
    li.style.cssText='position:absolute;left:'+(790/921*100)+'%;top:0;width:'+(80/921*100)+'%;font:13px Times New Roman,serif;text-align:center;border:1px dashed #d10000;background:#fff;color:#000;padding:0';
    im.onload=()=>{li.style.top=(172/im.naturalHeight*im.clientHeight)+'px';li.style.height=(22/im.naturalHeight*im.clientHeight)+'px';};
    cw.append(im,li);
    const ex=document.createElement('button');ex.type='button';ex.className='btn';ex.textContent='Xuất PDF';ex.style.marginTop='8px';
    ex.onclick=async()=>{ex.disabled=true;ex.textContent='Đang xuất…';try{
      const blob=await mnlPdf(mnlSync(fr.contentDocument),certPng,li.value.trim());
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name.value.replace(/\.(docx|pdf)$/i,'')+'.pdf';a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    }catch(e){alert('Lỗi xuất PDF: '+e.message);}finally{ex.disabled=false;ex.textContent='Xuất PDF';}};
    sec.append(name,fr,cw,ex);box.appendChild(sec);
    fr.onload=null;
    setTimeout(()=>{const d=fr.contentDocument;d.open();d.write(f.html);d.close();d.body.contentEditable='true';d.body.style.background='#fff';},0);
  }
  const close=document.createElement('button');close.type='button';close.className='btn';close.textContent='Đóng';
  close.onclick=()=>{box.close();box.remove();URL.revokeObjectURL(certUrl);};
  box.appendChild(close);document.body.appendChild(box);box.showModal();
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
        files.push({html:j.html,name:'ATC_FPL_'+leg.flt+'_'+(j.pod||leg.dep)+'-'+(j.poa||leg.arr)+'_'+String(j.etd||leg.date||'').split(',')[0].replace(/[^0-9A-Za-z-]/g,'')+'.pdf'});
      }catch(e){errs.push(leg.flt+': '+e.message);}
    }
    if(!files.length){alert('FORM MNL lỗi:\n'+errs.join('\n'));return;}
    await mnlScript('/vendor/pdf-lib.min.js','PDFLib');
    const zip=await JSZip.loadAsync(await mnlTemplate());
    const certPng=await mnlSig(await zip.file('word/media/image2.png').async('blob'));
    mnlEditor(files,errs,lic,certPng);
    $('#ftStat').textContent='FORM MNL: chỉnh sửa rồi bấm Xuất PDF.';
  }catch(e){alert('Lỗi FORM MNL: '+e.message);}
  finally{mnlBtn.disabled=false;}
};
})();
