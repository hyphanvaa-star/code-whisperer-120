import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { patchCmpSyncPage, cmpFplPair } from '../cmp_sync';

it('opens the two latest revisions without switching the current tab', async () => {
  const html = patchCmpSyncPage(readFileSync('src/tool/page.html', 'utf8'));
  const start = html.indexOf('async function cmpVerOpen()');
  const end = html.indexOf('const cmpSyncChecks', start);
  const chosen: Record<string, string> = {};
  let switched = false, opened = false;
  const context = {
    cmpVerOpening:false, vLoadFiles:async () => {},
    vFileList:[{name:'FPL 05 NOV - VER 02.xlsx'},{name:'FPL 05 NOV - VER 04.xlsx'},{name:'FPL 05 NOV - VER 03.xlsx'}],
    cmpFplPair:(files: {name:string}[]) => cmpFplPair(files, Date.parse('2026-11-05T01:00Z')),
    vSetValue:(k:string,v:string) => {chosen[k]=v;}, vPaintMenus:() => {},
    setMode:() => {switched=true;}, vRun:async () => {},
    cmpVerModalShow:() => {opened=true;}, alert:() => {},
    $:() => ({checked:false}),
  };
  await runInNewContext(html.slice(start,end) + '\ncmpVerOpen()',context);
  expect(switched).toBe(false);
  expect(opened).toBe(true);
  expect(chosen).toEqual({old:'FPL 05 NOV - VER 03.xlsx',new:'FPL 05 NOV - VER 04.xlsx'});
});

it.each(['', 'FPL 05 NOV - VER 04.xlsx'])('closing acknowledges only successfully viewed file %s', (read) => {
  const html = patchCmpSyncPage(readFileSync('src/tool/page.html', 'utf8'));
  const start = html.indexOf('function cmpVerModalClose()');
  const script = html.slice(start, html.indexOf('async function cmpVerOpen()',start));
  const context = {document:{getElementById:() => ({open:true,close:() => {}})},
    window:{__verReadFile:read}, $:() => null, cmpVerRestore:null, cmpVerReturnFocus:null,
    verBangAcked:'old', verBangSave:() => {}, paintVerBang:() => {}, fplVerApplied:{new:'FPL 05 NOV - VER 05.xlsx'}};
  runInNewContext(script + '\ncmpVerModalClose()',context);
  expect(context.verBangAcked).toBe(read || 'old');
});