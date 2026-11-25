import { describe, expect, it } from 'vitest';
import { normalizeKhbWorkspace } from '../khb_workspace';

describe('account-owned KHB draft data', () => {
  it('retains typed PLD, alternates, notes and unresolved/green cells after reopening without a TTL', () => {
    const state = normalizeKhbWorkspace({at: 1, rows:[{id:849,flt:'849',date:'25/11/26',dep:'SGN',arr:'DAD'}],
      edit:{849:{pay:'21500',pldManual:true,talt:'VVDN',alt1:'VVNB',extra:'45',rmk:'Keep this note',chg:{reg:{from:'VN-A648',to:'VN-A580',src:'both',fbOk:false},etd:{to:'11:00',fbOk:true}}}},
      blank:{},dsp:'JACK',efb:'Y',pld:true});
    expect(state?.edit['849']).toMatchObject({pay:'21500',pldManual:true,talt:'VVDN',alt1:'VVNB',extra:'45',rmk:'Keep this note',chg:{reg:{src:'both',fbOk:false},etd:{fbOk:true}}});
    expect(state?.rows[0]).toMatchObject({flt:'849',date:'25/11/26',dep:'SGN',arr:'DAD'});
  });
  it('keeps manually typed flights and notes when no Crewlist is available', () => {
    const state = normalizeKhbWorkspace({rows:[],blank:{0:{flt:'849',rmk:'Waiting for Crewlist'},1:{flt:'',extra:'0',rte:'1',rteAuto:true}}});
    expect(state?.blank).toEqual({'0':{flt:'849',rmk:'Waiting for Crewlist'}});
  });
  it('does not persist another sector edit or executable change-marker controls', () => {
    const state = normalizeKhbWorkspace({rows:[{id:849}],edit:{849:{chg:{reg:{fbOk:false,bolt:{nodeType:1},busy:true,run:()=>true}}},850:{rmk:'unrelated'}}});
    expect(state?.edit).toEqual({'849':{chg:{reg:{fbOk:false}}}});
  });
  it('accepts an explicit empty draft instead of reviving the previous rows', () => {
    expect(normalizeKhbWorkspace({rows:[],edit:{},blank:{}})).toEqual({rows:[],edit:{},blank:{},dsp:'',efb:'',pld:false,extra:'',seq:''});
  });
  it('rejects malformed or unbounded draft rows', () => {
    expect(normalizeKhbWorkspace({rows:'849'})).toBeNull();
    expect(normalizeKhbWorkspace({rows:Array.from({length:1001},()=>({id:849}))})).toBeNull();
  });
});