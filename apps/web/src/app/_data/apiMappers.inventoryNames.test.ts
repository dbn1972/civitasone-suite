import { describe, it, expect } from "vitest";
import { mapGoodsReturnDetail, mapCycleCountDetail } from "./apiMappers";

describe("goods-return detail maps the audit-trail names (GAP-INVENTORY-GOODS-RETURNS-DETAIL-05)", () => {
  const base = { id: "g", originalIssueId: "o", itemId: "i", storeId: "s", qty: 2, reason: "r", qcStatus: "passed", disposition: "restock", createdAt: "2026-08-01" };
  it("carries createdBy and both resolved names", () => {
    expect(mapGoodsReturnDetail({ ...base, createdBy: "u1", createdByName: "Asha Rao", qcInspectedBy: "u2", qcInspectedByName: "Vikram Sethi" }))
      .toMatchObject({ createdBy: "u1", createdByName: "Asha Rao", qcInspectedBy: "u2", qcInspectedByName: "Vikram Sethi" });
  });
  it("leaves names undefined when the service could not resolve them", () => {
    const m = mapGoodsReturnDetail({ ...base, createdBy: "u1", createdByName: null });
    expect(m?.createdByName).toBeUndefined();
    expect(m?.qcInspectedByName).toBeUndefined();
  });
});

describe("cycle-count detail maps approver / rejecter names (GAP-INVENTORY-CYCLE-COUNTS-DETAIL-03)", () => {
  const base = { id: "c", itemId: "i", warehouseId: "w", status: "approved", countedAt: "2026-08-01" };
  it("carries the names", () => {
    expect(mapCycleCountDetail({ ...base, approvedBy: "u1", approvedByName: "Vikram Sethi", rejectedByName: "Asha Rao" }))
      .toMatchObject({ approvedByName: "Vikram Sethi", rejectedByName: "Asha Rao" });
  });
  it("missing name stays undefined (the page renders the id-prefix fallback)", () => {
    expect(mapCycleCountDetail({ ...base, approvedBy: "u1" })?.approvedByName).toBeUndefined();
  });
});
