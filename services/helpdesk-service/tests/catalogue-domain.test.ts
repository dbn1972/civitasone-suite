/**
 * Service Catalogue (SVC-129) — pure domain logic tests.
 *
 * Covers: request-form validation, fulfilment stage state machine, request
 * status state machine, maker-checker rule, SLA/OLA target resolution and
 * breach detection.
 */
import { describe, it, expect } from "vitest";
import {
  validateFormData,
  stageKeys,
  firstStage,
  isTerminalStage,
  nextStage,
  canAdvanceStage,
  canFulfil,
  canTransitionRequest,
  initialRequestState,
  stateAfterApproval,
  isDistinctChecker,
  resolveSlaTargets,
  evaluateRequestSla,
  resolveOlaTarget,
  shouldEscalateBreach,
  type FormField,
  type FulfilmentStage,
  type OlaTarget,
} from "../src/modules/catalogue/domain.js";
import type { SlaPolicy } from "../src/modules/sla/domain.js";

const schema: FormField[] = [
  { key: "reason", label: "Reason", type: "text", required: true },
  { key: "count", label: "Count", type: "number" },
  { key: "urgent", label: "Urgent", type: "boolean" },
  { key: "tier", label: "Tier", type: "select", options: ["gold", "silver"] },
  { key: "notes", label: "Notes", type: "textarea" },
];

const stages: FulfilmentStage[] = [
  { key: "triage", name: "Triage" },
  { key: "provision", name: "Provision", assigneeRole: "helpdesk_agent" },
  { key: "verify", name: "Verify" },
];

function policy(overrides: Partial<SlaPolicy> = {}): SlaPolicy {
  return { id: "p1", tenantId: "t1", priority: "medium", category: null, responseMinutes: 60, resolutionMinutes: 240, ...overrides };
}

describe("validateFormData", () => {
  it("passes when required fields present and types valid", () => {
    expect(validateFormData(schema, { reason: "x", count: 3, urgent: true, tier: "gold", notes: "n" })).toEqual([]);
  });
  it("accepts numeric strings for number fields", () => {
    expect(validateFormData(schema, { reason: "x", count: "5" })).toEqual([]);
  });
  it("flags a missing required field", () => {
    expect(validateFormData(schema, {})).toContain("Missing required field: Reason");
  });
  it("treats empty string as missing for required", () => {
    expect(validateFormData(schema, { reason: "" })).toContain("Missing required field: Reason");
  });
  it("flags a non-numeric number field", () => {
    expect(validateFormData(schema, { reason: "x", count: "abc" })).toContain("Field 'Count' must be a number");
  });
  it("flags a non-boolean boolean field", () => {
    expect(validateFormData(schema, { reason: "x", urgent: "yes" })).toContain("Field 'Urgent' must be a boolean");
  });
  it("flags a select value not in options", () => {
    expect(validateFormData(schema, { reason: "x", tier: "bronze" })).toContain("Field 'Tier' must be one of: gold, silver");
  });
  it("flags a non-string text field", () => {
    expect(validateFormData(schema, { reason: 5 as unknown as string })).toContain("Field 'Reason' must be text");
  });
  it("ignores optional missing fields and unknown extra keys", () => {
    expect(validateFormData(schema, { reason: "x", extra: "ignored" })).toEqual([]);
  });
  it("passes a select with no options declared", () => {
    expect(validateFormData([{ key: "k", label: "K", type: "select" }], { k: "anything" })).toEqual([]);
  });
});

describe("fulfilment stage machine", () => {
  it("stageKeys / firstStage", () => {
    expect(stageKeys(stages)).toEqual(["triage", "provision", "verify"]);
    expect(firstStage(stages)?.key).toBe("triage");
    expect(firstStage([])).toBeNull();
  });
  it("isTerminalStage", () => {
    expect(isTerminalStage(stages, "verify")).toBe(true);
    expect(isTerminalStage(stages, "triage")).toBe(false);
    expect(isTerminalStage([], "x")).toBe(false);
  });
  it("nextStage", () => {
    expect(nextStage(stages, "triage")?.key).toBe("provision");
    expect(nextStage(stages, "verify")).toBeNull();
    expect(nextStage(stages, "unknown")).toBeNull();
  });
  it("canAdvanceStage only allows the immediate next stage", () => {
    expect(canAdvanceStage(stages, "triage", "provision")).toBe(true);
    expect(canAdvanceStage(stages, "triage", "verify")).toBe(false); // skip
    expect(canAdvanceStage(stages, "provision", "triage")).toBe(false); // backward
    expect(canAdvanceStage(stages, "verify", "verify")).toBe(false); // past end
  });
  it("canFulfil", () => {
    expect(canFulfil([], null)).toBe(true); // no stages
    expect(canFulfil(stages, "verify")).toBe(true); // terminal
    expect(canFulfil(stages, "triage")).toBe(false);
    expect(canFulfil(stages, null)).toBe(false);
  });
});

describe("request status machine", () => {
  it("allows valid transitions and blocks invalid", () => {
    expect(canTransitionRequest("pending_approval", "approved")).toBe(true);
    expect(canTransitionRequest("in_fulfilment", "fulfilled")).toBe(true);
    expect(canTransitionRequest("fulfilled", "in_fulfilment")).toBe(false);
    expect(canTransitionRequest("rejected", "approved")).toBe(false);
  });
  it("unknown source status falls back to no allowed transitions", () => {
    expect(canTransitionRequest("bogus" as never, "approved")).toBe(false);
  });
  it("initialRequestState routes to approval when required", () => {
    expect(initialRequestState(true, stages)).toEqual({ status: "pending_approval", stage: null });
  });
  it("initialRequestState starts fulfilment at first stage when no approval", () => {
    expect(initialRequestState(false, stages)).toEqual({ status: "in_fulfilment", stage: "triage" });
  });
  it("initialRequestState pending_fulfilment when no stages", () => {
    expect(initialRequestState(false, [])).toEqual({ status: "pending_fulfilment", stage: null });
  });
  it("stateAfterApproval approved → first stage / pending_fulfilment", () => {
    expect(stateAfterApproval("approved", stages)).toEqual({ status: "in_fulfilment", stage: "triage" });
    expect(stateAfterApproval("approved", [])).toEqual({ status: "pending_fulfilment", stage: null });
  });
  it("stateAfterApproval rejected → rejected", () => {
    expect(stateAfterApproval("rejected", stages)).toEqual({ status: "rejected", stage: null });
  });
});

describe("maker-checker", () => {
  it("distinct checker allowed, same actor blocked (case-insensitive)", () => {
    expect(isDistinctChecker("USER-A", "user-b")).toBe(true);
    expect(isDistinctChecker("USER-A", "user-a")).toBe(false);
  });
});

describe("SLA / OLA resolution (reuses sla engine)", () => {
  it("resolveSlaTargets computes response + resolution deadlines", () => {
    const created = new Date("2025-01-01T00:00:00Z");
    const d = resolveSlaTargets(created, policy({ responseMinutes: 60, resolutionMinutes: 240 }));
    expect(d.responseDeadline).toEqual(new Date("2025-01-01T01:00:00Z"));
    expect(d.resolutionDeadline).toEqual(new Date("2025-01-01T04:00:00Z"));
  });
  it("evaluateRequestSla returns breached past deadline", () => {
    const created = new Date("2025-01-01T00:00:00Z");
    const now = new Date("2025-01-01T05:00:00Z");
    expect(evaluateRequestSla(now, created, policy({ resolutionMinutes: 240 })).status).toBe("breached");
  });
  it("resolveOlaTarget picks the tightest target", () => {
    const olas: OlaTarget[] = [
      { id: "1", name: "Network UC", kind: "uc", provider: "ISP", targetMinutes: 480 },
      { id: "2", name: "Provision OLA", kind: "ola", provider: "IT", targetMinutes: 120 },
    ];
    expect(resolveOlaTarget(olas)?.id).toBe("2");
    // reversed order exercises the reduce's "keep accumulator" branch too
    expect(resolveOlaTarget([...olas].reverse())?.id).toBe("2");
    expect(resolveOlaTarget([])).toBeNull();
  });
  it("shouldEscalateBreach only when breached and not already escalated", () => {
    const now = new Date("2025-01-01T05:00:00Z");
    const past = new Date("2025-01-01T04:00:00Z");
    const future = new Date("2025-01-01T06:00:00Z");
    expect(shouldEscalateBreach(now, past, false)).toBe(true);
    expect(shouldEscalateBreach(now, past, true)).toBe(false); // already escalated
    expect(shouldEscalateBreach(now, future, false)).toBe(false); // not yet breached
    expect(shouldEscalateBreach(now, null, false)).toBe(false); // no deadline
  });
});
