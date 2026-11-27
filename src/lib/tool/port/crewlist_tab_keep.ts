// A new Crewlist (manual or AIMS auto-watch) must not pull the dispatcher away
// from the tab they are working in. Only the tabs that display Crewlist results
// follow the upload; everywhere else the comparison runs in the background.
export const CREWLIST_FOLLOW_TABS: readonly string[] = Object.freeze(['general', 'compare', 'version']);

export function crewlistKeepsTab(mode: unknown): boolean {
  return typeof mode === 'string' && mode !== '' && !CREWLIST_FOLLOW_TABS.includes(mode);
}

const DUTY_FROM = '      else setMode("version");\n    }else{\n      setMode("compare");\n    }\n  }catch(err){\n    alert("Lỗi tải file lên: "';
const DUTY_TO = '      else if(!crewlistKeepsTab(mode)) setMode("version");\n    }else{\n'
  + '      if(crewlistKeepsTab(mode)){ try{ Promise.resolve(runCompare()).catch(function(){}); }catch(e){} }\n'
  + '      else setMode("compare");\n    }\n  }catch(err){\n    alert("Lỗi tải file lên: "';

export function patchCrewlistTabKeepPage(html: string): string {
  if (!html.includes(DUTY_FROM)) return html;
  const helper = `<script>var CREWLIST_FOLLOW_TABS=${JSON.stringify(CREWLIST_FOLLOW_TABS)};`
    + 'function crewlistKeepsTab(m){return typeof m==="string"&&m!==""&&CREWLIST_FOLLOW_TABS.indexOf(m)<0;}</script>';
  return html.replace(DUTY_FROM, () => DUTY_TO).replace('</head>', () => `${helper}</head>`);
}
