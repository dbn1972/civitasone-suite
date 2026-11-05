import { describe, it, expect } from "vitest";
import { mapLapseStatement } from "./lapseStatement";

describe("mapLapseStatement (fx-p3)", () => {
  it("keeps paise strings exact and passes the recorded stamp through", () => {
    const m = mapLapseStatement({
      fiscalYear: "2025-26",
      recorded: { recordedAt: "2026-04-01T04:30:00.000Z", recordedBy: "u-1", recordedByName: "Asha Rao" },
      rows: [{ headId: "h1", headCode: "2202", headName: "Education", beMinor: "9007199254740993", reMinor: "1", reappropriationNetMinor: "-9007199254740992", expenditureMinor: "0", lapseMinor: "1", excessMinor: "0" }],
      totals: { beMinor: "9007199254740993", reMinor: "1", expenditureMinor: "0", lapseMinor: "1", excessMinor: "0" },
    })!;
    expect(m.rows[0]!.beMinor).toBe("9007199254740993");
    expect(m.rows[0]!.reappropriationNetMinor).toBe("-9007199254740992");
    expect(m.recorded).toEqual({ recordedAt: "2026-04-01T04:30:00.000Z", recordedBy: "u-1", recordedByName: "Asha Rao" });
  });

  it("a provisional statement has recorded null; missing totals are summed from the rows", () => {
    const m = mapLapseStatement({
      fiscalYear: "2026-27", recorded: null,
      rows: [
        { headId: "a", headCode: "1", headName: "A", beMinor: "100", reMinor: "150", reappropriationNetMinor: "50", expenditureMinor: "120", lapseMinor: "30", excessMinor: "0" },
        { headId: "b", headCode: "2", headName: "B", beMinor: "200", reMinor: "200", reappropriationNetMinor: "0", expenditureMinor: "250", lapseMinor: "0", excessMinor: "50" },
      ],
    })!;
    expect(m.recorded).toBeNull();
    expect(m.totals).toEqual({ beMinor: "300", reMinor: "350", expenditureMinor: "370", lapseMinor: "30", excessMinor: "50" });
  });

  it("rejects a body that is not a lapse statement, and never turns a garbled amount into a float", () => {
    expect(mapLapseStatement(null)).toBeNull();
    expect(mapLapseStatement({ rows: [] })).toBeNull();
    const m = mapLapseStatement({ fiscalYear: "2026-27", recorded: null, rows: [{ headCode: "1", beMinor: "12.5" }], totals: {} })!;
    expect(m.rows[0]!.beMinor).toBe("0");
  });
});
