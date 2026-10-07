/**
 * GAP-LEARNING-ASSESSMENTS-02 + GAP-LEARNING-ASSESSMENTS-VERIFY-01: unit tests
 * for the new pure domain functions. Following the established pure-function
 * unit-test pattern (see training/routes.test.ts's doc comment).
 */
import { describe, it, expect } from "vitest";
import {
  visibleAssessmentsForRoles,
  projectCertificateVerification,
  toLearnerSafeQuestion,
} from "./domain.js";

describe("visibleAssessmentsForRoles — GAP-LEARNING-ASSESSMENTS-02", () => {
  const rows = [
    { id: "a1", status: "draft" },
    { id: "a2", status: "pending_approval" },
    { id: "a3", status: "published" },
    { id: "a4", status: "retired" },
  ];

  it("HR sees every status", () => {
    const result = visibleAssessmentsForRoles(rows, true);
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.status)).toEqual(["draft", "pending_approval", "published", "retired"]);
  });

  it("non-HR sees only published assessments", () => {
    const result = visibleAssessmentsForRoles(rows, false);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("published");
  });

  it("non-HR on empty list returns empty", () => {
    expect(visibleAssessmentsForRoles([], false)).toEqual([]);
  });
});

describe("projectCertificateVerification — GAP-LEARNING-ASSESSMENTS-VERIFY-01", () => {
  const cert = {
    certificateNo: "CERT-001",
    employeeId: "emp-uuid-1",
    assessmentId: "asmt-uuid-1",
    issuedAt: new Date("2026-01-15T10:00:00Z"),
    validUntil: null,
  };

  it("HR / owner sees employeeId", () => {
    const view = projectCertificateVerification(cert, "active", true);
    expect(view.employeeId).toBe("emp-uuid-1");
    expect(view.certificateNo).toBe("CERT-001");
    expect(view.status).toBe("active");
  });

  it("non-owner non-HR does NOT see employeeId", () => {
    const view = projectCertificateVerification(cert, "active", false);
    expect(view.employeeId).toBeUndefined();
    expect(view.certificateNo).toBe("CERT-001");
    expect(view.assessmentId).toBe("asmt-uuid-1");
    expect(view.status).toBe("active");
  });

  it("expired status is passed through", () => {
    const view = projectCertificateVerification(cert, "expired", true);
    expect(view.status).toBe("expired");
  });

  it("revoked status is passed through", () => {
    const view = projectCertificateVerification(cert, "revoked", false);
    expect(view.status).toBe("revoked");
    expect(view.employeeId).toBeUndefined();
  });
});

describe("toLearnerSafeQuestion — GAP-LEARNING-ASSESSMENTS-01", () => {
  it("strips the correct answer key and marks from the delivered question", () => {
    const row = {
      id: "q1",
      qtype: "single",
      stem: "What is 2+2?",
      options: [{ id: "a", text: "3" }, { id: "b", text: "4" }],
      correct: ["b"],
      marks: 5,
    };
    const safe = toLearnerSafeQuestion(row) as unknown as Record<string, unknown>;
    expect(safe.id).toBe("q1");
    expect(safe.qtype).toBe("single");
    expect(safe.stem).toBe("What is 2+2?");
    expect(safe.options).toEqual([{ id: "a", text: "3" }, { id: "b", text: "4" }]);
    expect("correct" in safe).toBe(false);
    expect("marks" in safe).toBe(false);
  });
});
