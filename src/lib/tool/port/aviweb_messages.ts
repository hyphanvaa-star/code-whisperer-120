/** Browser-safe structured CHG/DLA editor; deliberately separate from legacy ATC exports. */
export type AviOperation = 'DLA' | 'CHG';
export interface AviToken { code: string; value: string }
export interface AviMessage {
  kind: AviOperation; callsign: string; dep: string; arr: string; dof: string; eobt: string;
  aircraft: string; wake: string; equipment: string; surveillance: string; tokens: AviToken[];
}
export interface AviExpected { callsign: string; dep: string; arr: string; dof: string; reg: string }

/** Inline this complete factory in the isolated tool document, not an independent parser. */
export function aviwebMessageTools() {
  const normReg = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const hhmm = (v: string) => /^(?:[01]\d|2[0-3])[0-5]\d$/.test(v);
  function tokens(text: string): AviToken[] {
    const result: AviToken[] = [];
    for (const word of text.replace(/\s+/g, ' ').trim().toUpperCase().split(' ')) {
      if (!word) continue;
      const hit = /^([A-Z]{2,8})\/(.*)$/.exec(word);
      if (hit) result.push({ code: hit[1] ?? '', value: hit[2] ?? '' });
      else {
        const last = result[result.length - 1];
        if (!last) throw new Error('Field 18 thiếu mã TOKEN/GIÁ TRỊ.');
        last.value += ' ' + word;
      }
    }
    return result;
  }
  function validate(m: AviMessage, expected?: AviExpected): void {
    if (!['DLA', 'CHG'].includes(m.kind)) throw new Error('Chỉ nhận DLA hoặc CHG AviWeb.');
    if (!/^[A-Z0-9]{2,12}$/.test(m.callsign) || !/^[A-Z]{4}$/.test(m.dep) || !/^[A-Z]{4}$/.test(m.arr)) throw new Error('Callsign hoặc chặng không hợp lệ.');
    if (!/^\d{6}$/.test(m.dof)) throw new Error('Thiếu DOF đúng ngày chuyến.');
    const date = new Date(Date.UTC(2000 + Number(m.dof.slice(0, 2)), Number(m.dof.slice(2, 4)) - 1, Number(m.dof.slice(4, 6))));
    if (date.toISOString().slice(2, 10).replace(/-/g, '') !== m.dof) throw new Error('DOF không hợp lệ.');
    if (!hhmm(m.eobt)) throw new Error('EOBT UTC phải gồm 4 số từ 0000 đến 2359.');
    if (expected && ['callsign', 'dep', 'arr', 'dof'].some(k => m[k as 'callsign' | 'dep' | 'arr' | 'dof'] !== expected[k as 'callsign' | 'dep' | 'arr' | 'dof'])) throw new Error('Điện không khớp callsign/ngày/chặng của bản soạn.');
    if (m.kind === 'DLA') return;
    if (!/^[A-Z0-9]{2,4}$/.test(m.aircraft) || !/^[LMHJ]$/.test(m.wake)) throw new Error('Loại tàu hoặc wake không hợp lệ.');
    if (!/^[A-Z0-9]{1,80}$/.test(m.equipment) || !/^[A-Z0-9]{1,40}$/.test(m.surveillance)) throw new Error('Equipment/surveillance không hợp lệ.');
    const seen = new Set<string>();
    const allowed = new Set('STS PBN NAV COM DAT SUR DEP DEST DOF REG EET SEL TYP CODE DLE OPR ORGN PER ALTN RALT TALT RIF RMK'.split(' '));
    for (const t of m.tokens) {
      if (!allowed.has(t.code) || seen.has(t.code) || !t.value.trim() || t.value.length > 1500 || /[()\r\n<>]|(?:^|\s)[A-Z]{2,8}\//.test(t.value)) throw new Error('Token field 18 trống, trùng mã hoặc sai cấu trúc.');
      seen.add(t.code);
    }
    if (m.tokens.find(t => t.code === 'DOF')?.value !== m.dof) throw new Error('DOF field 18 phải giữ nguyên ngày chuyến.');
    const reg = m.tokens.find(t => t.code === 'REG')?.value ?? '';
    if (!normReg(reg) || (expected && normReg(reg) !== normReg(expected.reg))) throw new Error('REG ATC không khớp REG Crewlist/DayRep.');
  }
  function serialize(m: AviMessage): string {
    validate(m);
    const head = `(${m.kind}-${m.callsign}-${m.dep}${m.eobt}-${m.arr}-DOF/${m.dof}`;
    if (m.kind === 'DLA') return head + ')';
    return [head, `-9/${m.aircraft}/${m.wake}`, `-10/${m.equipment}/${m.surveillance}`, `-13/${m.dep}${m.eobt}`, '-18/' + m.tokens.map(t => t.code + '/' + t.value.trim().toUpperCase()).join(' ') + ')'].join('\r\n');
  }
  function parse(content: string, operation: AviOperation): AviMessage[] {
    const text = content.replace(/\r/g, '').trim();
    if (!text || text.length > 200000) throw new Error('Nội dung điện trống hoặc quá lớn.');
    const blocks = text.match(/\([^()]*\)/g) ?? [];
    if (!blocks.length || text.replace(/\([^()]*\)/g, '').trim()) throw new Error('Nội dung ngoài điện hoặc sai cấu trúc ngoặc.');
    return blocks.map(block => {
      const lines = block.slice(0, -1).split('\n');
      const h = /^\((DLA|CHG)-([A-Z0-9]+)-([A-Z]{4})(\d{4})-([A-Z]{4})-DOF\/(\d{6})$/.exec(lines[0] ?? '');
      if (!h || h[1] !== operation) throw new Error('Preview chứa sai loại điện hoặc header không hợp lệ.');
      const m: AviMessage = { kind: operation, callsign: h[2] ?? '', dep: h[3] ?? '', eobt: h[4] ?? '', arr: h[5] ?? '', dof: h[6] ?? '', aircraft: '', wake: '', equipment: '', surveillance: '', tokens: [] };
      if (operation === 'DLA') { if (lines.length !== 1) throw new Error('DLA chỉ được sửa EOBT, không thêm field.'); }
      else {
        const f: Record<string, string> = {};
        for (const line of lines.slice(1)) {
          const field = /^-(9|10|13|18)\/(.+)$/.exec(line);
          if (!field || f[field[1] ?? ''] !== undefined) throw new Error('CHG chỉ nhận field 9, 10, 13, 18, mỗi field một lần.');
          f[field[1] ?? ''] = field[2] ?? '';
        }
        if (Object.keys(f).length !== 4 || f['13'] !== m.dep + m.eobt) throw new Error('CHG thiếu field hoặc EOBT header và field 13 không khớp.');
        const a = (f['9'] ?? '').split('/'), e = (f['10'] ?? '').split('/');
        if (a.length !== 2 || e.length !== 2) throw new Error('Field 9/10 sai cấu trúc.');
        m.aircraft = a[0] ?? ''; m.wake = a[1] ?? ''; m.equipment = e[0] ?? ''; m.surveillance = e[1] ?? ''; m.tokens = tokens(f['18'] ?? '');
      }
      validate(m); return m;
    });
  }
  function validateBatch(operation: AviOperation, content: string, expected: AviExpected[]): { messages: AviMessage[]; content: string } {
    const messages = parse(content, operation);
    if (!expected.length || messages.length !== expected.length || new Set(expected.map(e => e.callsign)).size !== expected.length || new Set(messages.map(e => e.callsign)).size !== messages.length) throw new Error('Không được thêm, bỏ hoặc trùng callsign trong bản soạn.');
    for (const m of messages) {
      const e = expected.find(e => e.callsign === m.callsign);
      if (!e) throw new Error('Callsign không thuộc bản soạn.');
      validate(m, e);
    }
    return { messages, content: messages.map(serialize).join('\r\n\r\n') + '\r\n' };
  }
  return { tokens, parse, serialize, validate, validateBatch, hhmm, normReg };
}

/** Mirrors the uploaded parse_fpl_items + aviweb_legacy_package, without route conversions. */
export function aviMessageFromFpl(operation: AviOperation, block: string, eobt: string, expected: AviExpected): AviMessage {
  const tools = aviwebMessageTools();
  const parts = block.replace(/\r/g, '').trim().replace(/^\(/, '').replace(/\)$/, '').split(/\n\s*-/);
  const head = (parts[0] ?? '').split('-');
  const equipment = (parts[1] ?? '').trim().split('-');
  const item9 = (equipment[0] ?? '').split('/'), item10 = (equipment[1] ?? '').split('/');
  const item13 = (parts[2] ?? '').replace(/\s+/g, ''), item16 = (parts[4] ?? '').trim();
  const toks = tools.tokens(parts[5] ?? '');
  if (head[0] !== 'FPL' || parts.length < 6 || head[1] !== expected.callsign || item13.slice(0, 4) !== expected.dep || item16.slice(0, 4) !== expected.arr || toks.find(t => t.code === 'DOF')?.value !== expected.dof) throw new Error('Không đọc được FPL hiện hành đúng chuyến/ngày/chặng.');
  const m: AviMessage = { kind: operation, ...expected, eobt, aircraft: item9[0] ?? '', wake: item9[1] ?? '', equipment: item10[0] ?? '', surveillance: item10[1] ?? '', tokens: toks };
  tools.validate(m, expected); return m;
}

export const AVI_PLAN_TTL_MS = 15 * 60_000;
export function assertAviPlanOwner(plan: { id: string; owner: string; expires_at: number }, id: string, owner: string, now = Date.now()): void {
  if (plan.id !== id || plan.owner !== owner || !owner) throw new Error('Bản soạn không thuộc tài khoản đang đăng nhập.');
  if (plan.expires_at <= now) throw new Error('Bản soạn đã hết hạn; lấy nguồn và xác nhận lại.');
}