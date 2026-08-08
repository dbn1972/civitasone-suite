/**
 * HRMS Pack #04 — Recruitment: Validator boundary tests.
 *
 * Covers RC-02 (job-opening validation), RC-07 (application validation),
 * public application, offer, and hire validators.
 *
 * Source: modules/recruitment/validators.ts
 */
import { describe, it, expect } from "vitest";
import {
  createJobOpeningBody,
  createApplicationBody,
  publicApplicationBody,
  offerApplicationBody,
  hireApplicationBody,
  VACANCY_TYPES,
} from "../src/modules/recruitment/validators.js";

describe("createJobOpeningBody — RC-02: job-opening validation", () => {
  const valid = {
    refNo: "REC-2026-001",
    title: "Assistant Engineer",
    departmentId: "53000000-eeee-4000-8000-000000000001",
  };

  it("accepts valid minimum fields", () => {
    expect(createJobOpeningBody.safeParse(valid).success).toBe(true);
  });

  it("rejects empty refNo", () => {
    expect(createJobOpeningBody.safeParse({ ...valid, refNo: "" }).success).toBe(false);
  });

  it("rejects refNo exceeding 64 chars", () => {
    expect(createJobOpeningBody.safeParse({ ...valid, refNo: "x".repeat(65) }).success).toBe(false);
  });

  it("rejects empty title", () => {
    expect(createJobOpeningBody.safeParse({ ...valid, title: "" }).success).toBe(false);
  });

  it("rejects title exceeding 256 chars", () => {
    expect(createJobOpeningBody.safeParse({ ...valid, title: "x".repeat(257) }).success).toBe(false);
  });

  it("rejects non-UUID departmentId", () => {
    expect(createJobOpeningBody.safeParse({ ...valid, departmentId: "bad" }).success).toBe(false);
  });

  it("rejects zero or negative vacancies", () => {
    expect(createJobOpeningBody.safeParse({ ...valid, vacancies: 0 }).success).toBe(false);
    expect(createJobOpeningBody.safeParse({ ...valid, vacancies: -1 }).success).toBe(false);
  });

  it("rejects non-integer vacancies", () => {
    expect(createJobOpeningBody.safeParse({ ...valid, vacancies: 1.5 }).success).toBe(false);
  });

  it("rejects invalid date format for postedAt/closesAt", () => {
    expect(createJobOpeningBody.safeParse({ ...valid, postedAt: "2026" }).success).toBe(false);
    expect(createJobOpeningBody.safeParse({ ...valid, closesAt: "01/01/2027" }).success).toBe(false);
  });

  it("accepts all valid vacancy types", () => {
    for (const vt of VACANCY_TYPES) {
      expect(createJobOpeningBody.safeParse({ ...valid, vacancyType: vt }).success).toBe(true);
    }
  });

  it("rejects invalid vacancy type", () => {
    expect(createJobOpeningBody.safeParse({ ...valid, vacancyType: "freelance" }).success).toBe(false);
  });

  it("defaults vacancies to 1, isPublished to false, vacancyType to regular", () => {
    const result = createJobOpeningBody.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vacancies).toBe(1);
      expect(result.data.isPublished).toBe(false);
      expect(result.data.vacancyType).toBe("regular");
    }
  });
});

describe("createApplicationBody — RC-07: internal application validation", () => {
  const valid = {
    jobOpeningId: "33000000-cccc-4000-8000-000000000001",
    applicantName: "Test Candidate",
  };

  it("accepts valid minimum application", () => {
    expect(createApplicationBody.safeParse(valid).success).toBe(true);
  });

  it("rejects non-UUID jobOpeningId", () => {
    expect(createApplicationBody.safeParse({ ...valid, jobOpeningId: "bad" }).success).toBe(false);
  });

  it("rejects empty applicantName", () => {
    expect(createApplicationBody.safeParse({ ...valid, applicantName: "" }).success).toBe(false);
  });

  it("rejects applicantName exceeding 256 chars", () => {
    expect(createApplicationBody.safeParse({ ...valid, applicantName: "x".repeat(257) }).success).toBe(false);
  });

  it("rejects invalid email", () => {
    expect(createApplicationBody.safeParse({ ...valid, email: "bad" }).success).toBe(false);
  });

  it("rejects mobile exceeding 20 chars", () => {
    expect(createApplicationBody.safeParse({ ...valid, mobile: "1".repeat(21) }).success).toBe(false);
  });

  it("rejects negative experienceYears", () => {
    expect(createApplicationBody.safeParse({ ...valid, experienceYears: -1 }).success).toBe(false);
  });

  it("rejects skills array exceeding 20 items", () => {
    const skills = Array.from({ length: 21 }, (_, i) => `Skill-${i}`);
    expect(createApplicationBody.safeParse({ ...valid, skills }).success).toBe(false);
  });

  it("rejects skill item exceeding 64 chars", () => {
    expect(createApplicationBody.safeParse({ ...valid, skills: ["x".repeat(65)] }).success).toBe(false);
  });
});

describe("publicApplicationBody — public career portal", () => {
  const valid = {
    jobOpeningId: "33000000-cccc-4000-8000-000000000001",
    applicantName: "Public Candidate",
    email: "candidate@example.test",
  };

  it("accepts valid public application", () => {
    expect(publicApplicationBody.safeParse(valid).success).toBe(true);
  });

  it("requires minimum 2 chars for name", () => {
    expect(publicApplicationBody.safeParse({ ...valid, applicantName: "A" }).success).toBe(false);
  });

  it("requires a valid email (mandatory for public)", () => {
    expect(publicApplicationBody.safeParse({ ...valid, email: undefined }).success).toBe(false);
    expect(publicApplicationBody.safeParse({ ...valid, email: "" }).success).toBe(false);
  });

  it("mobile requires minimum 10 chars", () => {
    expect(publicApplicationBody.safeParse({ ...valid, mobile: "12345" }).success).toBe(false);
    expect(publicApplicationBody.safeParse({ ...valid, mobile: "1234567890" }).success).toBe(true);
  });
});

describe("offerApplicationBody — offer validation", () => {
  it("accepts valid offer", () => {
    expect(offerApplicationBody.safeParse({ ctcMinor: 50000000, currency: "INR" }).success).toBe(true);
  });

  it("rejects zero or negative ctcMinor", () => {
    expect(offerApplicationBody.safeParse({ ctcMinor: 0 }).success).toBe(false);
    expect(offerApplicationBody.safeParse({ ctcMinor: -100 }).success).toBe(false);
  });

  it("rejects non-3-char currency", () => {
    expect(offerApplicationBody.safeParse({ ctcMinor: 100, currency: "IN" }).success).toBe(false);
  });

  it("rejects invalid joining date format", () => {
    expect(offerApplicationBody.safeParse({ ctcMinor: 100, joiningDate: "2026" }).success).toBe(false);
  });

  it("defaults currency to INR", () => {
    const result = offerApplicationBody.safeParse({ ctcMinor: 100 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.currency).toBe("INR");
  });
});

describe("hireApplicationBody — hire validation", () => {
  const valid = {
    employeeNo: "EMP-NEW-001",
    dateOfJoining: "2026-08-01",
    basicMinor: 3000000,
    departmentId: "53000000-eeee-4000-8000-000000000001",
    designationId: "63000000-ffff-4000-8000-000000000001",
  };

  it("accepts valid hire payload", () => {
    expect(hireApplicationBody.safeParse(valid).success).toBe(true);
  });

  it("rejects empty employeeNo", () => {
    expect(hireApplicationBody.safeParse({ ...valid, employeeNo: "" }).success).toBe(false);
  });

  it("rejects invalid dateOfJoining", () => {
    expect(hireApplicationBody.safeParse({ ...valid, dateOfJoining: "bad" }).success).toBe(false);
  });

  it("rejects negative basicMinor", () => {
    expect(hireApplicationBody.safeParse({ ...valid, basicMinor: -1 }).success).toBe(false);
  });

  it("rejects non-UUID departmentId/designationId", () => {
    expect(hireApplicationBody.safeParse({ ...valid, departmentId: "bad" }).success).toBe(false);
    expect(hireApplicationBody.safeParse({ ...valid, designationId: "bad" }).success).toBe(false);
  });

  it("defaults employeeType to permanent", () => {
    const result = hireApplicationBody.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.employeeType).toBe("permanent");
  });
});
