/**
 * Citizen Service — Grievance Validators + SLA Rules: Deep test suite.
 *
 * Tests input validation for grievance registration, assignment, actions,
 * escalation, reopen, and SLA rule creation boundaries.
 *
 * Source: modules/grievance/validators.ts, modules/sla-rules/routes.ts
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  registerGrievanceBody,
  assignGrievanceBody,
  grievanceActionBody,
  resolveGrievanceBody,
  escalateGrievanceBody,
  reopenGrievanceBody,
  idParam,
} from "../src/modules/grievance/validators.js";

const VALID_UUID = "10000000-aaaa-4000-8000-000000000001";

// SLA rules validator (replicated from routes.ts inline schema)
const slaRuleCreateBody = z.object({
  priority: z.string().min(1).max(16),
  escalationHours: z.number().int().min(1).max(720),
  escalateTo: z.string().min(1).max(64),
  isActive: z.boolean().default(true),
});

describe("registerGrievanceBody — grievance registration", () => {
  const valid = {
    category: "Water Supply",
    subject: "No water for 3 days",
    description: "Ward 5 has had no water supply since Monday morning.",
  };

  it("accepts valid grievance", () => {
    expect(registerGrievanceBody.safeParse(valid).success).toBe(true);
  });

  it("citizenId is optional (resolved from actor)", () => {
    expect(registerGrievanceBody.safeParse(valid).success).toBe(true);
    expect(registerGrievanceBody.safeParse({ ...valid, citizenId: VALID_UUID }).success).toBe(true);
  });

  it("rejects non-UUID citizenId", () => {
    expect(registerGrievanceBody.safeParse({ ...valid, citizenId: "bad" }).success).toBe(false);
  });

  it("rejects empty category", () => {
    expect(registerGrievanceBody.safeParse({ ...valid, category: "" }).success).toBe(false);
  });

  it("rejects empty subject", () => {
    expect(registerGrievanceBody.safeParse({ ...valid, subject: "" }).success).toBe(false);
  });

  it("rejects empty description", () => {
    expect(registerGrievanceBody.safeParse({ ...valid, description: "" }).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    expect(registerGrievanceBody.safeParse({}).success).toBe(false);
    expect(registerGrievanceBody.safeParse({ category: "X" }).success).toBe(false);
  });
});

describe("assignGrievanceBody — assignment validation", () => {
  it("accepts valid assignment", () => {
    expect(assignGrievanceBody.safeParse({ assignedTo: VALID_UUID }).success).toBe(true);
  });

  it("accepts with departmentRef", () => {
    expect(assignGrievanceBody.safeParse({ assignedTo: VALID_UUID, departmentRef: "dept:water" }).success).toBe(true);
  });

  it("rejects non-UUID assignedTo", () => {
    expect(assignGrievanceBody.safeParse({ assignedTo: "bad" }).success).toBe(false);
  });

  it("rejects missing assignedTo", () => {
    expect(assignGrievanceBody.safeParse({}).success).toBe(false);
  });
});

describe("grievanceActionBody — action/progress recording", () => {
  it("accepts valid action", () => {
    expect(grievanceActionBody.safeParse({ actionType: "site_visit" }).success).toBe(true);
  });

  it("accepts action with note and status", () => {
    expect(grievanceActionBody.safeParse({
      actionType: "investigation",
      note: "Visited the area",
      status: "in_progress",
    }).success).toBe(true);
  });

  it("rejects empty actionType", () => {
    expect(grievanceActionBody.safeParse({ actionType: "" }).success).toBe(false);
  });

  it("rejects invalid status value", () => {
    expect(grievanceActionBody.safeParse({ actionType: "x", status: "closed" }).success).toBe(false);
  });

  it("only accepts in_progress or resolved as status", () => {
    expect(grievanceActionBody.safeParse({ actionType: "x", status: "in_progress" }).success).toBe(true);
    expect(grievanceActionBody.safeParse({ actionType: "x", status: "resolved" }).success).toBe(true);
  });
});

describe("escalateGrievanceBody — escalation validation", () => {
  it("accepts valid escalation with reason", () => {
    expect(escalateGrievanceBody.safeParse({ reason: "Not resolved within SLA" }).success).toBe(true);
  });

  it("accepts with escalatedTo", () => {
    expect(escalateGrievanceBody.safeParse({ reason: "SLA breach", escalatedTo: VALID_UUID }).success).toBe(true);
  });

  it("rejects empty reason", () => {
    expect(escalateGrievanceBody.safeParse({ reason: "" }).success).toBe(false);
  });

  it("rejects missing reason", () => {
    expect(escalateGrievanceBody.safeParse({}).success).toBe(false);
  });

  it("rejects non-UUID escalatedTo", () => {
    expect(escalateGrievanceBody.safeParse({ reason: "X", escalatedTo: "bad" }).success).toBe(false);
  });
});

describe("reopenGrievanceBody — reopen validation", () => {
  it("accepts valid reopen with reason", () => {
    expect(reopenGrievanceBody.safeParse({ reason: "Issue persists" }).success).toBe(true);
  });

  it("rejects empty reason", () => {
    expect(reopenGrievanceBody.safeParse({ reason: "" }).success).toBe(false);
  });

  it("rejects missing reason", () => {
    expect(reopenGrievanceBody.safeParse({}).success).toBe(false);
  });
});

describe("resolveGrievanceBody — resolution", () => {
  it("accepts with optional note", () => {
    expect(resolveGrievanceBody.safeParse({ note: "Issue fixed by contractor" }).success).toBe(true);
  });

  it("accepts empty body (note is optional)", () => {
    expect(resolveGrievanceBody.safeParse({}).success).toBe(true);
  });
});

describe("idParam", () => {
  it("accepts valid UUID", () => {
    expect(idParam.safeParse({ id: VALID_UUID }).success).toBe(true);
  });
  it("rejects non-UUID", () => {
    expect(idParam.safeParse({ id: "bad" }).success).toBe(false);
  });
});

describe("slaRuleCreateBody — SLA rule configuration", () => {
  const valid = {
    priority: "high",
    escalationHours: 48,
    escalateTo: "district_collector",
  };

  it("accepts valid SLA rule", () => {
    expect(slaRuleCreateBody.safeParse(valid).success).toBe(true);
  });

  it("defaults isActive to true", () => {
    const result = slaRuleCreateBody.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isActive).toBe(true);
  });

  it("rejects empty priority", () => {
    expect(slaRuleCreateBody.safeParse({ ...valid, priority: "" }).success).toBe(false);
  });

  it("rejects priority exceeding 16 chars", () => {
    expect(slaRuleCreateBody.safeParse({ ...valid, priority: "x".repeat(17) }).success).toBe(false);
  });

  it("rejects escalationHours below 1", () => {
    expect(slaRuleCreateBody.safeParse({ ...valid, escalationHours: 0 }).success).toBe(false);
  });

  it("rejects escalationHours above 720 (30 days)", () => {
    expect(slaRuleCreateBody.safeParse({ ...valid, escalationHours: 721 }).success).toBe(false);
  });

  it("accepts boundary hours (1 and 720)", () => {
    expect(slaRuleCreateBody.safeParse({ ...valid, escalationHours: 1 }).success).toBe(true);
    expect(slaRuleCreateBody.safeParse({ ...valid, escalationHours: 720 }).success).toBe(true);
  });

  it("rejects non-integer hours", () => {
    expect(slaRuleCreateBody.safeParse({ ...valid, escalationHours: 24.5 }).success).toBe(false);
  });

  it("rejects empty escalateTo", () => {
    expect(slaRuleCreateBody.safeParse({ ...valid, escalateTo: "" }).success).toBe(false);
  });

  it("rejects escalateTo exceeding 64 chars", () => {
    expect(slaRuleCreateBody.safeParse({ ...valid, escalateTo: "x".repeat(65) }).success).toBe(false);
  });
});
