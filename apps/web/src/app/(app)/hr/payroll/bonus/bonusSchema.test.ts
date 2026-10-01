import { describe, it, expect } from "vitest";
import { parseBonusForm } from "./bonusSchema";

const EMP = "44444444-4444-4444-8444-444444444401";
const ok = { employeeId: EMP, fy: "2025-26", basic: "21000", bonusPct: "8.33" };

describe("parseBonusForm (GAP-PAYROLL-BONUS-02/03)", () => {
  it("accepts the statutory bounds 8.33 and 20", () => {
    expect(parseBonusForm(ok)).toMatchObject({ ok: true, payload: { basicMinor: 2100000, bonusPct: 8.33, bonusBps: 833 } });
    expect(parseBonusForm({ ...ok, bonusPct: "20" })).toMatchObject({ ok: true, payload: { bonusBps: 2000 } });
  });

  it.each([["8.32"], ["20.01"], [""], ["NaN"], ["8.333"]])("rejects bonusPct %s", (bonusPct) => {
    expect(parseBonusForm({ ...ok, bonusPct })).toEqual({ ok: false, field: "bonusPct", messageKey: "bonusPctRangeError" });
  });

  it("rejects a non-consecutive FY", () => {
    expect(parseBonusForm({ ...ok, fy: "2025-27" })).toMatchObject({ ok: false, field: "fy" });
  });

  it("rejects a missing or non-uuid employee", () => {
    expect(parseBonusForm({ ...ok, employeeId: null })).toMatchObject({ ok: false, field: "employeeId" });
    expect(parseBonusForm({ ...ok, employeeId: "e1" })).toMatchObject({ ok: false, field: "employeeId" });
  });

  it("converts the basic without float error", () => {
    expect(parseBonusForm({ ...ok, basic: "1234.50" })).toMatchObject({ ok: true, payload: { basicMinor: 123450 } });
    expect(parseBonusForm({ ...ok, basic: "1.005" })).toMatchObject({ ok: false, field: "basic" });
  });
});
