/**
 * HRMS Learning — progress, status, resume, prerequisites tests.
 * Pack #19. Source: modules/learning/domain.ts
 */
import { describe, it, expect } from "vitest";
import { computeProgress, deriveEnrollmentStatus, nextResumeLesson, checkPrerequisites } from "../src/modules/learning/domain.js";

describe("computeProgress", () => {
  it("50% when half done", () => expect(computeProgress(10, 5)).toBe(50));
  it("100% when all done", () => expect(computeProgress(10, 10)).toBe(100));
  it("0% when none done", () => expect(computeProgress(10, 0)).toBe(0));
  it("0% when no lessons", () => expect(computeProgress(0, 0)).toBe(0));
  it("clamps to 100% even if completed > total", () => expect(computeProgress(5, 7)).toBe(100));
  it("rounds", () => expect(computeProgress(3, 1)).toBe(33)); // 33.33 → 33
});

describe("deriveEnrollmentStatus", () => {
  it("100 → completed", () => expect(deriveEnrollmentStatus(100)).toBe("completed"));
  it("0 → enrolled", () => expect(deriveEnrollmentStatus(0)).toBe("enrolled"));
  it("50 → in_progress", () => expect(deriveEnrollmentStatus(50)).toBe("in_progress"));
  it("1 → in_progress", () => expect(deriveEnrollmentStatus(1)).toBe("in_progress"));
  it("99 → in_progress", () => expect(deriveEnrollmentStatus(99)).toBe("in_progress"));
});

describe("nextResumeLesson", () => {
  it("returns first incomplete lesson", () => {
    expect(nextResumeLesson(["L1", "L2", "L3"], ["L1"])).toBe("L2");
  });
  it("returns null when all complete", () => {
    expect(nextResumeLesson(["L1", "L2"], ["L1", "L2"])).toBeNull();
  });
  it("returns first lesson when nothing completed", () => {
    expect(nextResumeLesson(["L1", "L2"], [])).toBe("L1");
  });
  it("returns null for empty course", () => {
    expect(nextResumeLesson([], [])).toBeNull();
  });
});

describe("checkPrerequisites", () => {
  it("met when all prerequisites completed", () => {
    const result = checkPrerequisites(["c1", "c2"], ["c1", "c2", "c3"]);
    expect(result.met).toBe(true);
    expect(result.missing).toEqual([]);
  });
  it("not met when missing prerequisites", () => {
    const result = checkPrerequisites(["c1", "c2", "c3"], ["c1"]);
    expect(result.met).toBe(false);
    expect(result.missing).toEqual(["c2", "c3"]);
  });
  it("no prerequisites → always met", () => {
    expect(checkPrerequisites([], []).met).toBe(true);
  });
});
