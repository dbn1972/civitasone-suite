/**
 * G9 Win-back cadence engine — domain logic tests.
 *
 * Covers: shouldEnroll, matchesCriteria, advanceStep, canCancel,
 * recordOutcome, validateSteps, validateTriggerCriteria.
 */
import { describe, it, expect } from "vitest";
import {
  shouldEnroll,
  matchesCriteria,
  advanceStep,
  canCancel,
  recordOutcome,
  validateSteps,
  validateTriggerCriteria,
  CADENCE_STATUSES,
  ENROLLMENT_STATUSES,
  OUTCOMES,
  type AccountContext,
} from "../src/modules/winback/domain.js";
import type { CadenceStep, TriggerCriteria } from "../src/modules/winback/schema.js";

// ── shouldEnroll ────────────────────────────────────────────────────────────

describe("shouldEnroll", () => {
  const activeCadence = {
    id: "cad-1",
    status: "active" as const,
    triggerCriteria: { inactiveDays: 90, declinePct: 30, hasRecentComplaint: true },
  };

  it("returns cadence id when account matches an active cadence", () => {
    const account: AccountContext = { inactiveDays: 100, declinePct: 40, hasRecentComplaint: true };
    expect(shouldEnroll(account, [activeCadence])).toBe("cad-1");
  });

  it("returns null when no cadence matches", () => {
    const account: AccountContext = { inactiveDays: 30, declinePct: 10, hasRecentComplaint: false };
    expect(shouldEnroll(account, [activeCadence])).toBeNull();
  });

  it("skips non-active cadences", () => {
    const account: AccountContext = { inactiveDays: 100, declinePct: 40, hasRecentComplaint: true };
    const draftCadence = { ...activeCadence, status: "draft" as const };
    expect(shouldEnroll(account, [draftCadence])).toBeNull();
  });

  it("returns the first matching cadence when multiple match", () => {
    const account: AccountContext = { inactiveDays: 100, declinePct: 50, hasRecentComplaint: true };
    const second = { ...activeCadence, id: "cad-2" };
    expect(shouldEnroll(account, [activeCadence, second])).toBe("cad-1");
  });

  it("returns null for an empty cadence list", () => {
    const account: AccountContext = { inactiveDays: 100, declinePct: 50, hasRecentComplaint: true };
    expect(shouldEnroll(account, [])).toBeNull();
  });
});

// ── matchesCriteria ─────────────────────────────────────────────────────────

describe("matchesCriteria", () => {
  it("matches when all specified criteria are met", () => {
    const criteria: TriggerCriteria = { inactiveDays: 60, declinePct: 20 };
    const account: AccountContext = { inactiveDays: 90, declinePct: 25, hasRecentComplaint: false };
    expect(matchesCriteria(account, criteria)).toBe(true);
  });

  it("fails when inactiveDays is below threshold", () => {
    const criteria: TriggerCriteria = { inactiveDays: 90 };
    const account: AccountContext = { inactiveDays: 89, declinePct: 50, hasRecentComplaint: true };
    expect(matchesCriteria(account, criteria)).toBe(false);
  });

  it("fails when declinePct is below threshold", () => {
    const criteria: TriggerCriteria = { declinePct: 30 };
    const account: AccountContext = { inactiveDays: 100, declinePct: 29, hasRecentComplaint: true };
    expect(matchesCriteria(account, criteria)).toBe(false);
  });

  it("fails when hasRecentComplaint does not match", () => {
    const criteria: TriggerCriteria = { hasRecentComplaint: true };
    const account: AccountContext = { inactiveDays: 100, declinePct: 50, hasRecentComplaint: false };
    expect(matchesCriteria(account, criteria)).toBe(false);
  });

  it("does NOT match when criteria is empty (fail-safe)", () => {
    const account: AccountContext = { inactiveDays: 100, declinePct: 50, hasRecentComplaint: true };
    expect(matchesCriteria(account, {})).toBe(false);
  });

  it("matches at exact threshold boundary", () => {
    const criteria: TriggerCriteria = { inactiveDays: 90, declinePct: 30 };
    const account: AccountContext = { inactiveDays: 90, declinePct: 30, hasRecentComplaint: false };
    expect(matchesCriteria(account, criteria)).toBe(true);
  });

  it("matches hasRecentComplaint: false explicitly", () => {
    const criteria: TriggerCriteria = { hasRecentComplaint: false };
    const account: AccountContext = { inactiveDays: 10, declinePct: 5, hasRecentComplaint: false };
    expect(matchesCriteria(account, criteria)).toBe(true);
  });
});

// ── advanceStep ─────────────────────────────────────────────────────────────

describe("advanceStep", () => {
  const steps: CadenceStep[] = [
    { ordinal: 0, delayDays: 0, actionType: "email", templateRef: "welcome-back" },
    { ordinal: 1, delayDays: 7, actionType: "sms", templateRef: "follow-up" },
    { ordinal: 2, delayDays: 14, actionType: "call" },
  ];

  it("advances from step 0 to step 1", () => {
    const result = advanceStep(0, steps);
    expect(result.completed).toBe(false);
    expect(result.nextStep).toBe(1);
    expect(result.scheduledAction?.actionType).toBe("sms");
    expect(result.scheduledAction?.delayDays).toBe(7);
  });

  it("advances from step 1 to step 2", () => {
    const result = advanceStep(1, steps);
    expect(result.completed).toBe(false);
    expect(result.nextStep).toBe(2);
    expect(result.scheduledAction?.actionType).toBe("call");
  });

  it("signals completion when already at last step", () => {
    const result = advanceStep(2, steps);
    expect(result.completed).toBe(true);
    expect(result.nextStep).toBeUndefined();
  });

  it("signals completion when current step exceeds array length", () => {
    const result = advanceStep(5, steps);
    expect(result.completed).toBe(true);
  });

  it("signals completion on empty steps array", () => {
    const result = advanceStep(0, []);
    expect(result.completed).toBe(true);
  });

  it("handles single-step cadence", () => {
    const singleStep: CadenceStep[] = [{ ordinal: 0, delayDays: 3, actionType: "email" }];
    const result = advanceStep(0, singleStep);
    expect(result.completed).toBe(true);
  });
});

// ── canCancel ───────────────────────────────────────────────────────────────

describe("canCancel", () => {
  it("allows cancelling active enrollments", () => {
    expect(canCancel("active")).toBe(true);
  });

  it("rejects cancelling completed enrollments", () => {
    expect(canCancel("completed")).toBe(false);
  });

  it("rejects cancelling already-cancelled enrollments", () => {
    expect(canCancel("cancelled")).toBe(false);
  });

  it("rejects cancelling converted enrollments", () => {
    expect(canCancel("converted")).toBe(false);
  });
});

// ── recordOutcome ───────────────────────────────────────────────────────────

describe("recordOutcome", () => {
  it("sets status to converted for 'converted' outcome", () => {
    const result = recordOutcome("active", "converted");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.newStatus).toBe("converted");
    }
  });

  it("sets status to completed for 'churned' outcome", () => {
    const result = recordOutcome("active", "churned");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.newStatus).toBe("completed");
    }
  });

  it("sets status to completed for 'no_response' outcome", () => {
    const result = recordOutcome("active", "no_response");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.newStatus).toBe("completed");
    }
  });

  it("rejects outcome on completed enrollment", () => {
    const result = recordOutcome("completed", "converted");
    expect(result.valid).toBe(false);
  });

  it("rejects outcome on cancelled enrollment", () => {
    const result = recordOutcome("cancelled", "churned");
    expect(result.valid).toBe(false);
  });

  it("rejects outcome on already-converted enrollment", () => {
    const result = recordOutcome("converted", "no_response");
    expect(result.valid).toBe(false);
  });
});

// ── validateSteps ───────────────────────────────────────────────────────────

describe("validateSteps", () => {
  it("accepts valid sequential steps", () => {
    const steps: CadenceStep[] = [
      { ordinal: 0, delayDays: 0, actionType: "email" },
      { ordinal: 1, delayDays: 7, actionType: "sms" },
    ];
    expect(validateSteps(steps)).toEqual({ valid: true });
  });

  it("rejects non-sequential ordinals", () => {
    const steps: CadenceStep[] = [
      { ordinal: 0, delayDays: 0, actionType: "email" },
      { ordinal: 2, delayDays: 7, actionType: "sms" },
    ];
    const result = validateSteps(steps);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("ordinal mismatch");
    }
  });

  it("rejects negative delayDays", () => {
    const steps: CadenceStep[] = [{ ordinal: 0, delayDays: -1, actionType: "email" }];
    const result = validateSteps(steps);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("negative delayDays");
    }
  });

  it("rejects empty actionType", () => {
    const steps: CadenceStep[] = [{ ordinal: 0, delayDays: 0, actionType: "" }];
    const result = validateSteps(steps);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("empty actionType");
    }
  });

  it("rejects whitespace-only actionType", () => {
    const steps: CadenceStep[] = [{ ordinal: 0, delayDays: 0, actionType: "   " }];
    const result = validateSteps(steps);
    expect(result.valid).toBe(false);
  });

  it("accepts an empty steps array", () => {
    expect(validateSteps([])).toEqual({ valid: true });
  });

  it("accepts zero delayDays for the first step", () => {
    const steps: CadenceStep[] = [{ ordinal: 0, delayDays: 0, actionType: "email" }];
    expect(validateSteps(steps)).toEqual({ valid: true });
  });
});

// ── validateTriggerCriteria ─────────────────────────────────────────────────

describe("validateTriggerCriteria", () => {
  it("accepts valid criteria with at least one field", () => {
    expect(validateTriggerCriteria({ inactiveDays: 90 })).toEqual({ valid: true });
    expect(validateTriggerCriteria({ declinePct: 30 })).toEqual({ valid: true });
    expect(validateTriggerCriteria({ hasRecentComplaint: true })).toEqual({ valid: true });
  });

  it("accepts criteria with all fields", () => {
    expect(validateTriggerCriteria({ inactiveDays: 90, declinePct: 30, hasRecentComplaint: true })).toEqual({ valid: true });
  });

  it("rejects empty criteria", () => {
    const result = validateTriggerCriteria({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("At least one");
    }
  });

  it("rejects negative inactiveDays", () => {
    const result = validateTriggerCriteria({ inactiveDays: -1 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("non-negative");
    }
  });

  it("rejects declinePct below 0", () => {
    const result = validateTriggerCriteria({ declinePct: -5 });
    expect(result.valid).toBe(false);
  });

  it("rejects declinePct above 100", () => {
    const result = validateTriggerCriteria({ declinePct: 101 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("between 0 and 100");
    }
  });

  it("accepts boundary values (0 and 100)", () => {
    expect(validateTriggerCriteria({ inactiveDays: 0 })).toEqual({ valid: true });
    expect(validateTriggerCriteria({ declinePct: 0 })).toEqual({ valid: true });
    expect(validateTriggerCriteria({ declinePct: 100 })).toEqual({ valid: true });
  });
});

// ── Constant exports ────────────────────────────────────────────────────────

describe("constants", () => {
  it("exports all cadence statuses", () => {
    expect(CADENCE_STATUSES).toEqual(["draft", "active", "archived"]);
  });

  it("exports all enrollment statuses", () => {
    expect(ENROLLMENT_STATUSES).toEqual(["active", "completed", "cancelled", "converted"]);
  });

  it("exports all valid outcomes", () => {
    expect(OUTCOMES).toEqual(["converted", "churned", "no_response"]);
  });
});
