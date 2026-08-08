/**
 * HRMS Pack #18 — Training: Validator boundary tests.
 *
 * Source: modules/training/validators.ts
 */
import { describe, it, expect } from "vitest";
import {
  createTrainingBody,
  createNominationBody,
  completeNominationBody,
  myNominationsQuery,
} from "../src/modules/training/validators.js";

describe("createTrainingBody", () => {
  const valid = { title: "Leadership Workshop", fromDate: "2026-09-01", toDate: "2026-09-03" };

  it("accepts valid training", () => {
    expect(createTrainingBody.safeParse(valid).success).toBe(true);
  });

  it("rejects empty title", () => {
    expect(createTrainingBody.safeParse({ ...valid, title: "" }).success).toBe(false);
  });

  it("rejects title exceeding 256 chars", () => {
    expect(createTrainingBody.safeParse({ ...valid, title: "x".repeat(257) }).success).toBe(false);
  });

  it("rejects invalid fromDate", () => {
    expect(createTrainingBody.safeParse({ ...valid, fromDate: "bad" }).success).toBe(false);
  });

  it("rejects invalid toDate", () => {
    expect(createTrainingBody.safeParse({ ...valid, toDate: "2026" }).success).toBe(false);
  });

  it("rejects zero/negative maxParticipants", () => {
    expect(createTrainingBody.safeParse({ ...valid, maxParticipants: 0 }).success).toBe(false);
    expect(createTrainingBody.safeParse({ ...valid, maxParticipants: -1 }).success).toBe(false);
  });

  it("defaults maxParticipants to 30", () => {
    const result = createTrainingBody.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.maxParticipants).toBe(30);
  });

  it("venue and facilitator are optional, capped at 256", () => {
    expect(createTrainingBody.safeParse({ ...valid, venue: "x".repeat(257) }).success).toBe(false);
    expect(createTrainingBody.safeParse({ ...valid, facilitator: "x".repeat(257) }).success).toBe(false);
    expect(createTrainingBody.safeParse({ ...valid, venue: "Hall A", facilitator: "Dr. Smith" }).success).toBe(true);
  });
});

describe("createNominationBody", () => {
  it("accepts valid UUIDs", () => {
    expect(createNominationBody.safeParse({
      trainingId: "10000000-aaaa-4000-8000-000000000001",
      employeeId: "20000000-bbbb-4000-8000-000000000001",
    }).success).toBe(true);
  });

  it("rejects non-UUID trainingId", () => {
    expect(createNominationBody.safeParse({
      trainingId: "bad", employeeId: "20000000-bbbb-4000-8000-000000000001",
    }).success).toBe(false);
  });

  it("rejects non-UUID employeeId", () => {
    expect(createNominationBody.safeParse({
      trainingId: "10000000-aaaa-4000-8000-000000000001", employeeId: "bad",
    }).success).toBe(false);
  });
});

describe("completeNominationBody", () => {
  it("accepts valid completion with pass", () => {
    expect(completeNominationBody.safeParse({ completedDate: "2026-09-03", result: "pass", score: 85 }).success).toBe(true);
  });

  it("accepts fail result", () => {
    expect(completeNominationBody.safeParse({ completedDate: "2026-09-03", result: "fail" }).success).toBe(true);
  });

  it("rejects invalid date", () => {
    expect(completeNominationBody.safeParse({ completedDate: "bad" }).success).toBe(false);
  });

  it("rejects score below 0 or above 100", () => {
    expect(completeNominationBody.safeParse({ completedDate: "2026-09-03", score: -1 }).success).toBe(false);
    expect(completeNominationBody.safeParse({ completedDate: "2026-09-03", score: 101 }).success).toBe(false);
  });

  it("accepts boundary scores (0 and 100)", () => {
    expect(completeNominationBody.safeParse({ completedDate: "2026-09-03", score: 0 }).success).toBe(true);
    expect(completeNominationBody.safeParse({ completedDate: "2026-09-03", score: 100 }).success).toBe(true);
  });

  it("rejects invalid result enum", () => {
    expect(completeNominationBody.safeParse({ completedDate: "2026-09-03", result: "incomplete" }).success).toBe(false);
  });

  it("defaults result to pass", () => {
    const result = completeNominationBody.safeParse({ completedDate: "2026-09-03" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.result).toBe("pass");
  });
});

describe("myNominationsQuery", () => {
  it("accepts valid query", () => {
    expect(myNominationsQuery.safeParse({ employeeId: "20000000-bbbb-4000-8000-000000000001" }).success).toBe(true);
  });

  it("rejects non-UUID employeeId", () => {
    expect(myNominationsQuery.safeParse({ employeeId: "bad" }).success).toBe(false);
  });

  it("rejects limit above 200", () => {
    expect(myNominationsQuery.safeParse({ employeeId: "20000000-bbbb-4000-8000-000000000001", limit: 201 }).success).toBe(false);
  });

  it("defaults limit to 100", () => {
    const result = myNominationsQuery.safeParse({ employeeId: "20000000-bbbb-4000-8000-000000000001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(100);
  });
});
