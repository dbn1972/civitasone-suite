/**
 * SVC-130 — unit tests for the pure change/release domain: state machine plus
 * the maker-checker, rollback, window-validity and freeze-conflict guards.
 */
import { describe, it, expect } from "vitest";
import {
  ChangeError,
  TRANSITIONS,
  canTransition,
  assertTransition,
  assertApproverDistinct,
  assertRollbackPlan,
  assertValidWindow,
  windowsOverlap,
  findFreezeConflict,
  assertNoFreezeConflict,
  statusForPir,
  CHANGE_TYPES,
  CHANGE_RISKS,
  PIR_OUTCOMES,
  type ChangeStatus,
  type FreezeWindow,
} from "../src/modules/change/domain.js";

const d = (iso: string): Date => new Date(iso);

describe("change state machine", () => {
  it("allows every declared forward transition", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
    expect(canTransition("submitted", "approved")).toBe(true);
    expect(canTransition("submitted", "rejected")).toBe(true);
    expect(canTransition("approved", "scheduled")).toBe(true);
    expect(canTransition("scheduled", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "completed")).toBe(true);
    expect(canTransition("in_progress", "rolled_back")).toBe(true);
  });

  it("rejects skips and backward moves", () => {
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("approved", "in_progress")).toBe(false);
    expect(canTransition("completed", "draft")).toBe(false);
  });

  it("returns false for an unknown source status (defensive fallback)", () => {
    expect(canTransition("bogus" as ChangeStatus, "draft")).toBe(false);
  });

  it("treats terminal states as having no outgoing transitions", () => {
    for (const terminal of ["rejected", "completed", "rolled_back"] as ChangeStatus[]) {
      expect(TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it("assertTransition throws ChangeError(409, INVALID_TRANSITION) on an illegal move", () => {
    try {
      assertTransition("draft", "completed");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ChangeError);
      expect((e as ChangeError).status).toBe(409);
      expect((e as ChangeError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("assertTransition is a no-op on a legal move", () => {
    expect(() => assertTransition("submitted", "approved")).not.toThrow();
  });
});

describe("maker-checker guard", () => {
  it("throws when approver equals requester", () => {
    try {
      assertApproverDistinct("user-1", "user-1");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ChangeError);
      expect((e as ChangeError).code).toBe("MAKER_CHECKER_VIOLATION");
      expect((e as ChangeError).status).toBe(409);
    }
  });

  it("passes when approver differs from requester", () => {
    expect(() => assertApproverDistinct("user-1", "user-2")).not.toThrow();
  });
});

describe("rollback-plan guard", () => {
  it("throws ROLLBACK_REQUIRED when plan is missing/blank", () => {
    for (const bad of [undefined, null, "", "   "]) {
      try {
        assertRollbackPlan(bad as string | null | undefined);
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ChangeError);
        expect((e as ChangeError).code).toBe("ROLLBACK_REQUIRED");
        expect((e as ChangeError).status).toBe(422);
      }
    }
  });

  it("passes with a real plan", () => {
    expect(() => assertRollbackPlan("revert deploy N-1 and restore snapshot")).not.toThrow();
  });
});

describe("release-window validity", () => {
  it("rejects an end at or before start", () => {
    expect(() => assertValidWindow(d("2026-08-01T10:00:00Z"), d("2026-08-01T10:00:00Z"))).toThrow(ChangeError);
    expect(() => assertValidWindow(d("2026-08-01T11:00:00Z"), d("2026-08-01T10:00:00Z"))).toThrow(ChangeError);
  });

  it("accepts a positive interval", () => {
    expect(() => assertValidWindow(d("2026-08-01T10:00:00Z"), d("2026-08-01T12:00:00Z"))).not.toThrow();
  });
});

describe("freeze-conflict checks", () => {
  const freeze: FreezeWindow = {
    id: "f1", name: "Year-end freeze", startsAt: d("2026-08-01T00:00:00Z"), endsAt: d("2026-08-05T00:00:00Z"),
  };

  it("windowsOverlap is true for intersecting windows and false for disjoint", () => {
    expect(windowsOverlap(d("2026-08-02T00:00:00Z"), d("2026-08-03T00:00:00Z"), freeze.startsAt, freeze.endsAt)).toBe(true);
    expect(windowsOverlap(d("2026-08-06T00:00:00Z"), d("2026-08-07T00:00:00Z"), freeze.startsAt, freeze.endsAt)).toBe(false);
  });

  it("treats abutting windows as non-overlapping (half-open)", () => {
    // release ends exactly when freeze starts
    expect(windowsOverlap(d("2026-07-30T00:00:00Z"), d("2026-08-01T00:00:00Z"), freeze.startsAt, freeze.endsAt)).toBe(false);
  });

  it("findFreezeConflict returns the colliding freeze or undefined", () => {
    expect(findFreezeConflict(d("2026-08-02T00:00:00Z"), d("2026-08-02T06:00:00Z"), [freeze])?.id).toBe("f1");
    expect(findFreezeConflict(d("2026-09-01T00:00:00Z"), d("2026-09-02T00:00:00Z"), [freeze])).toBeUndefined();
  });

  it("assertNoFreezeConflict throws FREEZE_CONFLICT on overlap", () => {
    try {
      assertNoFreezeConflict(d("2026-08-02T00:00:00Z"), d("2026-08-02T06:00:00Z"), [freeze]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ChangeError);
      expect((e as ChangeError).code).toBe("FREEZE_CONFLICT");
      expect((e as ChangeError).status).toBe(409);
    }
  });

  it("assertNoFreezeConflict passes when no freeze overlaps", () => {
    expect(() => assertNoFreezeConflict(d("2026-09-01T00:00:00Z"), d("2026-09-02T00:00:00Z"), [freeze])).not.toThrow();
    expect(() => assertNoFreezeConflict(d("2026-09-01T00:00:00Z"), d("2026-09-02T00:00:00Z"), [])).not.toThrow();
  });
});

describe("PIR outcome mapping + enums", () => {
  it("maps success→completed and rolled_back→rolled_back", () => {
    expect(statusForPir("success")).toBe("completed");
    expect(statusForPir("rolled_back")).toBe("rolled_back");
  });

  it("exposes the domain enums", () => {
    expect(CHANGE_TYPES).toEqual(["standard", "normal", "emergency"]);
    expect(CHANGE_RISKS).toEqual(["low", "medium", "high"]);
    expect(PIR_OUTCOMES).toEqual(["success", "rolled_back"]);
  });
});
