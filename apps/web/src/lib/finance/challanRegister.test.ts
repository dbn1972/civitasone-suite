import { describe, it, expect } from "vitest";
import { challanStatusCounts, formatReceiptHead } from "./challanRegister";

describe("challanStatusCounts (GAP-FINANCE-REVENUE-CHALLANS-03)", () => {
  it("counts each real status separately; rejected-like statuses are not Pending", () => {
    const c = challanStatusCounts([
      { status: "pending" }, { status: "deposited" }, { status: "reconciled" }, { status: "rejected" },
    ]);
    expect(c).toEqual({ total: 4, pending: 1, deposited: 1, reconciled: 1, other: 1 });
  });
  it("cards sum to total, case/space insensitive, missing status is other", () => {
    const c = challanStatusCounts([{ status: " Pending " }, { status: "DEPOSITED" }, {}, { status: null }]);
    expect(c.pending + c.deposited + c.reconciled + c.other).toBe(c.total);
    expect(c).toMatchObject({ pending: 1, deposited: 1, other: 2 });
  });
});

describe("formatReceiptHead (GAP-FINANCE-REVENUE-CHALLANS-02 / DETAIL-03)", () => {
  it("renders CODE - Name", () => {
    expect(formatReceiptHead("0040", "Tax Revenue")).toBe("0040 - Tax Revenue");
  });
  it("shows a dash, never the uuid, when no head is resolved", () => {
    expect(formatReceiptHead(null, null)).toBe("\u2014");
    expect(formatReceiptHead(undefined, " ")).toBe("\u2014");
  });
  it("shows whichever half is present", () => {
    expect(formatReceiptHead("0040", null)).toBe("0040");
    expect(formatReceiptHead(null, "Tax Revenue")).toBe("Tax Revenue");
  });
});
