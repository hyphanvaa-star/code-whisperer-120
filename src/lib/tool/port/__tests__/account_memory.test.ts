import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_MEMORY_SCRIPT, patchAccountMemoryPage } from '../account_memory';

function harness() {
  let uid = 'hyphan-id';
  const stored = new Map<string, string>();
  document.body.innerHTML = ['Fb','Omni','Outlook','Owa','Aviweb','Opscore'].map(pf => `<input id="ac${pf}User"><div><input id="ac${pf}Pass"></div><input id="ac${pf}Box"><span id="ac${pf}Src"></span><span id="ac${pf}Msg"></span>`).join('') + '<span id="accWho"></span><span id="btnAcc"></span>';
  const context = {
    window: { parent: { __fbUserId: () => uid } },
    localStorage: { getItem: (key: string) => stored.get(key), setItem: (key: string, value: string) => stored.set(key, value) },
    $: (selector: string) => document.querySelector(selector),
    AC_MASK: '••••••••', AC_DEF_USER: {},
    fetch: async () => ({ ok: true, json: async () => ({ accounts: {flitebrief: {username: 'test-flight', source: 'file', has_password: true, password: 'must-not-store'}} }) }),
  };
  const api = runInNewContext(ACCOUNT_MEMORY_SCRIPT + '\n({acRestore,acRefresh,acRememberSaved})', context);
  return {api, context, stored, switchUser: (id: string) => { uid = id; }, field: (id: string) => document.getElementById(id) as HTMLInputElement};
}

describe('per-user remembered account metadata', () => {
  it('restores the saved username immediately on reopening, with only a password mask', async () => {
    const h = harness(); await h.api.acRefresh();
    h.field('acFbUser').value = '';
    h.api.acRestore();
    expect(h.field('acFbUser').value).toBe('test-flight');
    expect(h.field('acFbPass').value).toBe('••••••••');
    expect(JSON.parse(h.stored.get('sohee:accounts:v1:hyphan-id') || '{}').flitebrief).toEqual({ username: 'test-flight', mailbox: '', source: 'file', has_password: true });
  });
  it('does not show another user remembered accounts', async () => {
    const h = harness(); await h.api.acRefresh(); h.switchUser('other-user'); h.api.acRestore();
    expect(h.field('acFbUser').value).toBe('');
    expect(h.field('acFbPass').value).toBe('');
  });
  it('keeps remembered values if the server cannot be reached', async () => {
    const h = harness(); await h.api.acRefresh();
    h.context.fetch = async () => { throw new Error('offline'); };
    await h.api.acRefresh();
    expect(h.field('acFbUser').value).toBe('test-flight');
    expect(h.field('acFbPass').dataset.saved).toBe('1');
  });
  it('does not overwrite edits while loading saved accounts', async () => {
    const h = harness(); h.api.acRestore();
    h.field('acFbUser').value = 'new-flight'; h.field('acFbUser').dispatchEvent(new Event('input'));
    await h.api.acRefresh();
    expect(h.field('acFbUser').value).toBe('new-flight');
  });
  it('ignores an old response after the current user changes', async () => {
    const h = harness();
    let release: (() => void) | undefined;
    const response = h.context.fetch;
    h.context.fetch = async () => { await new Promise<void>(resolve => { release = resolve; }); return response(); };
    const pending = h.api.acRefresh(); h.switchUser('other-user'); h.api.acRestore(); release?.(); await pending;
    expect(h.field('acFbUser').value).toBe('');
    expect(h.stored.size).toBe(0);
  });
  it('remembers only confirmed successful saves, without persisting the entered password', () => {
    const h = harness(); h.api.acRestore();
    h.field('acFbUser').value = 'new-flight'; h.field('acFbPass').value = 'secret-test-value';
    h.api.acRememberSaved('flitebrief', 'Fb', true);
    const cached = h.stored.get('sohee:accounts:v1:hyphan-id') || '';
    expect(JSON.parse(cached).flitebrief.username).toBe('new-flight');
    expect(cached).not.toContain('secret-test-value');
  });
  it('keeps embedded scripts valid after the account shim', () => {
    const page = patchAccountMemoryPage(readFileSync('src/tool/page.html', 'utf8'));
    for(const script of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) expect(() => new Script(script[1] || '')).not.toThrow();
  });
});