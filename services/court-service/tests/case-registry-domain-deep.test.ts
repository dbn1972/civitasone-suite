/**
 * Court Service — Case Registry + Lifecycle Domain: Deep tests.
 *
 * Tests CNR validation, case status state machine, terminal detection,
 * case-type validation, disposal day resolution, and date arithmetic.
 *
 * Source: modules/case-registry/domain.ts, modules/case-lifecycle/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  CASE_STATUSES, normalizeCnr, validateCnr, deriveInitialStatus,
  canTransition, assertTransition, DEFAULT_CASE_TYPES,
  assertCaseTypeAllowed, DEFAULT_DISPOSAL_DAYS, resolveDisposalDays, addDays,
} from "../src/modules/case-registry/domain.js";
import { isTerminal, deriveStage } from "../src/modules/case-lifecycle/domain.js";

describe("CASE_STATUSES", () => {
  it("declares 8 statuses in order", () => {
    expect([...CASE_STATUSES]).toEqual([
      "filed", "registered", "admitted", "pending", "part_heard", "reserved", "disposed", "appealed",
    ]);
  });
});

describe("normalizeCnr", () => {
  it("strips separators and uppercases", () => {
    expect(normalizeCnr("DLHC-0100-0123-4026")).toBe("DLHC010001234026");
  });
  it("handles already-normalized input", () => {
    expect(normalizeCnr("DLHC010001234026")).toBe("DLHC010001234026");
  });
});

describe("validateCnr", () => {
  it("accepts valid 16-char CNR", () => {
    expect(validateCnr("DLHC010001234026")).toBe("DLHC010001234026");
  });
  it("accepts with separators (strips them)", () => {
    expect(validateCnr("DLHC-0100-0123-4026")).toBe("DLHC010001234026");
  });
  it("throws INVALID_CNR for too short", () => {
    expect(() => validateCnr("DLHC0100")).toThrow("INVALID_CNR");
  });
  it("throws INVALID_CNR for too long", () => {
    expect(() => validateCnr("DLHC01000123402699")).toThrow("INVALID_CNR");
  });
  it("throws for special characters", () => {
    expect(() => validateCnr("DLHC$10001234026")).toThrow("INVALID_CNR");
  });
});

describe("deriveInitialStatus", () => {
  it("always returns filed", () => expect(deriveInitialStatus()).toBe("filed"));
});

describe("canTransition — case lifecycle state machine", () => {
  const valid: [string, string][] = [
    ["filed", "registered"], ["registered", "admitted"], ["admitted", "pending"],
    ["pending", "part_heard"], ["pending", "reserved"], ["pending", "disposed"],
    ["part_heard", "reserved"], ["part_heard", "pending"], ["part_heard", "disposed"],
    ["reserved", "disposed"], ["reserved", "part_heard"],
    ["disposed", "appealed"], ["appealed", "pending"],
  ];
  for (const [from, to] of valid) {
    it(`${from} → ${to}`, () => expect(canTransition(from as any, to as any)).toBe(true));
  }

  const invalid: [string, string][] = [
    ["filed", "pending"], ["filed", "disposed"],
    ["registered", "pending"], ["registered", "disposed"],
    ["admitted", "disposed"], ["admitted", "reserved"],
    ["pending", "filed"], ["pending", "registered"],
    ["disposed", "filed"], ["disposed", "pending"],
    ["appealed", "disposed"], ["appealed", "filed"],
  ];
  for (const [from, to] of invalid) {
    it(`${from} → ${to} is illegal`, () => expect(canTransition(from as any, to as any)).toBe(false));
  }
});

describe("assertTransition", () => {
  it("throws INVALID_TRANSITION for illegal move", () => {
    expect(() => assertTransition("filed", "disposed")).toThrow("INVALID_TRANSITION");
  });
  it("does not throw for valid move", () => {
    expect(() => assertTransition("filed", "registered")).not.toThrow();
  });
});

describe("isTerminal — case-lifecycle", () => {
  it("disposed is terminal", () => expect(isTerminal("disposed")).toBe(true));
  it("appealed is terminal", () => expect(isTerminal("appealed")).toBe(true));
  it("pending is NOT terminal", () => expect(isTerminal("pending")).toBe(false));
  it("filed is NOT terminal", () => expect(isTerminal("filed")).toBe(false));
});

describe("deriveStage", () => {
  it("mirrors status for now", () => {
    expect(deriveStage("pending")).toBe("pending");
    expect(deriveStage("disposed")).toBe("disposed");
  });
});

describe("DEFAULT_CASE_TYPES", () => {
  it("contains civil and criminal", () => {
    expect(DEFAULT_CASE_TYPES).toContain("civil");
    expect(DEFAULT_CASE_TYPES).toContain("criminal");
  });
  it("has 12 default types", () => expect(DEFAULT_CASE_TYPES).toHaveLength(12));
});

describe("assertCaseTypeAllowed", () => {
  const allowed = new Set(["civil", "criminal", "revision"]);
  it("passes for allowed type", () => {
    expect(() => assertCaseTypeAllowed("civil", allowed)).not.toThrow();
  });
  it("throws INVALID_CASE_TYPE for disallowed type", () => {
    expect(() => assertCaseTypeAllowed("writ", allowed)).toThrow("INVALID_CASE_TYPE");
  });
});

describe("resolveDisposalDays", () => {
  it("uses config value when valid", () => {
    expect(resolveDisposalDays({ disposalDays: 90 }, 180)).toBe(90);
  });
  it("falls back to default when config is null", () => {
    expect(resolveDisposalDays(null, 180)).toBe(180);
  });
  it("falls back when disposalDays is not positive", () => {
    expect(resolveDisposalDays({ disposalDays: 0 }, 180)).toBe(180);
    expect(resolveDisposalDays({ disposalDays: -5 }, 180)).toBe(180);
  });
  it("DEFAULT_DISPOSAL_DAYS is 180", () => expect(DEFAULT_DISPOSAL_DAYS).toBe(180));
});

describe("addDays — date arithmetic", () => {
  it("adds 30 days", () => expect(addDays("2026-07-01", 30)).toBe("2026-07-31"));
  it("crosses month boundary", () => expect(addDays("2026-01-30", 5)).toBe("2026-02-04"));
  it("crosses year boundary", () => expect(addDays("2026-12-25", 10)).toBe("2027-01-04"));
  it("adds 0 days = same date", () => expect(addDays("2026-07-15", 0)).toBe("2026-07-15"));
  it("handles leap year Feb", () => expect(addDays("2028-02-28", 1)).toBe("2028-02-29"));
});
