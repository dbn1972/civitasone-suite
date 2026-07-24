/**
 * Unit tests for the pure domain logic of the three learning capabilities:
 *  - SVC-121 training administration (approval / waitlist / attendance)
 *  - SVC-122 learning catalogue (progress / resume / prerequisites)
 *  - SVC-124 competency (gap analysis / certified level / merge)
 * These are DB-free and deterministic — full branch coverage of the domain.
 */
import { describe, it, expect } from "vitest";
import {
  canApprove, decideApproval, nextWaitlistPosition, pickPromotion, summariseAttendance,
} from "../src/modules/training-admin/domain.js";
import {
  computeProgress, deriveEnrollmentStatus, nextResumeLesson, checkPrerequisites,
} from "../src/modules/learning/domain.js";
import {
  analyzeGaps, resolveCertifiedLevel, mergeLevel,
} from "../src/modules/competency/domain.js";

describe("SVC-121 training-admin domain", () => {
  it("canApprove enforces maker-checker (approver != nominator, nominator known)", () => {
    expect(canApprove("nom", "chk")).toBe(true);
    expect(canApprove("nom", "nom")).toBe(false);
    expect(canApprove(null, "chk")).toBe(false);
  });

  it("decideApproval seats until capacity then waitlists", () => {
    expect(decideApproval(2, 0)).toBe("approved");
    expect(decideApproval(2, 1)).toBe("approved");
    expect(decideApproval(2, 2)).toBe("waitlisted");
    expect(decideApproval(0, 0)).toBe("waitlisted");
  });

  it("nextWaitlistPosition is 1-based", () => {
    expect(nextWaitlistPosition(0)).toBe(1);
    expect(nextWaitlistPosition(3)).toBe(4);
  });

  it("pickPromotion selects the lowest waitlist position, null when empty", () => {
    expect(pickPromotion([])).toBeNull();
    expect(pickPromotion([
      { id: "b", waitlistPosition: 2 },
      { id: "a", waitlistPosition: 1 },
      { id: "c", waitlistPosition: null },
    ])).toBe("a");
    expect(pickPromotion([{ id: "x", waitlistPosition: null }])).toBe("x");
  });

  it("summariseAttendance counts and computes the rate", () => {
    expect(summariseAttendance([])).toEqual({ total: 0, present: 0, absent: 0, excused: 0, attendanceRate: 0 });
    const s = summariseAttendance([
      { status: "present" }, { status: "present" }, { status: "absent" }, { status: "excused" },
    ]);
    expect(s).toEqual({ total: 4, present: 2, absent: 1, excused: 1, attendanceRate: 0.5 });
  });
});

describe("SVC-122 learning domain", () => {
  it("computeProgress rounds and clamps", () => {
    expect(computeProgress(0, 0)).toBe(0);
    expect(computeProgress(4, 0)).toBe(0);
    expect(computeProgress(4, 1)).toBe(25);
    expect(computeProgress(3, 2)).toBe(67);
    expect(computeProgress(4, 4)).toBe(100);
    expect(computeProgress(4, 9)).toBe(100); // clamps over-count
    expect(computeProgress(4, -2)).toBe(0);  // clamps negative
  });

  it("deriveEnrollmentStatus maps percentage to status", () => {
    expect(deriveEnrollmentStatus(0)).toBe("enrolled");
    expect(deriveEnrollmentStatus(1)).toBe("in_progress");
    expect(deriveEnrollmentStatus(99)).toBe("in_progress");
    expect(deriveEnrollmentStatus(100)).toBe("completed");
  });

  it("nextResumeLesson returns first incomplete, null when all done", () => {
    expect(nextResumeLesson(["l1", "l2", "l3"], [])).toBe("l1");
    expect(nextResumeLesson(["l1", "l2", "l3"], ["l1"])).toBe("l2");
    expect(nextResumeLesson(["l1", "l2"], ["l1", "l2"])).toBeNull();
    expect(nextResumeLesson([], [])).toBeNull();
  });

  it("checkPrerequisites reports met + missing", () => {
    expect(checkPrerequisites([], [])).toEqual({ met: true, missing: [] });
    expect(checkPrerequisites(["c1", "c2"], ["c1"])).toEqual({ met: false, missing: ["c2"] });
    expect(checkPrerequisites(["c1"], ["c1", "c9"])).toEqual({ met: true, missing: [] });
  });
});

describe("SVC-124 competency domain", () => {
  it("analyzeGaps compares required vs held with 0 for missing", () => {
    const held = new Map<string, number>([["a", 3], ["b", 1]]);
    const res = analyzeGaps([
      { competencyId: "a", requiredLevel: 2 }, // met (3>=2)
      { competencyId: "b", requiredLevel: 3 }, // gap 2
      { competencyId: "c", requiredLevel: 1 }, // missing -> held 0, gap 1
    ], held);
    expect(res.requiredCount).toBe(3);
    expect(res.metCount).toBe(1);
    expect(res.gapCount).toBe(2);
    expect(res.readinessPct).toBe(33);
    expect(res.rows[0]).toEqual({ competencyId: "a", requiredLevel: 2, heldLevel: 3, gap: 0, met: true });
    expect(res.rows[1]).toEqual({ competencyId: "b", requiredLevel: 3, heldLevel: 1, gap: 2, met: false });
    expect(res.rows[2]).toEqual({ competencyId: "c", requiredLevel: 1, heldLevel: 0, gap: 1, met: false });
  });

  it("analyzeGaps with no requirements is 100% ready", () => {
    const res = analyzeGaps([], new Map());
    expect(res).toMatchObject({ requiredCount: 0, metCount: 0, gapCount: 0, readinessPct: 100 });
  });

  it("resolveCertifiedLevel is capped at maxLevel", () => {
    expect(resolveCertifiedLevel({ certifiedLevel: 3, maxLevel: 5 })).toBe(3);
    expect(resolveCertifiedLevel({ certifiedLevel: 9, maxLevel: 5 })).toBe(5);
  });

  it("mergeLevel never regresses", () => {
    expect(mergeLevel(2, 4)).toBe(4);
    expect(mergeLevel(4, 2)).toBe(4);
    expect(mergeLevel(0, 0)).toBe(0);
  });
});
