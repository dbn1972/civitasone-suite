import { describe, it, expect } from "vitest";
import { mapPayments, normalisePaymentStatus } from "./loaders";

describe("mapPayments (GAP-FINANCE-PAYMENTS-02)", () => {
  it("returns [] (not null) for a valid empty array so an empty register is not an 'error'", () => {
    expect(mapPayments({ data: [] })).toEqual([]);
    expect(mapPayments([])).toEqual([]);
  });
  it("still returns null for a malformed payload", () => {
    expect(mapPayments({ nope: true })).toBeNull();
    expect(mapPayments("x")).toBeNull();
  });
  it("normalises status case/underscores and keeps 'Approved'/'initiated' rows as Queued", () => {
    const rows = mapPayments({
      data: [
        { id: "a", referenceId: "R1", beneficiary: "B", amountDisplay: "₹1", status: "released" },
        { id: "b", referenceId: "R2", beneficiary: "B", amountDisplay: "₹1", status: "pending_approval" },
        { id: "c", referenceId: "R3", beneficiary: "B", amountDisplay: "₹1", status: "Approved" },
      ],
    });
    expect(rows?.map((r) => r.status)).toEqual(["Released", "Pending Approval", "Queued"]);
  });
  it("drops only genuinely unknown statuses", () => {
    expect(normalisePaymentStatus("weird")).toBeNull();
    expect(normalisePaymentStatus(3)).toBeNull();
  });
});
