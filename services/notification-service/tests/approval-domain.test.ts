/**
 * Notification Template Approval — Domain Tests
 *
 * Module: services/notification-service/src/modules/approval
 * Pack: Notification_Module_Test_Pack/03_Template_Approval_Test_Prompt.md
 *
 * Tests:
 *   1. State machine transitions (submit, approve, reject, publish)
 *   2. Invalid transitions blocked with error messages
 *   3. Maker-checker constraint (submitter ≠ approver)
 *   4. canDeliver: only published templates can send
 *   5. Terminal/immutable states
 */
import { describe, it, expect } from "vitest";
import { transitionState, validateMakerChecker, canDeliver } from "../src/modules/approval/domain.js";

// ─── 1. Valid State Transitions ──────────────────────────────────────────────

describe("transitionState — valid transitions", () => {
  it("draft → in_review via submit", () => {
    const r = transitionState("draft", "submit");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newStatus).toBe("in_review");
  });

  it("in_review → approved via approve", () => {
    const r = transitionState("in_review", "approve");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newStatus).toBe("approved");
  });

  it("in_review → draft via reject (returned for rework)", () => {
    const r = transitionState("in_review", "reject");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newStatus).toBe("draft");
  });

  it("approved → published via publish", () => {
    const r = transitionState("approved", "publish");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newStatus).toBe("published");
  });
});

// ─── 2. Invalid Transitions ─────────────────────────────────────────────────

describe("transitionState — invalid transitions blocked", () => {
  it("draft → approved (skip review) is invalid", () => {
    const r = transitionState("draft", "approve");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Invalid transition");
  });

  it("draft → published (skip everything) is invalid", () => {
    const r = transitionState("draft", "publish");
    expect(r.ok).toBe(false);
  });

  it("in_review → published (skip approval) is invalid", () => {
    const r = transitionState("in_review", "publish");
    expect(r.ok).toBe(false);
  });

  it("published is terminal — no further transitions", () => {
    const r = transitionState("published", "submit");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Cannot transition");
  });

  it("approved cannot be re-submitted", () => {
    const r = transitionState("approved", "submit");
    expect(r.ok).toBe(false);
  });

  it("unknown status → error", () => {
    const r = transitionState("nonexistent", "submit");
    expect(r.ok).toBe(false);
  });
});

// ─── 3. Maker-Checker Constraint ─────────────────────────────────────────────

describe("validateMakerChecker — role separation", () => {
  it("different actors → valid (true)", () => {
    expect(validateMakerChecker("user-submitter", "user-approver")).toBe(true);
  });

  it("same actor → invalid (false) — self-approval blocked", () => {
    expect(validateMakerChecker("user-a", "user-a")).toBe(false);
  });

  it("empty strings → both empty = same actor = invalid", () => {
    expect(validateMakerChecker("", "")).toBe(false);
  });
});

// ─── 4. canDeliver — only published templates can send ───────────────────────

describe("canDeliver — delivery gate", () => {
  it("published → can deliver", () => {
    expect(canDeliver("published")).toBe(true);
  });

  it("draft → cannot deliver", () => {
    expect(canDeliver("draft")).toBe(false);
  });

  it("in_review → cannot deliver", () => {
    expect(canDeliver("in_review")).toBe(false);
  });

  it("approved (but not yet published) → cannot deliver", () => {
    expect(canDeliver("approved")).toBe(false);
  });
});

// ─── 5. Full lifecycle: draft → submit → approve → publish ───────────────────

describe("full lifecycle walk-through", () => {
  it("completes the happy path in order", () => {
    let status = "draft";

    const r1 = transitionState(status, "submit");
    expect(r1.ok).toBe(true);
    if (r1.ok) status = r1.newStatus;
    expect(status).toBe("in_review");

    const r2 = transitionState(status, "approve");
    expect(r2.ok).toBe(true);
    if (r2.ok) status = r2.newStatus;
    expect(status).toBe("approved");

    const r3 = transitionState(status, "publish");
    expect(r3.ok).toBe(true);
    if (r3.ok) status = r3.newStatus;
    expect(status).toBe("published");

    // Now it's terminal
    expect(canDeliver(status)).toBe(true);
    expect(transitionState(status, "submit").ok).toBe(false);
  });

  it("reject → rework → resubmit cycle", () => {
    let status = "draft";

    // Submit
    const r1 = transitionState(status, "submit");
    if (r1.ok) status = r1.newStatus;
    expect(status).toBe("in_review");

    // Reject (returned to draft)
    const r2 = transitionState(status, "reject");
    if (r2.ok) status = r2.newStatus;
    expect(status).toBe("draft");

    // Re-submit after rework
    const r3 = transitionState(status, "submit");
    if (r3.ok) status = r3.newStatus;
    expect(status).toBe("in_review");

    // Now approve
    const r4 = transitionState(status, "approve");
    if (r4.ok) status = r4.newStatus;
    expect(status).toBe("approved");
  });
});
