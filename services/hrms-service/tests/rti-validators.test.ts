/**
 * HRMS Pack #45 — RTI: validator boundary tests.
 *
 * Source: modules/rti/validators.ts
 * Tests filing, PIO assignment, response, appeal, closure.
 */
import { describe, it, expect } from "vitest";
import {
  fileRtiBody,
  assignPioBody,
  respondRtiBody,
  appealRtiBody,
  closeRtiBody,
  idParam,
} from "../src/modules/rti/validators.js";

describe("fileRtiBody — RTI filing validation", () => {
  const valid = {
    referenceNo: "RTI/2026/0001",
    applicantName: "Test Applicant",
    subject: "Request for information regarding promotions",
    requestText: "Please provide details of all promotions in 2025-26.",
    receivedDate: "2026-07-01",
  };

  it("accepts valid RTI filing", () => {
    expect(fileRtiBody.safeParse(valid).success).toBe(true);
  });

  it("rejects empty referenceNo", () => {
    expect(fileRtiBody.safeParse({ ...valid, referenceNo: "" }).success).toBe(false);
  });

  it("rejects referenceNo exceeding 64 chars", () => {
    expect(fileRtiBody.safeParse({ ...valid, referenceNo: "x".repeat(65) }).success).toBe(false);
  });

  it("rejects empty applicantName", () => {
    expect(fileRtiBody.safeParse({ ...valid, applicantName: "" }).success).toBe(false);
  });

  it("rejects empty subject", () => {
    expect(fileRtiBody.safeParse({ ...valid, subject: "" }).success).toBe(false);
  });

  it("rejects subject exceeding 512 chars", () => {
    expect(fileRtiBody.safeParse({ ...valid, subject: "x".repeat(513) }).success).toBe(false);
  });

  it("rejects empty requestText", () => {
    expect(fileRtiBody.safeParse({ ...valid, requestText: "" }).success).toBe(false);
  });

  it("rejects invalid receivedDate format", () => {
    expect(fileRtiBody.safeParse({ ...valid, receivedDate: "01/07/2026" }).success).toBe(false);
  });

  it("defaults slaDays to 30 (RTI Act requirement)", () => {
    const result = fileRtiBody.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.slaDays).toBe(30);
  });

  it("rejects slaDays above 60", () => {
    expect(fileRtiBody.safeParse({ ...valid, slaDays: 61 }).success).toBe(false);
  });

  it("rejects zero or negative slaDays", () => {
    expect(fileRtiBody.safeParse({ ...valid, slaDays: 0 }).success).toBe(false);
    expect(fileRtiBody.safeParse({ ...valid, slaDays: -1 }).success).toBe(false);
  });

  it("applicantContact is optional", () => {
    expect(fileRtiBody.safeParse(valid).success).toBe(true);
  });
});

describe("assignPioBody — PIO assignment", () => {
  it("accepts valid UUID", () => {
    expect(assignPioBody.safeParse({ pioId: "10000000-aaaa-4000-8000-000000000001" }).success).toBe(true);
  });
  it("rejects non-UUID", () => {
    expect(assignPioBody.safeParse({ pioId: "bad" }).success).toBe(false);
  });
});

describe("respondRtiBody — response submission", () => {
  it("accepts valid response", () => {
    expect(respondRtiBody.safeParse({ responseText: "Information provided.", respondedDate: "2026-07-15" }).success).toBe(true);
  });
  it("rejects empty responseText", () => {
    expect(respondRtiBody.safeParse({ responseText: "", respondedDate: "2026-07-15" }).success).toBe(false);
  });
  it("rejects invalid date", () => {
    expect(respondRtiBody.safeParse({ responseText: "X", respondedDate: "bad" }).success).toBe(false);
  });
});

describe("appealRtiBody — first appeal", () => {
  it("accepts valid appeal", () => {
    expect(appealRtiBody.safeParse({ appealText: "Not satisfied with response.", appealDate: "2026-08-01" }).success).toBe(true);
  });
  it("rejects empty appealText", () => {
    expect(appealRtiBody.safeParse({ appealText: "", appealDate: "2026-08-01" }).success).toBe(false);
  });
});

describe("closeRtiBody — closure", () => {
  it("accepts valid closure date", () => {
    expect(closeRtiBody.safeParse({ closedDate: "2026-08-15" }).success).toBe(true);
  });
  it("rejects invalid date format", () => {
    expect(closeRtiBody.safeParse({ closedDate: "15-08-2026" }).success).toBe(false);
  });
});

describe("idParam", () => {
  it("accepts valid UUID", () => {
    expect(idParam.safeParse({ id: "10000000-aaaa-4000-8000-000000000001" }).success).toBe(true);
  });
  it("rejects non-UUID", () => {
    expect(idParam.safeParse({ id: "bad" }).success).toBe(false);
  });
});
