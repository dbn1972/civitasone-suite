import { describe, it, expect } from "vitest";
import { BILLING_INVOICE_OPERATOR_ROLES } from "@/lib/auth/adminRoles";
import { isSettleableStatus, mapBillingSettings, parseReminderDays, mapOfflinePayments, mapReminderStatus, normaliseReference, opsErrorKey, todayInIndia, validateOfflineForm } from "./invoiceOps";

const ok = { mode: "neft" as const, reference: "sbin 5233 4567 8901", paidOn: "2026-09-20", reason: "NEFT received" };

// GAP-ADMIN-INVOICES-06
describe("validateOfflineForm", () => {
  it("accepts a well-formed request (reference is normalised first)", () => {
    expect(validateOfflineForm(ok, "2026-10-03", "2026-09-01")).toEqual({});
    expect(normaliseReference(" sbin 5233 ")).toBe("SBIN5233");
  });
  it("checks the reference per mode", () => {
    expect(validateOfflineForm({ ...ok, reference: "12345" }, "2026-10-03", "2026-09-01").reference).toBe("reference");
    expect(validateOfflineForm({ ...ok, mode: "cheque", reference: "123456" }, "2026-10-03", "2026-09-01")).toEqual({});
    expect(validateOfflineForm({ ...ok, mode: "rtgs", reference: "SBIN523345678901" }, "2026-10-03", "2026-09-01").reference).toBe("reference");
    expect(validateOfflineForm({ ...ok, mode: "dd", reference: "1234567890123" }, "2026-10-03", "2026-09-01").reference).toBe("reference");
  });
  it("checks the date: required, not future, not before the invoice", () => {
    expect(validateOfflineForm({ ...ok, paidOn: "" }, "2026-10-03", "2026-09-01").paidOn).toBe("paidOnRequired");
    expect(validateOfflineForm({ ...ok, paidOn: "2026-10-04" }, "2026-10-03", "2026-09-01").paidOn).toBe("paidOnFuture");
    expect(validateOfflineForm({ ...ok, paidOn: "2026-08-31" }, "2026-10-03", "2026-09-01").paidOn).toBe("paidOnBefore");
  });
  it("needs a reason of 3 characters", () => {
    expect(validateOfflineForm({ ...ok, reason: " x " }, "2026-10-03", "2026-09-01").reason).toBe("reasonShort");
  });
});

describe("mappers and helpers", () => {
  it("maps the payments list and rejects a body that is not one", () => {
    const rows = mapOfflinePayments({ data: [{ id: "a", mode: "neft", reference: "X", paidOn: "2026-09-20", amountMinor: "250050", reason: "r", status: "pending", requestedByMe: true, canDecide: false, createdAt: "t" }] });
    expect(rows?.[0]).toMatchObject({ id: "a", amountMinor: "250050", requestedByMe: true, canDecide: false, decisionReason: null });
    expect(mapOfflinePayments({})).toBeNull();
    expect(mapOfflinePayments({ data: [{ amountMinor: "12.5" }] })?.[0]?.amountMinor).toBe("0");
  });
  it("maps the reminder status", () => {
    expect(mapReminderStatus({ data: { lastSentAt: "t", nextAllowedAt: null, count: 2 } })).toEqual({ lastSentAt: "t", nextAllowedAt: null, count: 2 });
    expect(mapReminderStatus({})).toBeNull();
  });
  it("only unpaid live invoices are settleable", () => {
    for (const s of ["issued", "partially_paid", "overdue"]) expect(isSettleableStatus(s)).toBe(true);
    for (const s of ["paid", "cancelled", "waived", "draft"]) expect(isSettleableStatus(s)).toBe(false);
  });
  it("maps error codes to catalogue keys, with status fallbacks", () => {
    expect(opsErrorKey(409, "DUPLICATE_REFERENCE")).toBe("err_DUPLICATE_REFERENCE");
    expect(opsErrorKey(422, "NO_RECIPIENTS")).toBe("err_NO_RECIPIENTS");
    expect(opsErrorKey(429, "REMINDER_RATE_LIMITED")).toBe("err_REMINDER_RATE_LIMITED");
    expect(opsErrorKey(403, "FORBIDDEN")).toBe("err_FORBIDDEN");
    expect(opsErrorKey(422, "VALIDATION_FAILED")).toBe("err_VALIDATION");
    expect(opsErrorKey(500, "INTERNAL")).toBe("err_GENERIC");
  });
  it("today is the Indian calendar date", () => {
    expect(todayInIndia(new Date("2026-10-03T20:00:00Z"))).toBe("2026-10-04");
  });
});

describe("settings helpers and roles", () => {
  it("operators are platform staff only; billing_admin and tenant_admin are not", () => {
    expect([...BILLING_INVOICE_OPERATOR_ROLES].sort()).toEqual(["platform_admin", "super_admin"]);
    expect(BILLING_INVOICE_OPERATOR_ROLES).not.toContain("billing_admin");
    expect(BILLING_INVOICE_OPERATOR_ROLES).not.toContain("tenant_admin");
  });
  it("maps billing settings and rejects a body that is not one", () => {
    expect(mapBillingSettings({ data: { offlineMakerChecker: false, reminderOverdueDays: 30, pendingMakerCheckerRequest: null } }))
      .toEqual({ offlineMakerChecker: false, reminderOverdueDays: 30, pendingMakerCheckerRequest: null });
    expect(mapBillingSettings({ data: {} })).toBeNull();
    expect(mapBillingSettings({})).toBeNull();
  });
  it("parses the reminder days: empty off, 1..365, else invalid", () => {
    expect(parseReminderDays("")).toBeNull();
    expect(parseReminderDays(" 30 ")).toBe(30);
    for (const bad of ["0", "366", "-1", "1.5", "abc", "1e2"]) expect(parseReminderDays(bad), bad).toBeUndefined();
  });
});
