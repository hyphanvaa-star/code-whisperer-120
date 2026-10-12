/* ===== FORM MNL (CAAP flight plan from JetPlan View ICAO) ===== */
(function(){
const mnlBtn=document.createElement('button');
mnlBtn.type='button';mnlBtn.className='btn small';mnlBtn.id='ftMnlBtn';mnlBtn.textContent='FORM MNL';
mnlBtn.title='Tạo FORM MNL (CAAP) từ View ICAO JetPlan cho chuyến đã tick';
$('#ftCkSaveBtn').insertAdjacentElement('afterend',mnlBtn);
function mnlScript(src,name){return window[name]?Promise.resolve():new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(new Error('Không tải được '+src));document.head.appendChild(s);});}
function mnlTime(date,utc){
  const d=String(date||''),u=/(\d{1,2}):?(\d{2})/.exec(String(utc||''));
  let m=/(\d{4})-(\d{2})-(\d{2})/.exec(d),y,mo,da;
  if(m){y=+m[1];mo=+m[2];da=+m[3];}else if((m=/(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d))){da=+m[1];mo=+m[2];y=+m[3];}else return 0;
  return Date.UTC(y,mo-1,da,u?+u[1]:0,u?+u[2]:0);
}
// The ICAO frame is drawn with pdf-lib vectors from a measured layout
// (public/formmnl/icao-layout.json) — html2canvas mis-renders JetPlan's
// negative-offset layout and never paints input values.
let MNL_LAYOUT=null;
async function mnlLayout(){
  if(!MNL_LAYOUT){const r=await fetch('/formmnl/icao-layout.json');if(!r.ok)throw new Error('Không tải được khung FORM MNL');MNL_LAYOUT=await r.json();}
  return MNL_LAYOUT;
}
function mnlValues(html){
  const d=new DOMParser().parseFromString(html,'text/html'),m={};
  for(const i of d.querySelectorAll('input[name]')) m[i.name]=i.value||'';
  return m;
}
async function mnlDrawForm(pdf,vals){
  const L=await mnlLayout();
  const hel=await pdf.embedFont(PDFLib.StandardFonts.Helvetica),helb=await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const cou=await pdf.embedFont(PDFLib.StandardFonts.Courier),coub=await pdf.embedFont(PDFLib.StandardFonts.CourierBold);
  const pg=pdf.addPage([612,792]);
  pg.drawText('CAAP FORM ATS No.2019 -1',{x:40,y:760,size:9,font:cou});
  pg.drawText('FLIGHT PLAN',{x:40,y:749,size:9,font:cou});
  const ctr=(t,f,z,y)=>pg.drawText(t,{x:306-f.widthOfTextAtSize(t,z)/2,y,size:z,font:f});
  ctr('Republic of the Philippines',cou,10,732);ctr('CIVIL AVIATION AUTHORITY OF THE PHILIPPINES',coub,10.5,718);ctr('Old MIA Rd. Pasay City, Metro Manila 1300',hel,10,704);
  const top=96,H=792-top-30,ink=PDFLib.rgb(0,0,0);
  const k=Math.min(540/L.fw,H/L.fh),w=L.fw*k,h=L.fh*k,ox=(612-w)/2,oy=792-top-h;
  const X=x=>ox+x*k,Y=y=>oy+(L.fh-y)*k;
  for(const l of L.lines) pg.drawLine({start:{x:X(l.x1),y:Y(l.y1)},end:{x:X(l.x2),y:Y(l.y2)},thickness:Math.max(.5,l.w*k),color:ink});
  for(const t of L.texts){
    const f=t.b?helb:hel,z=t.fs*k;
    pg.drawText(t.t,{x:X(t.x),y:Y(t.y+t.h)+z*0.18,size:z,font:f,color:ink});
  }
  for(const i of L.inputs){
    const x1=X(i.x),x2=X(i.x+i.w),y1=Y(i.y+i.h),y2=Y(i.y),bd=i.bd||{};
    const edge=(a,b)=>pg.drawLine({start:a,end:b,thickness:.7,color:ink});
    if(bd.t)edge({x:x1,y:y2},{x:x2,y:y2});
    if(bd.b)edge({x:x1,y:y1},{x:x2,y:y1});
    if(bd.l)edge({x:x1,y:y1},{x:x1,y:y2});
    if(bd.r)edge({x:x2,y:y1},{x:x2,y:y2});
    const v=String(vals[i.name]||'').trim();
    if(v){
      let z=(i.fs||10)*k;
      const maxW=i.w*k-4*k,tw=hel.widthOfTextAtSize(v,z);
      if(tw>maxW) z=z*maxW/tw;
      const tx=i.ta==='center'?x1+(i.w*k-hel.widthOfTextAtSize(v,z))/2:x1+2*k;
      pg.drawText(v,{x:tx,y:(y1+y2)/2+z*0.35-z*0.5,size:z,font:hel,color:ink});
    }
  }
  pg.drawRectangle({x:ox-3,y:oy-3,width:w+6,height:h+6,borderWidth:1,borderColor:ink});
  return pg;
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
  // Turn the scanned signature (light strokes on white) into dark ink on
  // transparent, so no filter darkens the white background to grey.
  const sc=document.createElement('canvas');sc.width=sig.width;sc.height=sig.height;
  const sg=sc.getContext('2d');sg.drawImage(sig,0,0);
  const id=sg.getImageData(0,0,sc.width,sc.height),px=id.data;
  for(let i=0;i<px.length;i+=4){
    const lum=px[i]*0.299+px[i+1]*0.587+px[i+2]*0.114;
    const a=Math.min(255,Math.round((255-lum)*2.4));
    px[i]=15;px[i+1]=25;px[i+2]=100;px[i+3]=a;
  }
  sg.putImageData(id,0,0);
  const h=54,w=h*sig.width/sig.height;g.drawImage(sc,655-w/2,142,w,h);
  return new Promise(r=>c.toBlob(r,'image/png'));
}
async function mnlPdf(vals,certPng,lic){
  const cert=await createImageBitmap(await mnlCert(certPng,lic));
  const cc=document.createElement('canvas');cc.width=cert.width;cc.height=cert.height;cc.getContext('2d').drawImage(cert,0,0);
  const pdf=await PDFLib.PDFDocument.create();
  await mnlDrawForm(pdf,vals);
  const img=await pdf.embedPng(cc.toDataURL('image/png'));
  const pg=pdf.addPage([612,792]),top=36,H=720;
  const W=540;let w=W,h=w*cc.height/cc.width;if(h>H){h=H;w=h*cc.width/cc.height;}
  const x=(612-w)/2,y=792-top-h;
  pg.drawImage(img,{x,y,width:w,height:h});
  pg.drawRectangle({x:x-3,y:y-3,width:w+6,height:h+6,borderWidth:1,borderColor:PDFLib.rgb(0,0,0)});
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
    const hd=document.createElement('div');hd.style.cssText='font-size:18px;font-weight:700;margin-bottom:6px;color:var(--vj-dark-ink)';hd.textContent=f.flt+'  |  CFP No: '+f.plan+'  |  Tàu: '+f.reg;
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
      const vals={};for(const i of fr.contentDocument.querySelectorAll('input[name]')) vals[i.name]=i.value||'';
      const blob=await mnlPdf(vals,certPng,li.value.trim());
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name.value.replace(/\.(docx|pdf)$/i,'')+'.pdf';a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    }catch(e){alert('Lỗi xuất PDF: '+e.message);}finally{ex.disabled=false;ex.textContent='Xuất PDF';}};
    sec.append(hd,name,fr,cw,ex);box.appendChild(sec);
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
    await mnlScript('/vendor/jszip.min.js','JSZip');
    for(const leg of legs){
      $('#ftStat').textContent='Đang lấy View ICAO JetPlan '+leg.flt+'…';
      try{
        const r=await fetch('/api/jetplan/icao?flt='+leg.digits+'&t='+leg.t);
        const j=await r.json();
        if(!j || j.error) throw new Error(j&&j.error||('HTTP '+r.status));
        files.push({plan:j.plan,reg:((/REG\/([A-Z0-9]+)/.exec(j.html)||[])[1]||'?'),flt:leg.flt,html:j.html,name:'ATC_FPL_'+leg.flt+'_'+(j.pod||leg.dep)+'-'+(j.poa||leg.arr)+'_'+String(j.etd||leg.date||'').split(',')[0].replace(/[^0-9A-Za-z-]/g,'')+'.pdf'});
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
