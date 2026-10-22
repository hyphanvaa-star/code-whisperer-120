import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('API account password after saving', () => {
  it('keeps the saved password masked even when the status refresh fails', async () => {
    const raw = readFileSync('src/tool/page.html', 'utf8');
    const shim = readFileSync('src/routes/tool-page.ts', 'utf8');
    const fix = shim.match(/\.replace\('      \$\("#ac"\+pf\+"Pass"\)\.value = "";', `([\s\S]*?)`\)/)?.[1];
    if (!fix) throw new Error('Missing password save correction');
    const source = raw.match(/async function acSave\(kind, pf\)\{[\s\S]*?(?=\/\* mắt xem)/)?.[0];
    if (!source) throw new Error('Missing account save function');
    const eye = { textContent: 'hide' };
    const password = { value: 'NewSecret!72', type: 'text', dataset: {} as Record<string, string>, placeholder: '', parentNode: { querySelector: () => eye } };
    const fields: Record<string, unknown> = {
      '#acFbUser': { value: 'test-dispatcher' }, '#acFbPass': password,
      '#acFbMsg': { className: '', textContent: '' }, '#acFbSave': { disabled: false },
    };
    const save = runInNewContext(source.replace('      $("#ac"+pf+"Pass").value = "";', fix) + '\nacSave', {
      $: (id: string) => fields[id], AC_MASK: '••••••••', AC_SAVE_ONLY: new Set(),
      fetch: async () => ({ json: async () => ({ ok: true }) }),
      acRefresh: () => undefined,
    });
    await save('flitebrief', 'Fb');
    expect(password.value).toBe('••••••••');
    expect(password.type).toBe('password');
    expect(password.dataset).toEqual({ saved: '1', mask: '1' });
  });
});