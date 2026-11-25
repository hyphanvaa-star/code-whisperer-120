import { afterEach, describe, expect, it } from 'vitest';
import { KHB_ACK_SCRIPT, khbAckGreenChanges } from '../khb_crew_sync';
import { normalizeKhbWorkspace } from '../khb_workspace';

type Change = {fbOk?:boolean; done?:boolean; acked?:boolean};

describe('KHB explicit green acknowledgement', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  it('Ack only consumes the requested confirmed green cell, preserving other green and pending cells', () => {
    const changes:Record<string,Change> = {reg:{fbOk:true},etd:{fbOk:true},cptText:{fbOk:false},foText:{fbOk:false,done:true}};
    expect(khbAckGreenChanges(changes,['reg','reg','cptText','foText'])).toBe(1);
    expect(changes['reg']?.acked).toBe(true);
    for(const key of ['etd','cptText','foText']) expect(changes[key]?.acked).not.toBe(true);
    expect(khbAckGreenChanges(changes,['reg'])).toBe(0);
  });
  it('cell Ack confirms only that green cell without requiring a flight selection', () => {
    document.body.innerHTML='<div id="wrapFplText"><table><tbody><tr><td><input id="reg"></td><td><input id="etd"></td></tr></tbody></table></div>';
    const f={id:901,flt:'901'};
    const reg={key:'reg',fbOk:true,el:document.getElementById('reg')};
    const etd={key:'etd',fbOk:true,el:document.getElementById('etd')};
    const st={on:false,chg:{reg,etd} as Record<string,Change>};
    let saved=0;
    const factory=new Function('document','ftRows','ftSt','ftChgOk','ftRepaintChg','ftKeepLater',KHB_ACK_SCRIPT+';return ftPaintChangeAck;');
    const paint=factory(document,[f],()=>st,(_:unknown,c:Change)=>c.fbOk===true,()=>{},()=>{saved++;}) as (state:typeof st,c:typeof reg,flight:typeof f)=>void;
    paint(st,reg,f); paint(st,etd,f);
    const button=document.querySelector<HTMLButtonElement>('button[aria-label="Ack VJ901 · Tàu"]');
    if(!button) throw new Error('No cell Ack control');
    button.click();
    expect(st.chg['reg']?.acked).toBe(true);
    expect(st.chg['etd']?.acked).not.toBe(true);
    expect(saved).toBe(1);
    button.click();
    expect(saved).toBe(1);
  });
  it('green and Ack receipts survive workspace serialization and reopening for VJ901', () => {
    const input={rows:[{id:901,flt:'901',date:'25/11/26',dep:'HAN',arr:'BKK'}],
      edit:{901:{chg:{reg:{from:'VN-A648',to:'VN-A643',fbOk:true},etd:{from:'12:00',to:'13:00',fbOk:true,acked:true}}}}};
    const reopened=normalizeKhbWorkspace(JSON.parse(JSON.stringify(normalizeKhbWorkspace(input))));
    expect(reopened?.edit['901']).toMatchObject({chg:{reg:{fbOk:true},etd:{fbOk:true,acked:true}}});
  });
});
