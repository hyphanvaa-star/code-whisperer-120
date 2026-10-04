import type { Jobs, Routes } from "../types";
import { AVIWEB_NOT_PORTABLE_MESSAGE, readFplBlocks, fplName } from "../port/aviweb";

// Port of the web.py "/api/atc/*" group (atcfpl.py + atc_check.py).
//
// AviWeb only exposes its FPL Manager / login through the Vaadin 7 UIDL RPC
// protocol — there is no plain HTTP endpoint for it (see ../port/aviweb.ts for
// the reconnaissance notes). The original tool drives a real Chrome window
// with Selenium for every one of these endpoints (list uploaded files just to
// pick one to submit, upload+parse a file to stage it for submission, submit
// FPL blocks to AviWeb, and check FPL status on AviWeb). None of that can run
// in a Cloudflare Worker, so every endpoint here reports the same honest
// blocked reason instead of faking success — per the porting brief's
// "missing credential / PC helper" rule for features that truly need a real
// browser.
//
// "/api/atc/upload" and "/api/atc/files" do have a pure, portable half (parsing
// the uploaded ATC text file into FPL blocks via readFplBlocks/fplName), so we
// still do that parsing here — it is exactly the data the original list/upload
// screens show — but there is nowhere to actually submit or check those blocks
// against AviWeb, so submit/check always report the blocked message.

export const routes: Routes = {
  "GET /api/atc/files": async () => {
    // web.py lists previously-uploaded ATC files from local disk (data dir on the
    // dispatcher's PC). That directory does not exist in this runtime; nothing was
    // ever uploaded here either, so the honest list is empty.
    return { files: [], error: AVIWEB_NOT_PORTABLE_MESSAGE };
  },

  "POST /api/atc/upload": async (ctx) => {
    const buf = await ctx.request.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buf);
    const blocks = readFplBlocks(text);
    if (!blocks.length) {
      return { error: "Không đọc được block FPL nào trong file." };
    }
    const header = ctx.request.headers.get("X-Filename") || "";
    const name = header ? decodeURIComponent(header) : "ATC.txt";
    // Parsing works fully offline; only the "submit this to AviWeb" step needs a
    // real browser, so we report that honestly instead of pretending the file is
    // staged somewhere a later submit could reach it.
    return {
      path: "",
      name,
      size: buf.byteLength,
      blocks: blocks.length,
      flights: blocks.map((b) => fplName(b)),
      error: AVIWEB_NOT_PORTABLE_MESSAGE,
    };
  },

  "GET /api/atc/reg-context": async () => {
    return { available: false, error: AVIWEB_NOT_PORTABLE_MESSAGE, file: "", sheet: "", by_sector: {} };
  },

  "POST /api/atc/submit": async () => {
    return { error: AVIWEB_NOT_PORTABLE_MESSAGE };
  },

  "POST /api/atc/check": async () => {
    return { error: AVIWEB_NOT_PORTABLE_MESSAGE };
  },
};

export const jobs: Jobs = {};
