// Browser-safe password rules for the account dialog.
// The backend also blocks passwords found in leaked-password lists, so these
// checks are the floor, not a guarantee — the note in the UI says so.

export const MIN_LEN = 6;

export type PwCheck = { label: string; ok: boolean };

const CLASSES = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

const COMMON = [
  "password", "passwort", "qwerty", "azerty", "letmein", "welcome", "admin",
  "iloveyou", "abc123", "12345678", "123456789", "1234567890", "111111",
  "000000", "dragon", "monkey", "sunshine", "football", "superman", "batman",
  "trustno1", "shadow", "michael", "jennifer", "123qwe", "qwe123", "a1b2c3",
  "passw0rd", "p@ssw0rd", "changeme", "default", "secret", "test123",
];

// 4+ characters walking the keyboard / alphabet / number line forwards or back.
const SEQ = "0123456789abcdefghijklmnopqrstuvwxyz";
function hasRun(v: string): boolean {
  const s = v.toLowerCase();
  for (let i = 0; i + 4 <= s.length; i++) {
    const a = SEQ.indexOf(s[i]);
    if (a < 0) continue;
    if (s.slice(i, i + 4) === SEQ.slice(a, a + 4)) return true;
    if (s.slice(i, i + 4) === SEQ.slice(Math.max(0, a - 3), a + 1).split("").reverse().join("")) return true;
  }
  return false;
}

// Same character 4+ times, or a two-character pair repeated ("abababab").
function hasRepeat(v: string): boolean {
  const s = v.toLowerCase();
  if (/(.)\1{3,}/.test(s)) return true;
  if (/^(..)\1{2,}$/.test(s)) return true;
  return false;
}

// "Abc@1234" — the shape everyone reaches for, and it is already on every list.
const TEMPLATE = /^[A-Z][a-z]{1,4}[!@#$%^&*][0-9]{3,4}$/;

export function passwordChecks(pw: string, username = ""): PwCheck[] {
  void username; void MIN_LEN;
  const digits = /[0-9]/.test(pw);
  const upper = /[A-Z]/.test(pw);
  const lower = /[a-z]/.test(pw);
  return [
    { label: "Có chữ", ok: /[A-Za-z]/.test(pw) },
    { label: "Có số", ok: digits },
    { label: "Có ký tự đặc biệt (! @ # $ ... )", ok: CLASSES.test(pw) },
  ];
}

/** True when the password looks like one a leaked-password check would block. */
export function isPredictable(pw: string): boolean {
  const low = pw.toLowerCase();
  if (!pw) return false;
  if (/^[0-9]+$/.test(pw)) return true;
  if (COMMON.some((c) => low === c || low === c + "!" || low === c + "1" || low === c + "123")) return true;
  if (hasRun(pw) || hasRepeat(pw) || TEMPLATE.test(pw)) return true;
  return false;
}

/** Amber warning shown before sending — the server has the final say. */
export function passwordWarn(pw: string, username = ""): string {
  if (!pw) return "";
  if (isPredictable(pw)) return "Mẫu này quá quen thuộc — hệ thống sẽ từ chối. Thêm chữ/số/ký tự lạ hoặc ghép 3 từ không liên quan.";
  const bad = passwordChecks(pw, username).filter((c) => !c.ok);
  if (bad.length) return "Mật khẩu chưa đạt: " + bad.map((b) => b.label.toLowerCase()).join(", ");
  return "";
}
