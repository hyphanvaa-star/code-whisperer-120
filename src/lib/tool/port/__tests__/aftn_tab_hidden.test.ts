import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/tool/page.html", "utf8");
const dbTab = readFileSync("src/tool/database-tab.js", "utf8");
const shim = readFileSync("src/routes/tool-page.ts", "utf8");

describe("AFTN filling tab hidden", () => {
  it("hides the AFTN filling tab button", () => {
    expect(page).toContain('id="mAftn"');
    expect(dbTab).toContain('aftn.style.display = "none"');
    expect(dbTab).toContain('aftn.tabIndex = -1');
  });

  it("keeps the AFTN fields in the page so the KHB TPL export still works", () => {
    expect(page).toContain('id="afDef"');
    expect(page).toContain('id="afBook"');
    const khbExport = page.slice(page.indexOf("const rs=[],seen=new Set();"));
    expect(khbExport.length).toBeGreaterThan(0);
    expect(khbExport).toContain('parse($("#afDef").value)');
    expect(khbExport).toContain('parse($("#afBook").value)');
  });

  it("moves DEFAULT ADDRESS into the Database categories", () => {
    expect(dbTab).toContain('["dbxAftnDef","DEFAULT ADDRESS"');
    expect(dbTab).toContain('document.getElementById("afDef")');
    expect(dbTab).toContain("defPane.appendChild(def)");
    expect(dbTab).toContain('id === "dbxAftnDef"');
  });

  it("still injects the Database tab script", () => {
    expect(shim).toContain("${databaseTabScript}");
  });
});
