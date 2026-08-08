/**
 * HRMS Assessment & Training Admin — grading, certificates, training capacity tests.
 * Packs #25, #49. Source: modules/assessment/domain.ts, modules/training-admin/domain.ts
 */
import { describe, it, expect } from "vitest";
import { gradeAttempt, decidePass, canAttempt, issueCertificate, evaluateCertificateStatus } from "../src/modules/assessment/domain.js";
import { canApprove, decideApproval, nextWaitlistPosition, pickPromotion, summariseAttendance } from "../src/modules/training-admin/domain.js";

// ─── Assessment Grading ──────────────────────────────────────────────────────
describe("gradeAttempt — auto-grading", () => {
  it("all correct = full score", () => {
    const qs = [{ id: "q1", qtype: "single" as const, correct: ["a"], marks: 10 }, { id: "q2", qtype: "truefalse" as const, correct: ["true"], marks: 5 }];
    const answers = [{ questionId: "q1", response: ["a"] }, { questionId: "q2", response: ["true"] }];
    const r = gradeAttempt(qs, answers);
    expect(r.score).toBe(15);
  });

  it("all wrong = 0", () => {
    const qs = [{ id: "q1", qtype: "single" as const, correct: ["a"], marks: 10 }];
    const answers = [{ questionId: "q1", response: ["b"] }];
    expect(gradeAttempt(qs, answers).score).toBe(0);
  });

  it("multi-select: all-or-nothing (partial = 0)", () => {
    const qs = [{ id: "q1", qtype: "multi" as const, correct: ["a", "b"], marks: 10 }];
    const answers = [{ questionId: "q1", response: ["a"] }]; // missing "b"
    expect(gradeAttempt(qs, answers).score).toBe(0);
  });

  it("multi-select: extra selection = 0", () => {
    const qs = [{ id: "q1", qtype: "multi" as const, correct: ["a", "b"], marks: 10 }];
    const answers = [{ questionId: "q1", response: ["a", "b", "c"] }]; // extra "c"
    expect(gradeAttempt(qs, answers).score).toBe(0);
  });

  it("unanswered = 0 for that question", () => {
    const qs = [{ id: "q1", qtype: "single" as const, correct: ["a"], marks: 10 }, { id: "q2", qtype: "single" as const, correct: ["x"], marks: 5 }];
    const answers = [{ questionId: "q1", response: ["a"] }]; // q2 unanswered
    expect(gradeAttempt(qs, answers).score).toBe(10);
  });
});

describe("decidePass / canAttempt", () => {
  it("pass when score >= passingScore", () => expect(decidePass(70, 70)).toBe(true));
  it("fail when score < passingScore", () => expect(decidePass(69, 70)).toBe(false));
  it("canAttempt when below maxAttempts", () => expect(canAttempt(2, 3)).toBe(true));
  it("cannot attempt when at max", () => expect(canAttempt(3, 3)).toBe(false));
});

describe("issueCertificate", () => {
  it("computes validUntil from issuedAt + validityMonths", () => {
    const cert = issueCertificate({ validityMonths: 12 }, {}, { certificateNo: "C001", verifyToken: "tok", issuedAt: new Date("2026-01-15"), validityMonths: 12 });
    expect(cert.validUntil!.getFullYear()).toBe(2027);
    expect(cert.validUntil!.getMonth()).toBe(0); // January
  });
  it("null validUntil when no validity configured", () => {
    const cert = issueCertificate({}, {}, { certificateNo: "C002", verifyToken: "tok", issuedAt: new Date() });
    expect(cert.validUntil).toBeNull();
  });
});

describe("evaluateCertificateStatus", () => {
  it("revoked wins regardless of date", () => expect(evaluateCertificateStatus({ status: "revoked", validUntil: null }, new Date())).toBe("revoked"));
  it("expired when past validUntil", () => expect(evaluateCertificateStatus({ status: "active", validUntil: new Date("2025-01-01") }, new Date("2026-01-01"))).toBe("expired"));
  it("active when within validUntil", () => expect(evaluateCertificateStatus({ status: "active", validUntil: new Date("2027-01-01") }, new Date("2026-01-01"))).toBe("active"));
  it("active when no validUntil (perpetual)", () => expect(evaluateCertificateStatus({ status: "active", validUntil: null }, new Date())).toBe("active"));
});

// ─── Training Admin ──────────────────────────────────────────────────────────
describe("training admin — canApprove (maker-checker)", () => {
  it("different officers can approve", () => expect(canApprove("user-a", "user-b")).toBe(true));
  it("same officer cannot approve (self-nomination)", () => expect(canApprove("user-a", "user-a")).toBe(false));
  it("null nominator cannot be approved", () => expect(canApprove(null, "user-b")).toBe(false));
});

describe("training admin — capacity & waitlist", () => {
  it("decideApproval: approved when capacity available", () => expect(decideApproval(10, 5)).toBe("approved"));
  it("decideApproval: waitlisted when at capacity", () => expect(decideApproval(10, 10)).toBe("waitlisted"));
  it("nextWaitlistPosition: increments", () => expect(nextWaitlistPosition(3)).toBe(4));
  it("pickPromotion: selects lowest position", () => {
    const waitlisted = [{ id: "n3", waitlistPosition: 3 }, { id: "n1", waitlistPosition: 1 }, { id: "n2", waitlistPosition: 2 }];
    expect(pickPromotion(waitlisted)).toBe("n1");
  });
  it("pickPromotion: null when empty", () => expect(pickPromotion([])).toBeNull());
});

describe("training admin — summariseAttendance", () => {
  it("computes attendance rate", () => {
    const records = [{ status: "present" }, { status: "present" }, { status: "absent" }, { status: "excused" }];
    const s = summariseAttendance(records);
    expect(s.total).toBe(4);
    expect(s.present).toBe(2);
    expect(s.absent).toBe(1);
    expect(s.excused).toBe(1);
    expect(s.attendanceRate).toBe(0.5);
  });
  it("empty = 0 rate", () => expect(summariseAttendance([]).attendanceRate).toBe(0));
});
