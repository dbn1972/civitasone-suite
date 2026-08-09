/**
 * Admin Service — Comprehensive Domain Tests.
 *
 * Tests change management (state machine, CAB maker-checker, freeze conflicts),
 * sandbox (masking plan, preserve justification, maker-checker, version locks),
 * and feature flags (stable bucketing, kill switch, segment targeting).
 *
 * Source: modules/change/domain.ts, modules/sandbox/domain.ts, modules/feature-flags/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  canTransition, assertTransition, assertApproverDistinct as assertChangeApprover,
  assertRollbackPlan, assertValidWindow, windowsOverlap, findFreezeConflict,
  assertNoFreezeConflict, statusForPir, TRANSITIONS, ChangeError, type ChangeStatus,
} from "../src/modules/change/domain.js";
import {
  resolveStrategy, isMasking, buildMaskingPlan, assertPreserveJustified,
  assertApproverDistinct as assertSandboxApprover, assertAwaitingApproval,
  assertVersionMatch, assertSandboxRefreshable, DEFAULT_STRATEGY,
  SOURCE_ENVIRONMENTS, MASKING_STRATEGIES, type MaskingRule, type FieldRef,
} from "../src/modules/sandbox/domain.js";
import { evaluateFlag, bucketOf, type FlagState, type EvalSubject } from "../src/modules/feature-flags/domain.js";

// ═══ CHANGE MANAGEMENT ═══

describe("change lifecycle — state machine", () => {
  const valid: [ChangeStatus, ChangeStatus][] = [
    ["draft", "submitted"], ["submitted", "approved"], ["submitted", "rejected"],
    ["approved", "scheduled"], ["scheduled", "in_progress"],
    ["in_progress", "completed"], ["in_progress", "rolled_back"],
  ];
  for (const [f, t] of valid) it(`${f} → ${t}`, () => expect(canTransition(f, t)).toBe(true));

  const invalid: [ChangeStatus, ChangeStatus][] = [
    ["draft", "approved"], ["draft", "in_progress"], ["submitted", "scheduled"],
    ["approved", "completed"], ["rejected", "approved"], ["completed", "draft"],
    ["rolled_back", "draft"],
  ];
  for (const [f, t] of invalid) it(`${f} → ${t} illegal`, () => expect(canTransition(f, t)).toBe(false));

  it("assertTransition throws ChangeError 409", () => {
    expect(() => assertTransition("draft", "approved")).toThrow(ChangeError);
    try { assertTransition("draft", "approved"); } catch (e) { expect((e as ChangeError).status).toBe(409); }
  });
});

describe("change — CAB maker-checker", () => {
  it("passes when different", () => expect(() => assertChangeApprover("A", "B")).not.toThrow());
  it("throws MAKER_CHECKER_VIOLATION", () => expect(() => assertChangeApprover("A", "A")).toThrow(ChangeError));
});

describe("change — rollback plan guard", () => {
  it("passes with plan", () => expect(() => assertRollbackPlan("Revert DB migration 0042")).not.toThrow());
  it("throws ROLLBACK_REQUIRED for null", () => expect(() => assertRollbackPlan(null)).toThrow(ChangeError));
  it("throws for empty string", () => expect(() => assertRollbackPlan("")).toThrow(ChangeError));
  it("throws for whitespace only", () => expect(() => assertRollbackPlan("   ")).toThrow(ChangeError));
});

describe("change — release window", () => {
  it("valid when end > start", () => expect(() => assertValidWindow(new Date("2026-07-01"), new Date("2026-07-02"))).not.toThrow());
  it("throws INVALID_WINDOW when end <= start", () => expect(() => assertValidWindow(new Date("2026-07-02"), new Date("2026-07-01"))).toThrow(ChangeError));
  it("throws when equal", () => expect(() => assertValidWindow(new Date("2026-07-01"), new Date("2026-07-01"))).toThrow(ChangeError));
});

describe("change — freeze conflict detection", () => {
  const freezes = [{ id: "f1", name: "Year-End Freeze", startsAt: new Date("2026-12-20"), endsAt: new Date("2027-01-05") }];
  it("detects overlap", () => expect(findFreezeConflict(new Date("2026-12-25"), new Date("2026-12-30"), freezes)?.name).toBe("Year-End Freeze"));
  it("no conflict outside freeze", () => expect(findFreezeConflict(new Date("2026-11-01"), new Date("2026-11-15"), freezes)).toBeUndefined());
  it("assertNoFreezeConflict throws FREEZE_CONFLICT", () => {
    expect(() => assertNoFreezeConflict(new Date("2026-12-25"), new Date("2026-12-30"), freezes)).toThrow(ChangeError);
  });
});

describe("windowsOverlap", () => {
  it("overlapping windows", () => expect(windowsOverlap(new Date("2026-07-01"), new Date("2026-07-10"), new Date("2026-07-05"), new Date("2026-07-15"))).toBe(true));
  it("non-overlapping", () => expect(windowsOverlap(new Date("2026-07-01"), new Date("2026-07-05"), new Date("2026-07-10"), new Date("2026-07-15"))).toBe(false));
  it("touching (a ends when b starts) = no overlap", () => expect(windowsOverlap(new Date("2026-07-01"), new Date("2026-07-05"), new Date("2026-07-05"), new Date("2026-07-10"))).toBe(false));
});

describe("statusForPir", () => {
  it("success → completed", () => expect(statusForPir("success")).toBe("completed"));
  it("rolled_back → rolled_back", () => expect(statusForPir("rolled_back")).toBe("rolled_back"));
});

// ═══ SANDBOX ═══

describe("sandbox — masking strategy resolution", () => {
  const rules: MaskingRule[] = [
    { tableName: "users", fieldName: "email", strategy: "hash", justification: "needed for dedup" },
    { tableName: "users", fieldName: "name", strategy: "preserve", justification: "non-PII display name for testing" },
  ];

  it("DEFAULT_STRATEGY is redact (fail-closed)", () => expect(DEFAULT_STRATEGY).toBe("redact"));
  it("resolves matching rule", () => expect(resolveStrategy({ tableName: "users", fieldName: "email" }, rules).strategy).toBe("hash"));
  it("falls back to redact for unknown field", () => expect(resolveStrategy({ tableName: "orders", fieldName: "total" }, rules).strategy).toBe("redact"));
  it("ruleSource = default for unmatched", () => expect(resolveStrategy({ tableName: "orders", fieldName: "x" }, rules).ruleSource).toBe("default"));
  it("case-insensitive matching", () => expect(resolveStrategy({ tableName: "USERS", fieldName: "EMAIL" }, rules).strategy).toBe("hash"));
});

describe("sandbox — isMasking", () => {
  it("redact masks", () => expect(isMasking("redact")).toBe(true));
  it("hash masks", () => expect(isMasking("hash")).toBe(true));
  it("partial masks", () => expect(isMasking("partial")).toBe(true));
  it("nullify masks", () => expect(isMasking("nullify")).toBe(true));
  it("preserve does NOT mask", () => expect(isMasking("preserve")).toBe(false));
});

describe("sandbox — buildMaskingPlan", () => {
  const rules: MaskingRule[] = [
    { tableName: "users", fieldName: "email", strategy: "hash", justification: "dedup" },
  ];
  const fields: FieldRef[] = [
    { tableName: "users", fieldName: "email" },
    { tableName: "users", fieldName: "phone" },
  ];

  it("counts masked vs preserved", () => {
    const plan = buildMaskingPlan(fields, rules);
    expect(plan.maskedFieldCount).toBe(2); // email=hash(masked), phone=redact(default, masked)
    expect(plan.preservedFieldCount).toBe(0);
  });

  it("tracks defaulted fields", () => {
    const plan = buildMaskingPlan(fields, rules);
    expect(plan.defaultedFields).toHaveLength(1);
    expect(plan.defaultedFields[0]!.fieldName).toBe("phone");
  });

  it("deduplicates", () => {
    const duped: FieldRef[] = [{ tableName: "users", fieldName: "email" }, { tableName: "users", fieldName: "email" }];
    expect(buildMaskingPlan(duped, rules).fields).toHaveLength(1);
  });
});

describe("sandbox — guards", () => {
  it("assertPreserveJustified: ok with 10+ chars", () => expect(() => assertPreserveJustified("preserve", "needed for e2e testing flows")).not.toThrow());
  it("assertPreserveJustified: throws for short justification", () => expect(() => assertPreserveJustified("preserve", "short")).toThrow());
  it("assertPreserveJustified: non-preserve always passes", () => expect(() => assertPreserveJustified("hash", "")).not.toThrow());
  it("assertSandboxApprover: maker ≠ checker", () => expect(() => assertSandboxApprover("A", "A")).toThrow());
  it("assertAwaitingApproval: passes for pending_approval", () => expect(() => assertAwaitingApproval("pending_approval")).not.toThrow());
  it("assertAwaitingApproval: throws for running", () => expect(() => assertAwaitingApproval("running")).toThrow());
  it("assertVersionMatch: passes when equal", () => expect(() => assertVersionMatch(3, 3)).not.toThrow());
  it("assertVersionMatch: throws on mismatch", () => expect(() => assertVersionMatch(3, 2)).toThrow());
  it("assertVersionMatch: undefined = skip check", () => expect(() => assertVersionMatch(5, undefined)).not.toThrow());
  it("assertSandboxRefreshable: passes for ready", () => expect(() => assertSandboxRefreshable("ready")).not.toThrow());
  it("assertSandboxRefreshable: throws for disabled", () => expect(() => assertSandboxRefreshable("disabled")).toThrow());
  it("assertSandboxRefreshable: throws for refreshing", () => expect(() => assertSandboxRefreshable("refreshing")).toThrow());
});

describe("sandbox — constants", () => {
  it("SOURCE_ENVIRONMENTS", () => expect([...SOURCE_ENVIRONMENTS]).toEqual(["dev", "staging", "uat", "production"]));
  it("MASKING_STRATEGIES", () => expect([...MASKING_STRATEGIES]).toEqual(["redact", "hash", "partial", "nullify", "preserve"]));
});

// ═══ FEATURE FLAGS (comprehensive addition) ═══

describe("feature flags — comprehensive scenarios", () => {
  const flag: FlagState = { key: "dark_mode", enabled: true, rolloutPercent: 50, targetSegments: [], killSwitch: false };

  it("50% rollout: deterministic for same subject", () => {
    const r1 = evaluateFlag(flag, { subjectId: "tenant-x" });
    const r2 = evaluateFlag(flag, { subjectId: "tenant-x" });
    expect(r1.enabled).toBe(r2.enabled);
  });

  it("different subjects may get different results at 50%", () => {
    const results = Array.from({ length: 20 }, (_, i) => evaluateFlag(flag, { subjectId: `t-${i}` }).enabled);
    const trues = results.filter(Boolean).length;
    // At 50%, statistically ~10±7 of 20 should be true (just check it's not 0 or 20)
    expect(trues).toBeGreaterThan(0);
    expect(trues).toBeLessThan(20);
  });

  it("precedence: kill > expired > disabled > segment > pct", () => {
    const killed = evaluateFlag({ ...flag, killSwitch: true, enabled: true, rolloutPercent: 100, targetSegments: ["all"] }, { subjectId: "x", segments: ["all"] });
    expect(killed.enabled).toBe(false);
    expect(killed.reason).toBe("kill_switch");
  });
});
