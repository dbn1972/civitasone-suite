/**
 * WC-009 — unit tests for the sandbox masked-refresh domain logic.
 *
 * The behaviour that matters most: masking is FAIL-CLOSED. A field with no
 * explicit rule must resolve to `redact`, never pass through. These tests pin
 * that, the plan arithmetic, and every guard.
 */
import { describe, it, expect } from "vitest";
import { HttpError } from "../src/shared/context.js";
import {
  SOURCE_ENVIRONMENTS,
  MASKING_STRATEGIES,
  DEFAULT_STRATEGY,
  SANDBOX_STATUSES,
  REFRESH_STATUSES,
  resolveStrategy,
  isMasking,
  buildMaskingPlan,
  assertPreserveJustified,
  assertApproverDistinct,
  assertAwaitingApproval,
  assertVersionMatch,
  assertSandboxRefreshable,
  type MaskingRule,
} from "../src/modules/sandbox/domain.js";

function expectHttpError(fn: () => unknown, status: number, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    expect((err as HttpError).code).toBe(code);
    return;
  }
  throw new Error(`expected an HttpError ${status} ${code}, nothing was thrown`);
}

const rule = (tableName: string, fieldName: string, strategy: MaskingRule["strategy"], justification = ""): MaskingRule =>
  ({ tableName, fieldName, strategy, justification });

describe("WC-009 constants", () => {
  it("mirrors the CHECK-constrained enums in migration 0027", () => {
    expect(SOURCE_ENVIRONMENTS).toEqual(["dev", "staging", "uat", "production"]);
    expect(MASKING_STRATEGIES).toEqual(["redact", "hash", "partial", "nullify", "preserve"]);
    expect(SANDBOX_STATUSES).toEqual(["registered", "refreshing", "ready", "disabled"]);
    expect(REFRESH_STATUSES).toEqual(["pending_approval", "rejected", "queued", "running", "completed", "failed"]);
  });

  it("defaults to redact, the fail-closed strategy", () => {
    expect(DEFAULT_STRATEGY).toBe("redact");
  });
});

describe("isMasking", () => {
  it("treats every strategy except preserve as masking", () => {
    expect(isMasking("redact")).toBe(true);
    expect(isMasking("hash")).toBe(true);
    expect(isMasking("partial")).toBe(true);
    expect(isMasking("nullify")).toBe(true);
    expect(isMasking("preserve")).toBe(false);
  });
});

describe("resolveStrategy", () => {
  const rules = [rule("citizens", "email", "hash"), rule("citizens", "name", "preserve", "public register")];

  it("uses an explicit matching rule", () => {
    expect(resolveStrategy({ tableName: "citizens", fieldName: "email" }, rules))
      .toEqual({ strategy: "hash", ruleSource: "rule" });
  });

  it("falls back to redact when NO rule matches — a forgotten field cannot leak", () => {
    expect(resolveStrategy({ tableName: "citizens", fieldName: "aadhaar" }, rules))
      .toEqual({ strategy: "redact", ruleSource: "default" });
  });

  it("falls back to redact when the rule list is empty", () => {
    expect(resolveStrategy({ tableName: "t", fieldName: "f" }, []))
      .toEqual({ strategy: "redact", ruleSource: "default" });
  });

  it("matches case-insensitively on both table and field", () => {
    expect(resolveStrategy({ tableName: "CITIZENS", fieldName: "EMAIL" }, rules).strategy).toBe("hash");
  });

  it("does not match a field of the same name on a different table", () => {
    expect(resolveStrategy({ tableName: "employees", fieldName: "email" }, rules).ruleSource).toBe("default");
  });

  it("uses the FIRST matching rule when duplicates exist", () => {
    const dupes = [rule("t", "f", "hash"), rule("t", "f", "preserve", "x")];
    expect(resolveStrategy({ tableName: "t", fieldName: "f" }, dupes).strategy).toBe("hash");
  });
});

describe("buildMaskingPlan", () => {
  it("plans one entry per requested field with its resolved strategy", () => {
    const plan = buildMaskingPlan(
      [{ tableName: "citizens", fieldName: "email" }, { tableName: "citizens", fieldName: "phone" }],
      [rule("citizens", "email", "hash")],
    );
    expect(plan.fields).toHaveLength(2);
    expect(plan.fields[0]).toEqual({ tableName: "citizens", fieldName: "email", strategy: "hash", ruleSource: "rule", masked: true });
    expect(plan.fields[1]).toEqual({ tableName: "citizens", fieldName: "phone", strategy: "redact", ruleSource: "default", masked: true });
  });

  it("counts masked and preserved fields separately", () => {
    const plan = buildMaskingPlan(
      [
        { tableName: "t", fieldName: "a" },
        { tableName: "t", fieldName: "b" },
        { tableName: "t", fieldName: "c" },
      ],
      [rule("t", "c", "preserve", "documented business need")],
    );
    expect(plan.maskedFieldCount).toBe(2);
    expect(plan.preservedFieldCount).toBe(1);
  });

  it("reports every field that fell back to the default so nobody can miss it", () => {
    const plan = buildMaskingPlan(
      [{ tableName: "t", fieldName: "known" }, { tableName: "t", fieldName: "forgotten" }],
      [rule("t", "known", "nullify")],
    );
    expect(plan.defaultedFields).toEqual([{ tableName: "t", fieldName: "forgotten" }]);
  });

  it("leaves defaultedFields empty when every field has a rule", () => {
    const plan = buildMaskingPlan([{ tableName: "t", fieldName: "a" }], [rule("t", "a", "redact")]);
    expect(plan.defaultedFields).toEqual([]);
  });

  it("plans a duplicated request once, keeping the first spelling", () => {
    const plan = buildMaskingPlan(
      [
        { tableName: "T", fieldName: "F" },
        { tableName: "t", fieldName: "f" },
      ],
      [],
    );
    expect(plan.fields).toHaveLength(1);
    expect(plan.fields[0]?.tableName).toBe("T");
  });

  it("does not double-count a duplicate in the defaulted list", () => {
    const plan = buildMaskingPlan(
      [{ tableName: "t", fieldName: "f" }, { tableName: "t", fieldName: "f" }],
      [],
    );
    expect(plan.defaultedFields).toHaveLength(1);
  });

  it("returns an empty plan for no requested fields", () => {
    const plan = buildMaskingPlan([], [rule("t", "f", "hash")]);
    expect(plan).toEqual({ fields: [], maskedFieldCount: 0, preservedFieldCount: 0, defaultedFields: [] });
  });

  it("never marks a defaulted field as unmasked", () => {
    const plan = buildMaskingPlan([{ tableName: "x", fieldName: "y" }], []);
    expect(plan.fields[0]?.masked).toBe(true);
    expect(plan.preservedFieldCount).toBe(0);
  });
});

describe("assertPreserveJustified", () => {
  it("permits a preserve rule with a real justification", () => {
    expect(() => assertPreserveJustified("preserve", "published in the public register")).not.toThrow();
  });

  it("422 when a preserve rule has no justification", () => {
    expectHttpError(() => assertPreserveJustified("preserve", ""), 422, "PRESERVE_NEEDS_JUSTIFICATION");
  });

  it("422 when the justification is only whitespace", () => {
    expectHttpError(() => assertPreserveJustified("preserve", "           "), 422, "PRESERVE_NEEDS_JUSTIFICATION");
  });

  it("422 when the justification is shorter than 10 characters", () => {
    expectHttpError(() => assertPreserveJustified("preserve", "because"), 422, "PRESERVE_NEEDS_JUSTIFICATION");
  });

  it("accepts exactly 10 characters", () => {
    expect(() => assertPreserveJustified("preserve", "0123456789")).not.toThrow();
  });

  it("does not require a justification for masking strategies", () => {
    for (const s of ["redact", "hash", "partial", "nullify"] as const) {
      expect(() => assertPreserveJustified(s, "")).not.toThrow();
    }
  });
});

describe("refresh guards", () => {
  const A = "aaaa1111-0000-4000-8000-000000000001";
  const B = "bbbb2222-0000-4000-8000-000000000002";

  it("allows a distinct approver and blocks self-approval", () => {
    expect(() => assertApproverDistinct(A, B)).not.toThrow();
    expectHttpError(() => assertApproverDistinct(A, A), 409, "MAKER_CHECKER_VIOLATION");
  });

  it("only a pending_approval job can be decided", () => {
    expect(() => assertAwaitingApproval("pending_approval")).not.toThrow();
    for (const s of ["queued", "running", "completed", "failed", "rejected"]) {
      expectHttpError(() => assertAwaitingApproval(s), 409, "NOT_PENDING_APPROVAL");
    }
  });

  it("optimistic lock: absent expectation passes, match passes, mismatch is 409", () => {
    expect(() => assertVersionMatch(2, undefined)).not.toThrow();
    expect(() => assertVersionMatch(2, 2)).not.toThrow();
    expectHttpError(() => assertVersionMatch(2, 1), 409, "VERSION_CONFLICT");
  });

  it("a registered or ready sandbox is refreshable", () => {
    expect(() => assertSandboxRefreshable("registered")).not.toThrow();
    expect(() => assertSandboxRefreshable("ready")).not.toThrow();
  });

  it("422 SANDBOX_DISABLED for a disabled sandbox", () => {
    expectHttpError(() => assertSandboxRefreshable("disabled"), 422, "SANDBOX_DISABLED");
  });

  it("409 REFRESH_IN_PROGRESS when a refresh is already running", () => {
    expectHttpError(() => assertSandboxRefreshable("refreshing"), 409, "REFRESH_IN_PROGRESS");
  });
});
