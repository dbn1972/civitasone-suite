/**
 * Domain logic unit tests — journeys, steps, triggers, executions.
 * Pure function tests: all branches, edge cases, error paths.
 */
import { describe, it, expect } from "vitest";
import {
  validateTransition,
  validateActivation,
  validateEditable,
  validateCreate,
  resolveStep,
} from "../src/modules/journeys/domain.js";
import {
  validateStepType,
  validateStepTransition,
  isStepTerminal,
  validateStepIndex,
} from "../src/modules/steps/domain.js";
import {
  validateTriggerType,
  validateTriggerConfig,
  matchesEvent,
  matchesSegmentEntry,
} from "../src/modules/triggers/domain.js";
import {
  validateExecutionTransition,
  computeNextStatus,
  isTerminal,
  validateEnrollment,
} from "../src/modules/executions/domain.js";

// ── Journey Domain ─────────────────────────────────────────────────────────

describe("journeys/domain — validateTransition", () => {
  it("allows draft → active", () => {
    expect(validateTransition("draft", "active")).toBeNull();
  });

  it("allows draft → archived", () => {
    expect(validateTransition("draft", "archived")).toBeNull();
  });

  it("allows active → paused", () => {
    expect(validateTransition("active", "paused")).toBeNull();
  });

  it("allows active → completed", () => {
    expect(validateTransition("active", "completed")).toBeNull();
  });

  it("allows paused → active (re-activate)", () => {
    expect(validateTransition("paused", "active")).toBeNull();
  });

  it("allows completed → archived", () => {
    expect(validateTransition("completed", "archived")).toBeNull();
  });

  it("rejects draft → completed (skip active)", () => {
    expect(validateTransition("draft", "completed")).not.toBeNull();
  });

  it("rejects archived → anything", () => {
    expect(validateTransition("archived", "active")).not.toBeNull();
    expect(validateTransition("archived", "draft")).not.toBeNull();
  });

  it("rejects completed → active", () => {
    expect(validateTransition("completed", "active")).not.toBeNull();
  });
});

describe("journeys/domain — validateActivation", () => {
  it("returns null when steps exist", () => {
    expect(validateActivation([{ type: "send_notification" }])).toBeNull();
  });

  it("rejects empty steps array", () => {
    expect(validateActivation([])).not.toBeNull();
  });

  it("rejects undefined steps", () => {
    expect(validateActivation(undefined as unknown as Array<Record<string, unknown>>)).not.toBeNull();
  });
});

describe("journeys/domain — validateEditable", () => {
  it("allows editing draft journeys", () => {
    expect(validateEditable("draft")).toBeNull();
  });

  it("rejects editing active journeys", () => {
    expect(validateEditable("active")).not.toBeNull();
  });

  it("rejects editing paused journeys", () => {
    expect(validateEditable("paused")).not.toBeNull();
  });

  it("rejects editing archived journeys", () => {
    expect(validateEditable("archived")).not.toBeNull();
  });
});

describe("journeys/domain — validateCreate", () => {
  it("returns null for valid name", () => {
    expect(validateCreate("My Journey")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(validateCreate("")).not.toBeNull();
  });

  it("rejects whitespace-only", () => {
    expect(validateCreate("   ")).not.toBeNull();
  });

  it("rejects name over 200 chars", () => {
    expect(validateCreate("x".repeat(201))).not.toBeNull();
  });
});

describe("journeys/domain — resolveStep", () => {
  it("returns the type + config of a well-formed step", () => {
    const steps = [{ type: "send_notification", config: { templateId: "t-1" } }];
    expect(resolveStep(steps, 0)).toEqual({ stepType: "send_notification", stepConfig: { templateId: "t-1" } });
  });

  it("defaults config to {} when missing", () => {
    const steps = [{ type: "wait" }];
    expect(resolveStep(steps, 0)).toEqual({ stepType: "wait", stepConfig: {} });
  });

  it("defaults config to {} when it is not a plain object (e.g. an array)", () => {
    const steps = [{ type: "wait", config: ["not", "an", "object"] }];
    expect(resolveStep(steps, 0)).toEqual({ stepType: "wait", stepConfig: {} });
  });

  it("returns null for an out-of-bounds index", () => {
    expect(resolveStep([{ type: "wait" }], 5)).toBeNull();
    expect(resolveStep([], 0)).toBeNull();
  });

  it("returns null when the step has no string type, rather than assuming one", () => {
    expect(resolveStep([{ config: {} }], 0)).toBeNull();
    expect(resolveStep([{ type: 123 }], 0)).toBeNull();
  });
});

// ── Steps Domain ───────────────────────────────────────────────────────────

describe("steps/domain — validateStepType", () => {
  it("accepts send_notification", () => {
    expect(validateStepType("send_notification")).toBeNull();
  });

  it("accepts wait", () => {
    expect(validateStepType("wait")).toBeNull();
  });

  it("accepts condition_check", () => {
    expect(validateStepType("condition_check")).toBeNull();
  });

  it("accepts api_call", () => {
    expect(validateStepType("api_call")).toBeNull();
  });

  it("rejects invalid type", () => {
    expect(validateStepType("unknown_type")).not.toBeNull();
  });
});

describe("steps/domain — validateStepTransition", () => {
  it("allows pending → executing", () => {
    expect(validateStepTransition("pending", "executing")).toBeNull();
  });

  it("allows executing → completed", () => {
    expect(validateStepTransition("executing", "completed")).toBeNull();
  });

  it("allows executing → failed", () => {
    expect(validateStepTransition("executing", "failed")).toBeNull();
  });

  it("allows executing → skipped", () => {
    expect(validateStepTransition("executing", "skipped")).toBeNull();
  });

  it("rejects pending → completed (skip executing)", () => {
    expect(validateStepTransition("pending", "completed")).not.toBeNull();
  });

  it("rejects completed → anything", () => {
    expect(validateStepTransition("completed", "pending")).not.toBeNull();
  });
});

describe("steps/domain — isStepTerminal", () => {
  it("completed is terminal", () => {
    expect(isStepTerminal("completed")).toBe(true);
  });

  it("failed is terminal", () => {
    expect(isStepTerminal("failed")).toBe(true);
  });

  it("skipped is terminal", () => {
    expect(isStepTerminal("skipped")).toBe(true);
  });

  it("pending is not terminal", () => {
    expect(isStepTerminal("pending")).toBe(false);
  });

  it("executing is not terminal", () => {
    expect(isStepTerminal("executing")).toBe(false);
  });
});

describe("steps/domain — validateStepIndex", () => {
  it("valid index within bounds", () => {
    expect(validateStepIndex(0, 3)).toBeNull();
    expect(validateStepIndex(2, 3)).toBeNull();
  });

  it("rejects negative index", () => {
    expect(validateStepIndex(-1, 3)).not.toBeNull();
  });

  it("rejects index equal to total", () => {
    expect(validateStepIndex(3, 3)).not.toBeNull();
  });

  it("rejects index greater than total", () => {
    expect(validateStepIndex(5, 3)).not.toBeNull();
  });
});

// ── Triggers Domain ────────────────────────────────────────────────────────

describe("triggers/domain — validateTriggerType", () => {
  it("accepts event_based", () => {
    expect(validateTriggerType("event_based")).toBeNull();
  });

  it("accepts time_based", () => {
    expect(validateTriggerType("time_based")).toBeNull();
  });

  it("accepts segment_entry", () => {
    expect(validateTriggerType("segment_entry")).toBeNull();
  });

  it("rejects unknown type", () => {
    expect(validateTriggerType("manual")).not.toBeNull();
  });
});

describe("triggers/domain — validateTriggerConfig", () => {
  it("event_based requires eventName", () => {
    expect(validateTriggerConfig("event_based", {})).not.toBeNull();
    expect(validateTriggerConfig("event_based", { eventName: "user.signup" })).toBeNull();
  });

  it("event_based rejects non-string eventName", () => {
    expect(validateTriggerConfig("event_based", { eventName: 123 })).not.toBeNull();
  });

  it("time_based requires schedule", () => {
    expect(validateTriggerConfig("time_based", {})).not.toBeNull();
    expect(validateTriggerConfig("time_based", { schedule: "0 9 * * *" })).toBeNull();
  });

  it("segment_entry requires segmentId", () => {
    expect(validateTriggerConfig("segment_entry", {})).not.toBeNull();
    expect(validateTriggerConfig("segment_entry", { segmentId: "abc-123" })).toBeNull();
  });
});

describe("triggers/domain — matchesEvent", () => {
  it("matches active event_based trigger with correct eventName", () => {
    const trigger = { triggerType: "event_based" as const, config: { eventName: "user.signup" }, status: "active" as const };
    expect(matchesEvent(trigger, { eventName: "user.signup" })).toBe(true);
  });

  it("does not match if eventName differs", () => {
    const trigger = { triggerType: "event_based" as const, config: { eventName: "user.signup" }, status: "active" as const };
    expect(matchesEvent(trigger, { eventName: "order.placed" })).toBe(false);
  });

  it("does not match paused trigger", () => {
    const trigger = { triggerType: "event_based" as const, config: { eventName: "user.signup" }, status: "paused" as const };
    expect(matchesEvent(trigger, { eventName: "user.signup" })).toBe(false);
  });

  it("does not match time_based triggers", () => {
    const trigger = { triggerType: "time_based" as const, config: { schedule: "0 9 * * *" }, status: "active" as const };
    expect(matchesEvent(trigger, { eventName: "user.signup" })).toBe(false);
  });
});

describe("triggers/domain — matchesSegmentEntry", () => {
  it("matches active segment_entry trigger with correct segmentId", () => {
    const trigger = { triggerType: "segment_entry" as const, config: { segmentId: "seg-1" }, status: "active" as const };
    expect(matchesSegmentEntry(trigger, "seg-1")).toBe(true);
  });

  it("does not match wrong segmentId", () => {
    const trigger = { triggerType: "segment_entry" as const, config: { segmentId: "seg-1" }, status: "active" as const };
    expect(matchesSegmentEntry(trigger, "seg-2")).toBe(false);
  });

  it("does not match paused trigger", () => {
    const trigger = { triggerType: "segment_entry" as const, config: { segmentId: "seg-1" }, status: "paused" as const };
    expect(matchesSegmentEntry(trigger, "seg-1")).toBe(false);
  });
});

// ── Executions Domain ──────────────────────────────────────────────────────

describe("executions/domain — validateExecutionTransition", () => {
  it("allows enrolled → in_progress", () => {
    expect(validateExecutionTransition("enrolled", "in_progress")).toBeNull();
  });

  it("allows enrolled → exited", () => {
    expect(validateExecutionTransition("enrolled", "exited")).toBeNull();
  });

  it("allows in_progress → completed", () => {
    expect(validateExecutionTransition("in_progress", "completed")).toBeNull();
  });

  it("allows in_progress → exited", () => {
    expect(validateExecutionTransition("in_progress", "exited")).toBeNull();
  });

  it("rejects completed → anything", () => {
    expect(validateExecutionTransition("completed", "enrolled")).not.toBeNull();
  });

  it("rejects exited → anything", () => {
    expect(validateExecutionTransition("exited", "in_progress")).not.toBeNull();
  });

  it("rejects enrolled → completed (skip in_progress)", () => {
    expect(validateExecutionTransition("enrolled", "completed")).not.toBeNull();
  });
});

describe("executions/domain — computeNextStatus", () => {
  it("returns completed when at last step", () => {
    expect(computeNextStatus(2, 3)).toBe("completed");
  });

  it("returns completed when beyond last step", () => {
    expect(computeNextStatus(5, 3)).toBe("completed");
  });

  it("returns in_progress when more steps remain", () => {
    expect(computeNextStatus(0, 3)).toBe("in_progress");
    expect(computeNextStatus(1, 3)).toBe("in_progress");
  });
});

describe("executions/domain — isTerminal", () => {
  it("completed is terminal", () => {
    expect(isTerminal("completed")).toBe(true);
  });

  it("exited is terminal", () => {
    expect(isTerminal("exited")).toBe(true);
  });

  it("enrolled is not terminal", () => {
    expect(isTerminal("enrolled")).toBe(false);
  });

  it("in_progress is not terminal", () => {
    expect(isTerminal("in_progress")).toBe(false);
  });
});

describe("executions/domain — validateEnrollment", () => {
  it("allows enrollment when journey is active", () => {
    expect(validateEnrollment("active")).toBeNull();
  });

  it("rejects enrollment when journey is draft", () => {
    expect(validateEnrollment("draft")).not.toBeNull();
  });

  it("rejects enrollment when journey is paused", () => {
    expect(validateEnrollment("paused")).not.toBeNull();
  });

  it("rejects enrollment when journey is archived", () => {
    expect(validateEnrollment("archived")).not.toBeNull();
  });
});
