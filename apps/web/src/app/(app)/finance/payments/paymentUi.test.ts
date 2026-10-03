import { describe, it, expect } from "vitest";
import {
  canRaiseForApproval,
  hasPaymentHistory,
  formatPaymentRef,
  paymentAmountMinor,
  paymentStatusVariant,
} from "./paymentUi";

describe("paymentStatusVariant (GAP-FINANCE-PAYMENTS-03 / DETAIL-07)", () => {
  it("makes Released/completed green regardless of separator/case", () => {
    expect(paymentStatusVariant("Released")).toBe("good");
    expect(paymentStatusVariant("released")).toBe("good");
    expect(paymentStatusVariant("completed")).toBe("good");
  });
  it("leaves every other status to the shared map", () => {
    expect(paymentStatusVariant("Pending Approval")).toBeUndefined();
    expect(paymentStatusVariant("pending_approval")).toBeUndefined();
    expect(paymentStatusVariant("Failed")).toBeUndefined();
    expect(paymentStatusVariant(undefined)).toBeUndefined();
  });
});

describe("canRaiseForApproval (GAP-FINANCE-PAYMENTS-DETAIL-03)", () => {
  it.each(["released", "Released", "completed", "failed", "Failed", "cancelled", "pending_approval", "Pending Approval"])(
    "is blocked for %s",
    (s) => expect(canRaiseForApproval(s)).toBe(false),
  );
  it.each(["initiated", "Queued", "queued", "pending", "approved"])("is offered for %s", (s) =>
    expect(canRaiseForApproval(s)).toBe(true),
  );
});

describe("formatPaymentRef (GAP-FINANCE-PAYMENTS-DETAIL-06)", () => {
  const id = "5b1c2d3e-0000-4000-8000-00000000abcd";
  it("keeps a real reference unchanged", () => {
    expect(formatPaymentRef("EFT-2026-0042", id)).toBe("EFT-2026-0042");
    expect(formatPaymentRef("PAY-00ABCD", id)).toBe("PAY-00ABCD");
  });
  it("collapses a UUID (or a missing ref + id) to the same PAY- fragment", () => {
    expect(formatPaymentRef(id)).toBe("PAY-00ABCD");
    expect(formatPaymentRef(null, id)).toBe("PAY-00ABCD");
    expect(formatPaymentRef("", id)).toBe("PAY-00ABCD");
  });
  it("renders a dash when there is nothing", () => {
    expect(formatPaymentRef(null)).toBe("—");
  });
});

describe("paymentAmountMinor (GAP-FINANCE-PAYMENTS-05)", () => {
  it("prefers the exact amountMinor", () => {
    expect(paymentAmountMinor({ amountMinor: "999999900", amountDisplay: "₹1.00" })).toBe(999999900n);
  });
  it("falls back to the formatted display string, exactly", () => {
    expect(paymentAmountMinor({ amountDisplay: "₹1,00,00,000.00" })).toBe(1000000000n);
    expect(paymentAmountMinor({ amountDisplay: "₹99,99,999.00" })).toBe(999999900n);
  });
  it("orders 1,00,00,000 after 99,99,999 numerically", () => {
    const a = paymentAmountMinor({ amountDisplay: "₹1,00,00,000.00" })!;
    const b = paymentAmountMinor({ amountDisplay: "₹99,99,999.00" })!;
    expect(a > b).toBe(true);
  });
  it("is exact above 2^53 paise", () => {
    expect(paymentAmountMinor({ amountMinor: "9007199254740993", amountDisplay: "" })).toBe(9007199254740993n);
  });
  it("is null when nothing parses", () => {
    expect(paymentAmountMinor({ amountDisplay: "n/a" })).toBeNull();
  });
});

describe("hasPaymentHistory (fp-finance-02)", () => {
  it("is true only for a context with at least one event", () => {
    expect(hasPaymentHistory(null)).toBe(false);
    expect(hasPaymentHistory(undefined)).toBe(false);
    expect(hasPaymentHistory({ events: [] })).toBe(false);
    expect(hasPaymentHistory({ events: [{ status: "initiated" }] })).toBe(true);
  });
});
