// Popup "Extra fuel (TAF sân đến)" mở từ ⚙ Filter setting: sửa bảng phút extra theo WX/tầm nhìn/trần/gió.
// Lưu qua /api/extra/cfg (admin = team, người khác = bản riêng), xong tải lại bảng chuyến bay.
export const EXTRA_CFG_JS = `<script>(function(){
var WXK=["NSW","BR","HZ","DU","SA","DZ","RA","SHRA","SH","TS","TSRA","SN","GS","GR","PL","FG","FZFG","FZDZ","FZRA","SS","DS","VA"];
function el(h){var d=document.createElement("div");d.innerHTML=h;return d.firstChild;}
function inp(k,v){return '<input type="number" min="0" style="width:62px" data-x="'+k+'" value="'+v+'">';}
function fill(pop,c){
  var h='<h4>Extra fuel (TAF sân đến)</h4><p>Lấy số phút lớn nhất của 3 mục: thời tiết, trần mây, gió. Không vượt mức tối đa.</p>';
  h+='<div class="nm-assess-more"><label>Tối đa (phút) '+inp("cap",c.cap)+'</label><label>Dấu "−" trừ '+inp("minus",c.minus)+'</label><label>Dấu "+" cộng '+inp("plus",c.plus)+'</label></div>';
  h+='<p style="margin:8px 0 4px"><b>Dải tầm nhìn (m)</b>: A ≥ '+inp("vis0",c.vis[0])+' · B ≥ '+inp("vis1",c.vis[1])+' · C ≥ '+inp("vis2",c.vis[2])+' · D thấp hơn</p>';
  h+='<div style="max-height:34vh;overflow:auto"><table><tr><th>WX</th><th>A</th><th>B</th><th>C</th><th>D</th></tr>';
  WXK.forEach(function(k){var r=c.wx[k]||[0,0,0,0];h+='<tr><td>'+(k==="NSW"?"Không WX":k)+'</td>'+[0,1,2,3].map(function(i){return '<td>'+inp("wx:"+k+":"+i,r[i])+'</td>';}).join("")+'</tr>';});
  h+='</table></div><p style="margin:8px 0 4px"><b>Trần mây</b> (BKN/OVC/VV dưới … ft → phút)</p><div class="nm-assess-more">';
  c.ceil.forEach(function(p,i){h+='<label>&lt; '+inp("ceil:"+i+":0",p[0])+' ft → '+inp("ceil:"+i+":1",p[1])+'</label>';});
  h+='</div><p style="margin:8px 0 4px"><b>Gió</b> (trung bình ≥ … kt hoặc giật ≥ … kt → phút)</p><div class="nm-assess-more">';
  c.wind.forEach(function(p,i){h+='<label>'+inp("wind:"+i+":0",p[0])+' / G'+inp("wind:"+i+":1",p[1])+' → '+inp("wind:"+i+":2",p[2])+'</label>';});
  h+='</div><div class="nm-assess-btns"><button type="button" class="btn t-undo" data-xa="reset">Khôi phục mặc định</button><button type="button" class="btn t-undo" data-xa="close">Đóng</button><button type="button" class="btn t-go" data-xa="save">Lưu</button></div>';
  pop.innerHTML=h;pop._c=c;
}
function read(pop){
  var c=JSON.parse(JSON.stringify(pop._c));
  pop.querySelectorAll("input[data-x]").forEach(function(e){
    var n=Number(e.value);if(e.value===""||!isFinite(n)||n<0)return;var k=e.dataset.x,p=k.split(":");
    if(k==="cap"||k==="minus"||k==="plus")c[k]=n;
    else if(k.indexOf("vis")===0)c.vis[Number(k.slice(3))]=n;
    else if(p[0]==="wx")c.wx[p[1]][Number(p[2])]=n;
    else c[p[0]][Number(p[1])][Number(p[2])]=n;
  });
  return c;
}
function after(){try{if(typeof loadFlights==="function")loadFlights(true,true);}catch(_){}}
async function send(pop,body){
  var r=await fetch("/api/extra/cfg",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  var d=await r.json();if(d.error){alert(d.error);return;}fill(pop,d.cfg);after();
}
window.exFuelCfgOpen=async function(){
  var pop=document.getElementById("exFuelPop");
  if(!pop){pop=el('<div id="exFuelPop" class="nm-assess-pop" hidden></div>');document.body.appendChild(pop);
    pop.addEventListener("click",function(ev){var a=ev.target&&ev.target.dataset&&ev.target.dataset.xa;
      if(a==="close")pop.hidden=true;
      if(a==="reset"&&confirm("Đưa bảng extra fuel về mặc định?"))send(pop,{reset:true});
      if(a==="save")send(pop,{cfg:read(pop)}).then(function(){pop.hidden=true;});
    });}
  var d=await (await fetch("/api/extra/cfg")).json();
  if(d.error){alert(d.error);return;}
  fill(pop,d.cfg);pop.hidden=false;
};
})();</script>`;
