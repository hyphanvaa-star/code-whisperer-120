import { describe, expect, it } from "vitest";
import { mailHtmlWithSignature, SIG_BANNER_CID } from "../mail_signature";
import { BODY } from "../atc_ezfw";

describe("OMC mail signature", () => {
  const html = mailHtmlWithSignature(BODY);
  it("keeps the draft body before the signature", () => {
    expect(html.indexOf("Dear On Duty,")).toBeLessThan(html.indexOf("Thanks, and Best regards!"));
  });
  it("lists the Flight Watch and Dispatcher phone numbers", () => {
    expect(html).toContain("+84 964 090 152 (Flight Watch)");
    expect(html).toContain("+84 985 284 783 (Dispatcher)");
  });
  it("shows the OMC title and the inline banner", () => {
    expect(html).toContain("OPERATION MANAGEMENT CENTER");
    expect(html).toContain(`src="cid:${SIG_BANNER_CID}"`);
  });
});
