// Port of outlook_web_pib.py's auth/REST surface, adapted for a Cloudflare Worker
// (no Selenium/Chrome/localStorage scraping — those are PC-only). Instead this
// acquires a token via OAuth2 Resource-Owner-Password-Credentials (ROPC) against
// the tenant's Azure AD endpoint using OWA_USERNAME/OWA_PASSWORD or
// OUTLOOK_USERNAME/OUTLOOK_PASSWORD, then calls Outlook REST v2.0 with Bearer auth.
//
// KNOWN BLOCKER (verified against the real vietjetair.com tenant): the mailbox
// accounts are federated to an on-prem ADFS (GetCredentialType → DomainType 4,
// FederationRedirectUrl → sts.vietjetair.com). Azure AD rejects ROPC for such
// accounts with AADSTS50126 regardless of the password's correctness, and EWS
// Basic-Auth (legacy auth) is disabled tenant-wide (401 with no WWW-Authenticate
// challenge). So no pure-fetch path reaches the mailbox today; every handler
// below surfaces that in Vietnamese rather than faking success, per the porting
// brief. If IT either (a) registers an app + client secret for OAuth2 client-
// credentials / application permissions (Mail.Read) on Microsoft Graph, or
// (b) disables ADFS federation / enables an app password for this mailbox, this
// module's `getToken` just needs that new grant — the REST calls are unchanged.

export const OUTLOOK_REST = "https://outlook.office365.com/api/v2.0";
export const GRAPH_TOKEN_SCOPE = "https://graph.microsoft.com/.default offline_access";
// Microsoft first-party public client id ("Azure CLI"), pre-authorized for Graph;
// mirrors graph_pib.py's ALT_CLIENT_IDS["azure-cli"].
const DEFAULT_CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46";

export class OwaError extends Error {}
export class OwaAuthError extends OwaError {
  status?: number;
  stage: string;
  constructor(message: string, opts: { status?: number; stage?: string } = {}) {
    super(message);
    this.status = opts.status;
    this.stage = opts.stage ?? "";
  }
}

/** ``/me`` for the signed-in mailbox, or ``users('box@...')`` for a shared one. */
export function restRoot(mailbox = ""): string {
  const box = (mailbox || "").trim();
  if (box) return `${OUTLOOK_REST}/users('${encodeURIComponent(box)}')`;
  return `${OUTLOOK_REST}/me`;
}

function tenantHint(username: string): string {
  const domain = username.split("@")[1];
  return domain ? domain : "common";
}

/**
 * ROPC token fetch for `username`/`password` against Azure AD. Throws
 * OwaAuthError with a Vietnamese explanation on failure (bad creds, MFA, or —
 * as currently happens for this tenant — ADFS federation rejecting the grant).
 */
export async function getToken(
  username: string,
  password: string,
  opts: { clientId?: string; scope?: string } = {},
): Promise<string> {
  if (!username || !password) {
    throw new OwaAuthError("Chưa có tài khoản Outlook — gửi cho quản trị để lưu (OWA_USERNAME/OWA_PASSWORD).");
  }
  const clientId = opts.clientId ?? DEFAULT_CLIENT_ID;
  const scope = opts.scope ?? GRAPH_TOKEN_SCOPE;
  const tenant = tenantHint(username);
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    username,
    password,
    scope,
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    const desc = String(data.error_description ?? data.error ?? "").split("\n")[0] ?? "";
    let hint = "";
    if (desc.includes("AADSTS50126")) {
      hint = "Sai tài khoản/mật khẩu, hoặc tài khoản dùng đăng nhập liên kết (ADFS) — " +
        "loại này Azure AD từ chối đăng nhập bằng mật khẩu trực tiếp (ROPC); " +
        "cần IT cấp app Azure (client secret, quyền Mail.Read) hoặc tắt liên kết ADFS cho hộp thư này.";
    } else if (desc.includes("AADSTS50076") || desc.includes("AADSTS50079")) {
      hint = "Tài khoản bắt buộc xác thực đa yếu tố (MFA) — không đăng nhập được bằng mật khẩu trực tiếp.";
    } else if (desc.includes("AADSTS65001")) {
      hint = "Cần cấp quyền Mail.Read cho ứng dụng — nhờ IT duyệt (admin consent).";
    }
    throw new OwaAuthError(
      `Đăng nhập Outlook thất bại${desc ? `: ${desc}` : ""}.${hint ? ` ${hint}` : ""}`,
      { status: res.status, stage: "token" },
    );
  }
  return data.access_token;
}

function statusCode(res: Response, stage: string): void {
  if (res.status === 401 || res.status === 403) {
    throw new OwaAuthError(`Phiên Outlook bị từ chối tại ${stage} (HTTP ${res.status}).`, { status: res.status, stage });
  }
  if (res.status >= 400) {
    throw new OwaError(`Outlook REST lỗi tại ${stage} HTTP ${res.status}`);
  }
}

export async function restGet(token: string, url: string, stage: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  statusCode(res, stage);
  return (await res.json()) as Record<string, unknown>;
}

export async function findFolderId(
  token: string,
  name: string,
  opts: { mailbox?: string } = {},
): Promise<{ id: string; name: string }> {
  const root = restRoot(opts.mailbox);
  const target = name.trim().toLowerCase();
  async function walk(folderId = ""): Promise<{ id: string; name: string } | null> {
    const url = folderId ? `${root}/mailfolders/${folderId}/childfolders?$top=100` : `${root}/mailfolders?$top=100`;
    const data = await restGet(token, url, "liệt kê thư mục");
    const rows = (data.value as Array<Record<string, unknown>>) ?? [];
    for (const f of rows) {
      const displayName = String(f.DisplayName ?? f.displayName ?? "");
      if (displayName.trim().toLowerCase() === target) {
        return { id: String(f.Id ?? f.id ?? ""), name: displayName };
      }
    }
    for (const f of rows) {
      if (Number(f.ChildFolderCount ?? f.childFolderCount ?? 0) > 0) {
        const found = await walk(String(f.Id ?? f.id ?? ""));
        if (found) return found;
      }
    }
    return null;
  }
  const found = await walk();
  if (!found) throw new OwaError(`Không thấy thư mục "${name}".`);
  return found;
}
