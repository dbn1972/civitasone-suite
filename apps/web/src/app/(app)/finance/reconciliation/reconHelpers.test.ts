import { describe, it, expect } from "vitest";
import {
  canActOnExceptions,
  exceptionStatusVariant,
  isRunInProgress,
  latestStartedAt,
  readableActor,
  unmatchedCount,
} from "./reconHelpers";

describe("reconHelpers", () => {
  it("canActOnExceptions: audit_officer read-only, finance roles act, no-claim fails open", () => {
    expect(canActOnExceptions(["audit_officer"])).toBe(false);
    expect(canActOnExceptions(["procurement_officer"])).toBe(false);
    expect(canActOnExceptions(["finance_officer"])).toBe(true);
    expect(canActOnExceptions(["audit_officer", "finance_admin"])).toBe(true);
    expect(canActOnExceptions(["super_admin"])).toBe(true);
    expect(canActOnExceptions([])).toBe(true);
  });

  it("exceptionStatusVariant: open is red", () => {
    expect(exceptionStatusVariant("open")).toBe("bad");
    expect(exceptionStatusVariant("investigating")).toBe("warn");
    expect(exceptionStatusVariant("resolved")).toBe("good");
    expect(exceptionStatusVariant("written_off")).toBe("mut");
    expect(exceptionStatusVariant("weird")).toBe("info");
  });

  it("latestStartedAt: newest by date, whatever the API order", () => {
    const runs = [
      { startedAt: "2026-07-01T00:00:00.000Z" },
      { startedAt: "2026-09-15T00:00:00.000Z" },
      { startedAt: "not-a-date" },
      { startedAt: "2026-08-01T00:00:00.000Z" },
    ];
    expect(latestStartedAt(runs)).toBe("2026-09-15T00:00:00.000Z");
    expect(latestStartedAt([])).toBeNull();
    expect(latestStartedAt([{ startedAt: "x" }])).toBeNull();
  });

  it("isRunInProgress", () => {
    expect(isRunInProgress("running")).toBe(true);
    expect(isRunInProgress("In_Progress")).toBe(true);
    expect(isRunInProgress("completed")).toBe(false);
    expect(isRunInProgress(null)).toBe(false);
  });

  it("unmatchedCount: 100 source / 98 target / 95 matched -> 5 and 3", () => {
    expect(unmatchedCount(100, 95)).toBe(5);
    expect(unmatchedCount(98, 95)).toBe(3);
    expect(unmatchedCount(3, 5)).toBe(0);
  });

  it("readableActor hides raw UUIDs", () => {
    expect(readableActor("11111111-aaaa-4000-8000-000000000001")).toBeNull();
    expect(readableActor("finance.officer@gov.in")).toBe("finance.officer@gov.in");
    expect(readableActor(null)).toBeNull();
  });
});
