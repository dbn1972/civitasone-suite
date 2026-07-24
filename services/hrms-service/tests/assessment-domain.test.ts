import { describe, it, expect } from "vitest";
import {
  gradeAttempt, decidePass, canAttempt, issueCertificate, evaluateCertificateStatus,
  type GradableQuestion,
} from "../src/modules/assessment/domain.js";

const Q: GradableQuestion[] = [
  { id: "q1", qtype: "single",    correct: ["a"],      marks: 5 },
  { id: "q2", qtype: "truefalse", correct: ["true"],   marks: 3 },
  { id: "q3", qtype: "multi",     correct: ["a", "c"], marks: 4 },
];

describe("assessment domain — gradeAttempt", () => {
  it("awards full marks for correct single + truefalse + multi", () => {
    const r = gradeAttempt(Q, [
      { questionId: "q1", response: ["a"] },
      { questionId: "q2", response: ["true"] },
      { questionId: "q3", response: ["c", "a"] }, // order-independent
    ]);
    expect(r.score).toBe(12);
    expect(r.perQuestion).toEqual([
      { questionId: "q1", awarded: 5 },
      { questionId: "q2", awarded: 3 },
      { questionId: "q3", awarded: 4 },
    ]);
  });

  it("single wrong answer awards 0", () => {
    const r = gradeAttempt([Q[0]], [{ questionId: "q1", response: ["b"] }]);
    expect(r.score).toBe(0);
  });

  it("multi with a missing selection (partial) awards 0, not partial credit", () => {
    const r = gradeAttempt([Q[2]], [{ questionId: "q3", response: ["a"] }]);
    expect(r.score).toBe(0);
  });

  it("multi with an extra selection awards 0", () => {
    const r = gradeAttempt([Q[2]], [{ questionId: "q3", response: ["a", "c", "d"] }]);
    expect(r.score).toBe(0);
  });

  it("unanswered question awards 0", () => {
    const r = gradeAttempt(Q, []);
    expect(r.score).toBe(0);
  });
});

describe("assessment domain — decidePass", () => {
  it("passes when score exactly equals passing score (boundary)", () => {
    expect(decidePass(10, 10)).toBe(true);
  });
  it("passes when above", () => {
    expect(decidePass(11, 10)).toBe(true);
  });
  it("fails when below", () => {
    expect(decidePass(9, 10)).toBe(false);
  });
});

describe("assessment domain — canAttempt", () => {
  it("allows when under the cap", () => {
    expect(canAttempt(0, 1)).toBe(true);
    expect(canAttempt(2, 3)).toBe(true);
  });
  it("blocks at the cap", () => {
    expect(canAttempt(1, 1)).toBe(false);
    expect(canAttempt(3, 3)).toBe(false);
  });
});

describe("assessment domain — issueCertificate", () => {
  const issuedAt = new Date("2026-01-15T00:00:00.000Z");
  it("computes validUntil = issuedAt + validityMonths", () => {
    const c = issueCertificate({ validityMonths: 12 }, {}, {
      certificateNo: "CERT-1", verifyToken: "tok1", issuedAt, validityMonths: 12,
    });
    expect(c.certificateNo).toBe("CERT-1");
    expect(c.verifyToken).toBe("tok1");
    expect(c.validUntil?.toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });
  it("validUntil is null when no validity window configured", () => {
    const c = issueCertificate({ validityMonths: null }, {}, {
      certificateNo: "CERT-2", verifyToken: "tok2", issuedAt, validityMonths: null,
    });
    expect(c.validUntil).toBeNull();
  });
});

describe("assessment domain — evaluateCertificateStatus", () => {
  const validUntil = new Date("2027-01-15T00:00:00.000Z");
  it("active before expiry", () => {
    expect(evaluateCertificateStatus({ status: "active", validUntil }, new Date("2026-06-01"))).toBe("active");
  });
  it("expired after validUntil", () => {
    expect(evaluateCertificateStatus({ status: "active", validUntil }, new Date("2027-06-01"))).toBe("expired");
  });
  it("active forever when validUntil null", () => {
    expect(evaluateCertificateStatus({ status: "active", validUntil: null }, new Date("2099-01-01"))).toBe("active");
  });
  it("revoked wins regardless of dates", () => {
    expect(evaluateCertificateStatus({ status: "revoked", validUntil }, new Date("2026-06-01"))).toBe("revoked");
  });
});
