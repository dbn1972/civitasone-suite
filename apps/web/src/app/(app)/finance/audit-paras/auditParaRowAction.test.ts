import { describe, it, expect } from "vitest";
import { respondHref } from "./auditParaRowAction";

describe("respondHref (GAP-FINANCE-AUDIT-PARAS-05)", () => {
  it("links open and escalated paras to their detail page", () => {
    expect(respondHref("p1", "open", true)).toBe("/finance/audit-paras/p1");
    expect(respondHref("p1", "Escalated", true)).toBe("/finance/audit-paras/p1");
  });
  it("offers nothing for paras that cannot be replied to (responded, settled, dropped, unknown)", () => {
    for (const s of ["responded", "settled", "dropped", "", null, undefined]) expect(respondHref("p1", s, true)).toBeNull();
  });
  it("offers nothing to a user who may not respond, or without an id", () => {
    expect(respondHref("p1", "open", false)).toBeNull();
    expect(respondHref("", "open", true)).toBeNull();
  });
});
