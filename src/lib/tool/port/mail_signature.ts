// Chữ ký OMC chèn cuối thư nháp Outlook Web (ATC + EZFW).
// Outlook chỉ tự gắn chữ ký khi soạn trên giao diện; nháp tạo qua REST thì
// không có, nên web tự ráp thân thư HTML + banner inline (cid:) ở đây.
export const SIG_BANNER_CID = "omc_signature_banner";

export interface MailSignature {
  closing: string;
  title: string;
  phones: { number: string; label: string }[];
  website: string;
}

export const OMC_SIGNATURE: MailSignature = {
  closing: "Thanks, and Best regards!",
  title: "OPERATION MANAGEMENT CENTER",
  phones: [
    { number: "+84 964 090 152", label: "Flight Watch" },
    { number: "+84 985 284 783", label: "Dispatcher" },
  ],
  website: "www.vietjetair.com",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = "font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt";
const BLUE = "#174e86";
const RED = "#ed5c57";

/** Thân thư text (giữ xuống dòng) + chữ ký OMC + banner inline cid. */
export function mailHtmlWithSignature(bodyText: string, sig: MailSignature = OMC_SIGNATURE, banner?: { width: number; height: number }): string {
  const body = esc(bodyText.replace(/\s+$/, "")).replace(/\r?\n/g, "<br>");
  const phones = sig.phones.map(p =>
    `<a href="tel:${esc(p.number.replace(/\s+/g, ""))}" style="color:${BLUE}">Tel:</a><span style="color:${BLUE}"> ${esc(p.number)} (${esc(p.label)})</span>`,
  ).join("<br>");
  const size = banner ? ` width="${banner.width}" height="${banner.height}"` : "";
  return `<html><body><div style="${FONT};color:#000">${body}<br><br>`
    + `${esc(sig.closing)}<br><br>`
    + `<b style="color:${RED};font-size:12pt">${esc(sig.title)}</b><br><br>`
    + `${phones}<br>`
    + `<a href="https://${esc(sig.website)}" style="color:${BLUE};font-style:italic">${esc(sig.website)}</a><br>`
    + `<img src="cid:${SIG_BANNER_CID}" alt="Vietjet"${size} style="display:block;border:0;max-width:100%">`
    + `</div></body></html>`;
}
