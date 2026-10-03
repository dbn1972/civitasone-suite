import { describe, it, expect } from "vitest";
import { validateIssueOrder, toIssueOrderBody, ORDER_NO_PATTERN } from "./issueOrder";

const TODAY = "2026-10-03";

describe("validateIssueOrder (GAP-HR-TRANSFER-02)", () => {
  it("accepts a register-style number and today's date", () => {
    expect(validateIssueOrder({ orderNo: "12/2026-Estt", orderDate: TODAY, orderRef: "" }, TODAY)).toEqual([]);
  });
  it("requires an order number and a date", () => {
    expect(validateIssueOrder({ orderNo: "  ", orderDate: "", orderRef: "" }, TODAY)).toEqual(["orderNoRequired", "orderDateRequired"]);
  });
  it("rejects characters outside letters, digits and / . - _ , and over-long numbers", () => {
    for (const bad of ["TO 1", "#5", "-5", "a".repeat(65), "é1"]) {
      expect(validateIssueOrder({ orderNo: bad, orderDate: TODAY, orderRef: "" }, TODAY)).toContain("orderNoFormat");
    }
    expect(ORDER_NO_PATTERN.test("a".repeat(64))).toBe(true);
  });
  it("rejects a future order date but accepts the IST date itself and past dates", () => {
    expect(validateIssueOrder({ orderNo: "1", orderDate: "2026-10-04", orderRef: "" }, TODAY)).toEqual(["orderDateFuture"]);
    expect(validateIssueOrder({ orderNo: "1", orderDate: "2026-10-02", orderRef: "" }, TODAY)).toEqual([]);
  });
  it("builds the body from trimmed typed values only; blank ref is omitted", () => {
    expect(toIssueOrderBody({ orderNo: " 5/26 ", orderDate: TODAY, orderRef: "  " })).toEqual({ orderNo: "5/26", orderDate: TODAY });
    expect(toIssueOrderBody({ orderNo: "5/26", orderDate: TODAY, orderRef: " F1 " })).toEqual({ orderNo: "5/26", orderDate: TODAY, orderRef: "F1" });
  });
});
