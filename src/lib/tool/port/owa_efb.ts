// Đọc mã EFB mới nhất từ hộp thư chung OMC (mail "EFB Flysmart Version ...").
// Giá trị dạng EFB-A320F/A330-20261002V0 nằm trong tiêu đề hoặc nội dung mail.
// Thử Outlook REST trực tiếp từ máy chủ trước; khi tenant chặn (ADFS/MFA)
// handler sẽ dự phòng qua trợ lý PC (lệnh owa_efb trong pc_agent.py).
import { OwaAuthError, OwaError, getToken, restGet, restRoot } from "./owa";

export const RE_EFB = /EFB-[A-Z0-9]+(?:[/.-][A-Z0-9]+)*/i;

export interface EfbLatest {
  value: string;
  subject: string;
  when: string | null;
}

export function extractEfbCode(text: string): string | null {
  const m = RE_EFB.exec(text || "");
  return m ? m[0] : null;
}

export async function fetchLatestEfb(): Promise<EfbLatest> {
  const username = process.env["OWA_USERNAME"] || process.env["OUTLOOK_USERNAME"] || "";
  const password = process.env["OWA_PASSWORD"] || process.env["OUTLOOK_PASSWORD"] || "";
  const mailbox = process.env["OUTLOOK_MAILBOX"] || "omc@vietjetair.com";
  if (!username || !password) {
    throw new OwaAuthError("Chưa có tài khoản Outlook — gửi cho quản trị để lưu (OWA_USERNAME/OWA_PASSWORD).");
  }
  const token = await getToken(username, password);
  const root = restRoot(mailbox);
  const url =
    `${root}/mailfolders/inbox/messages` +
    `?$select=Id,Subject,ReceivedDateTime,BodyPreview&$orderby=ReceivedDateTime desc&$top=40`;
  const data = await restGet(token, url, "tìm mail EFB");
  const batch = (data.value as Array<Record<string, unknown>>) ?? [];
  for (const msg of batch) {
    const subject = String(msg.Subject ?? msg.subject ?? "");
    if (!/efb/i.test(subject)) continue;
    const preview = String(msg.BodyPreview ?? msg.bodyPreview ?? "");
    const value = extractEfbCode(subject) || extractEfbCode(preview);
    if (!value) continue;
    const when = msg.ReceivedDateTime ?? msg.receivedDateTime;
    return { value, subject, when: when ? String(when) : null };
  }
  throw new OwaError("Không thấy mail EFB nào trong hộp thư chung.");
}
