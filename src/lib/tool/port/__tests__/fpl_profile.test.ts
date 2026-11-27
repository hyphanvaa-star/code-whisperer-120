import { describe, expect, it } from "vitest";
import { Db, render_fpl } from "../fpl_tool";
import raw from "../../data/fpl_tool.json";
import { renderFpl, type FplDb, type FplFlight, type FplOpts } from "../../../fpl";

const serverDb = new Db(raw);
const serverFlight = { flt: "330", dep: "SGN", arr: "PVG", reg: "VN-A330", ac: "330", etd: "13:00" };

const clientDb: FplDb = {
  tlk: "", dsp: "", legendCpt2: "", legendFo: "", etp: {}, era: {}, tz: {},
  alt: {
    SGNPVG: { etp_pod: "", talt: "", fl: "100,390", etp_poa: "", alt1: "", alt2: "" },
  },
  domestic: [], neo: [], ci: [], suffix: [], taxi: {}, payload: {}, payloadDate: "",
  pcrDep: [], pcrHead: [], pcrGrid: [], pcrReg: {}, source: "",
};
const clientFlight: FplFlight = {
  key: "330", flt: "330", date: "27/11/26", reg: "VN-A330", ac: "330",
  dep: "SGN", arr: "PVG", etdUtc: "0600", staLocal: "",
  cptId: "", cptName: "", cpt2Id: "", cpt2Name: "", foId: "", foName: "",
};
const clientOpts = (fl: string): FplOpts => ({
  extra: "", seq: "1", routeQ: "", etpPoa: "", fl, talt: "", alt1: "", alt2: "",
  rte: "", rmk: "", pcrTo: "", pay: "1", utc: "", dsp: "",
});

function bothReqs(fl: string): string[] {
  return [
    render_fpl(serverDb, serverFlight, { fl }),
    renderFpl(clientDb, clientFlight, clientOpts(fl)),
  ];
}

describe("REQ flight-level profile", () => {
  it("A330 xuất đúng FL 100,390 đã cấu hình thay vì mặc định 100,410", () => {
    for (const text of bothReqs("100,390")) {
      expect(text).toContain("\nPRO÷I,T,M,100,390\n");
      expect(text).not.toContain("PRO÷I,T,M,100,410");
    }
  });

  it("A330 chỉ dùng 100,410 khi FL để trống", () => {
    for (const text of bothReqs("")) {
      expect(text).toContain("\nPRO÷I,T,M,100,410\n");
    }
  });
});
