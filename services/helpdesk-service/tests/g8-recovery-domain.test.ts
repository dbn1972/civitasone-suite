/**
 * G8 — Service Recovery / Goodwill Entitlement — pure domain logic tests.
 *
 * Covers: eligibility matching, action recommendation, approval authority,
 * amount validation, and status transitions.
 */
import { describe, it, expect } from "vitest";
import {
  isEligibleForRecovery,
  recommendAction,
  canApprove,
  validateAmount,
  canTransition,
  type TicketForRecovery,
  type RecoveryPolicy,
} from "../src/modules/recovery/domain.js";

// --- Helpers ---

function makePolicy(overrides: Partial<RecoveryPolicy> = {}): RecoveryPolicy {
  return {
    id: "policy-1",
    tenantId: "tenant-1",
    severityThreshold: "high",
    productCode: null,
    maxGoodwillMinor: 500000n, // ₹5,000
    currency: "INR",
    requiresApproval: true,
    approverRole: "helpdesk_manager",
    active: true,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<TicketForRecovery> = {}): TicketForRecovery {
  return {
    id: "ticket-1",
    severity: "critical",
    productCode: null,
    ...overrides,
  };
}

// --- isEligibleForRecovery ---

describe("isEligibleForRecovery", () => {
  it("returns policy when ticket severity meets threshold", () => {
    const policies = [makePolicy({ severityThreshold: "high" })];
    const ticket = makeTicket({ severity: "critical" });
    const result = isEligibleForRecovery(ticket, policies);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("policy-1");
  });

  it("returns policy when ticket severity equals threshold exactly", () => {
    const policies = [makePolicy({ severityThreshold: "high" })];
    const ticket = makeTicket({ severity: "high" });
    expect(isEligibleForRecovery(ticket, policies)).not.toBeNull();
  });

  it("returns null when ticket severity is below threshold", () => {
    const policies = [makePolicy({ severityThreshold: "critical" })];
    const ticket = makeTicket({ severity: "high" });
    expect(isEligibleForRecovery(ticket, policies)).toBeNull();
  });

  it("returns null when no policies are active", () => {
    const policies = [makePolicy({ active: false })];
    const ticket = makeTicket({ severity: "critical" });
    expect(isEligibleForRecovery(ticket, policies)).toBeNull();
  });

  it("returns null with empty policy list", () => {
    expect(isEligibleForRecovery(makeTicket(), [])).toBeNull();
  });

  it("returns null for unknown severity", () => {
    const policies = [makePolicy()];
    const ticket = makeTicket({ severity: "unknown" });
    expect(isEligibleForRecovery(ticket, policies)).toBeNull();
  });

  it("prefers product-specific policy over generic", () => {
    const generic = makePolicy({ id: "generic", productCode: null, maxGoodwillMinor: 1000000n });
    const specific = makePolicy({ id: "specific", productCode: "WIDGET", maxGoodwillMinor: 200000n });
    const ticket = makeTicket({ severity: "critical", productCode: "WIDGET" });
    const result = isEligibleForRecovery(ticket, [generic, specific]);
    expect(result?.id).toBe("specific");
  });

  it("skips product-specific policy when ticket has no matching product", () => {
    const specific = makePolicy({ id: "specific", productCode: "WIDGET" });
    const ticket = makeTicket({ severity: "critical", productCode: "OTHER" });
    expect(isEligibleForRecovery(ticket, [specific])).toBeNull();
  });

  it("skips product-specific policy when ticket has no product at all", () => {
    const specific = makePolicy({ id: "specific", productCode: "WIDGET" });
    const ticket = makeTicket({ severity: "critical", productCode: null });
    expect(isEligibleForRecovery(ticket, [specific])).toBeNull();
  });

  it("matches product-specific policy case-insensitively", () => {
    const specific = makePolicy({ id: "specific", productCode: "Widget" });
    const ticket = makeTicket({ severity: "critical", productCode: "widget" });
    expect(isEligibleForRecovery(ticket, [specific])?.id).toBe("specific");
  });

  it("among multiple generic policies, prefers higher maxGoodwillMinor", () => {
    const low = makePolicy({ id: "low", maxGoodwillMinor: 100000n });
    const high = makePolicy({ id: "high", maxGoodwillMinor: 900000n });
    const ticket = makeTicket({ severity: "critical" });
    const result = isEligibleForRecovery(ticket, [low, high]);
    expect(result?.id).toBe("high");
  });

  it("handles severity threshold 'low' — all severities qualify", () => {
    const policies = [makePolicy({ severityThreshold: "low" })];
    expect(isEligibleForRecovery(makeTicket({ severity: "low" }), policies)).not.toBeNull();
    expect(isEligibleForRecovery(makeTicket({ severity: "medium" }), policies)).not.toBeNull();
    expect(isEligibleForRecovery(makeTicket({ severity: "high" }), policies)).not.toBeNull();
    expect(isEligibleForRecovery(makeTicket({ severity: "critical" }), policies)).not.toBeNull();
  });
});

// --- recommendAction ---

describe("recommendAction", () => {
  it("recommends full goodwill credit for critical severity", () => {
    const policy = makePolicy({ maxGoodwillMinor: 500000n });
    const ticket = makeTicket({ severity: "critical" });
    const rec = recommendAction(policy, ticket);
    expect(rec.actionType).toBe("goodwill_credit");
    expect(rec.amountMinor).toBe(500000n);
    expect(rec.policyId).toBe(policy.id);
    expect(rec.currency).toBe("INR");
  });

  it("recommends 50% goodwill credit for high severity", () => {
    const policy = makePolicy({ maxGoodwillMinor: 500000n });
    const ticket = makeTicket({ severity: "high" });
    const rec = recommendAction(policy, ticket);
    expect(rec.actionType).toBe("goodwill_credit");
    expect(rec.amountMinor).toBe(250000n);
  });

  it("recommends at least 1 paise for high severity with small max", () => {
    const policy = makePolicy({ maxGoodwillMinor: 1n });
    const ticket = makeTicket({ severity: "high" });
    const rec = recommendAction(policy, ticket);
    expect(rec.actionType).toBe("goodwill_credit");
    expect(rec.amountMinor).toBe(1n); // 1n / 2n = 0n → floors to 1n minimum
  });

  it("recommends apology communication for medium severity", () => {
    const policy = makePolicy();
    const ticket = makeTicket({ severity: "medium" });
    const rec = recommendAction(policy, ticket);
    expect(rec.actionType).toBe("apology_comm");
    expect(rec.amountMinor).toBeNull();
  });

  it("recommends apology communication for low severity", () => {
    const policy = makePolicy();
    const ticket = makeTicket({ severity: "low" });
    const rec = recommendAction(policy, ticket);
    expect(rec.actionType).toBe("apology_comm");
    expect(rec.amountMinor).toBeNull();
  });

  it("carries the policy currency through", () => {
    const policy = makePolicy({ currency: "USD" });
    const ticket = makeTicket({ severity: "critical" });
    const rec = recommendAction(policy, ticket);
    expect(rec.currency).toBe("USD");
  });
});

// --- canApprove ---

describe("canApprove", () => {
  it("allows super_admin regardless of required role", () => {
    expect(canApprove("helpdesk_manager", ["super_admin"])).toBe(true);
  });

  it("allows helpdesk_admin regardless of required role", () => {
    expect(canApprove("helpdesk_manager", ["helpdesk_admin"])).toBe(true);
  });

  it("allows when approver has the exact required role", () => {
    expect(canApprove("helpdesk_manager", ["helpdesk_manager"])).toBe(true);
  });

  it("rejects when approver lacks the required role", () => {
    expect(canApprove("helpdesk_manager", ["helpdesk_agent"])).toBe(false);
  });

  it("rejects with empty roles array", () => {
    expect(canApprove("helpdesk_manager", [])).toBe(false);
  });

  it("checks among multiple roles correctly", () => {
    expect(canApprove("helpdesk_manager", ["helpdesk_agent", "helpdesk_manager"])).toBe(true);
  });
});

// --- validateAmount ---

describe("validateAmount", () => {
  const policy = makePolicy({ maxGoodwillMinor: 500000n });

  it("returns true for null amount (non-monetary action)", () => {
    expect(validateAmount(null, policy)).toBe(true);
  });

  it("returns true when amount is within limit", () => {
    expect(validateAmount(250000n, policy)).toBe(true);
  });

  it("returns true when amount equals limit exactly", () => {
    expect(validateAmount(500000n, policy)).toBe(true);
  });

  it("returns false when amount exceeds limit", () => {
    expect(validateAmount(500001n, policy)).toBe(false);
  });

  it("returns false for zero amount", () => {
    expect(validateAmount(0n, policy)).toBe(false);
  });

  it("returns false for negative amount", () => {
    expect(validateAmount(-100n, policy)).toBe(false);
  });
});

// --- canTransition ---

describe("canTransition", () => {
  it("pending_approval → approved is valid", () => {
    expect(canTransition("pending_approval", "approved")).toBe(true);
  });

  it("pending_approval → rejected is valid", () => {
    expect(canTransition("pending_approval", "rejected")).toBe(true);
  });

  it("approved → executed is valid", () => {
    expect(canTransition("approved", "executed")).toBe(true);
  });

  it("approved → rejected is invalid", () => {
    expect(canTransition("approved", "rejected")).toBe(false);
  });

  it("rejected → approved is invalid (terminal)", () => {
    expect(canTransition("rejected", "approved")).toBe(false);
  });

  it("executed → any is invalid (terminal)", () => {
    expect(canTransition("executed", "pending_approval")).toBe(false);
    expect(canTransition("executed", "approved")).toBe(false);
  });

  it("pending_approval → executed is invalid (must go through approved)", () => {
    expect(canTransition("pending_approval", "executed")).toBe(false);
  });

  it("pending_approval → pending_approval is invalid (self-transition)", () => {
    expect(canTransition("pending_approval", "pending_approval")).toBe(false);
  });
});
