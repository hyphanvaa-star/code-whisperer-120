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
  it('toolbar Ack affects only ticked flights, never all flights when nothing is selected', () => {
    document.body.innerHTML='<div id="wrapFplText"><button id="ftAckGreen"></button></div>';
    const rows=[{id:901},{id:902}];
    const edits:Record<string,{on:boolean;chg:Record<string,Change>}>={
      901:{on:true,chg:{reg:{fbOk:true},cptText:{fbOk:false}}},
      902:{on:false,chg:{reg:{fbOk:true}}},
    };
    let saved=0;
    const factory=new Function('document','ftRows','ftSt','ftRepaintChg','ftKeepLater', KHB_ACK_SCRIPT+';return ftAckToolbar;');
    const update = factory(document,rows,(f:{id:number})=>edits[String(f.id)],()=>{},()=>{saved++;}) as ()=>void;
    const button=document.querySelector<HTMLButtonElement>('#ftAckGreen');
    if(!button) throw new Error('No Ack control');
    update(); button.click();
    expect(edits['901']?.chg['reg']?.acked).toBe(true);
    expect(edits['901']?.chg['cptText']?.acked).not.toBe(true);
    expect(edits['902']?.chg['reg']?.acked).not.toBe(true);
    expect(saved).toBe(1);
    update(); button.click();
    expect(saved).toBe(1);
  });
  it('with zero selected rows Ack cannot consume an unselected green flight', () => {
    document.body.innerHTML='<div id="wrapFplText"><button id="ftAckGreen"></button></div>';
    const st={on:false,chg:{reg:{fbOk:true}} as Record<string,Change>};
    const factory=new Function('document','ftRows','ftSt',KHB_ACK_SCRIPT+';ftAckToolbar();');
    factory(document,[{id:901}],()=>st);
    document.querySelector<HTMLButtonElement>('#ftAckGreen')?.click();
    expect(st.chg['reg']?.acked).not.toBe(true);
  });
  it('green and Ack receipts survive workspace serialization and reopening for VJ901', () => {
    const input={rows:[{id:901,flt:'901',date:'25/11/26',dep:'HAN',arr:'BKK'}],
      edit:{901:{chg:{reg:{from:'VN-A648',to:'VN-A643',fbOk:true},etd:{from:'12:00',to:'13:00',fbOk:true,acked:true}}}}};
    const reopened=normalizeKhbWorkspace(JSON.parse(JSON.stringify(normalizeKhbWorkspace(input))));
    expect(reopened?.edit['901']).toMatchObject({chg:{reg:{fbOk:true},etd:{fbOk:true,acked:true}}});
  });
});