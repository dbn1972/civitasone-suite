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

// GAP-FINANCE-PAYMENTS-05
describe("mapPayments amountMinor", () => {
  it("keeps an exact digit-string amountMinor and drops a non-numeric one", () => {
    const rows = mapPayments({
      data: [
        { id: "a", referenceId: "R1", beneficiary: "B", amountDisplay: "₹1", amountMinor: "9007199254740993", status: "released" },
        { id: "b", referenceId: "R2", beneficiary: "B", amountDisplay: "₹1", amountMinor: "1.5e3", status: "released" },
        { id: "c", referenceId: "R3", beneficiary: "B", amountDisplay: "₹1", status: "released" },
      ],
    });
    expect(rows?.[0]?.amountMinor).toBe("9007199254740993");
    expect(rows?.[1]).not.toHaveProperty("amountMinor");
    expect(rows?.[2]).not.toHaveProperty("amountMinor");
  });
});
