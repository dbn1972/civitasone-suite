import { describe, it, expect } from "vitest";
import {
  slaDaysToMinutes,
  computeLaneDueAt,
  resolveEscalationRecipient,
  isSlaTrackedLane,
  simulateLaneSlaBreach,
  normalizeLaneKey,
  docsForVerificationLane,
  unboundMandatoryDocs,
  assertLaneBindings,
  type LaneBinding,
} from "./lane-bindings.js";

const inspectionLane: LaneBinding = {
  key: "inspection",
  name: "Inspection",
  enabled: true,
  designationId: "pos-inspector",
  designationLabel: "Licensing Inspector",
  slaDays: 7,
  escalationDesignationId: "pos-officer",
  escalationDesignationLabel: "Licensing Officer",
};

describe("FN-25 lane SLA / escalation bindings", () => {
  it("converts SLA days to workflow minutes", () => {
    expect(slaDaysToMinutes(7)).toBe(7 * 24 * 60);
    expect(slaDaysToMinutes(0)).toBeNull();
    expect(slaDaysToMinutes(-1)).toBeNull();
  });

  it("computes a lane due clock from submission time", () => {
    const from = new Date("2026-08-01T00:00:00.000Z");
    const due = computeLaneDueAt(5, from);
    expect(due?.toISOString()).toBe("2026-08-06T00:00:00.000Z");
  });

  it("prefers superior designation as escalation recipient", () => {
    expect(resolveEscalationRecipient(inspectionLane)).toBe("pos-officer");
    expect(resolveEscalationRecipient({ designationId: "pos-inspector" })).toBe("pos-inspector");
    expect(resolveEscalationRecipient({})).toBeNull();
  });

  it("tracks only enabled action lanes with positive SLA", () => {
    expect(isSlaTrackedLane(inspectionLane)).toBe(true);
    expect(isSlaTrackedLane({ ...inspectionLane, key: "submitted" })).toBe(false);
    expect(isSlaTrackedLane({ ...inspectionLane, slaDays: 0 })).toBe(false);
    expect(isSlaTrackedLane({ ...inspectionLane, enabled: false })).toBe(false);
  });

  it("simulates a breached lane with an escalation notification (sandbox acceptance)", () => {
    const sim = simulateLaneSlaBreach(inspectionLane, new Date("2026-08-08T12:00:00.000Z"));
    expect(sim.breached).toBe(true);
    expect(sim.recipient).toBe("pos-officer");
    expect(sim.notification?.eventType).toBe("workflow.task.escalated");
    expect(sim.notification?.summary).toMatch(/Inspection/i);
    expect(sim.notification?.escalateToLabel).toBe("Licensing Officer");
  });

  it("rejects invalid lane binding shapes", () => {
    expect(() => assertLaneBindings([{ key: "", name: "X", slaDays: 1 }])).toThrow("LANE_MISSING_KEY");
    expect(() => assertLaneBindings([
      { key: "a", name: "A", slaDays: 1 },
      { key: "a", name: "A2", slaDays: 2 },
    ])).toThrow("LANE_DUPLICATE_KEY");
    expect(() => assertLaneBindings([{ key: "a", name: "A", slaDays: -1 }])).toThrow("LANE_BAD_SLA");
  });
});

describe("FN-26 document verification lane binding", () => {
  it("normalizes lane_ keys from BPMN node ids", () => {
    expect(normalizeLaneKey("lane_inspection")).toBe("inspection");
    expect(normalizeLaneKey("Inspection")).toBe("inspection");
    expect(normalizeLaneKey("lane.decision")).toBe("decision");
  });

  it("filters required documents for the inspector lane", () => {
    const docs = [
      { docType: "id_proof", mandatory: true, verifiedAtLane: "inspection" },
      { docType: "noc", mandatory: true, verifiedAtLane: "decision" },
      { docType: "photo", mandatory: false, verifiedAtLane: "inspection" },
    ];
    const atInspect = docsForVerificationLane(docs, "lane_inspection");
    expect(atInspect.map((d) => d.docType)).toEqual(["id_proof", "photo"]);
  });

  it("flags mandatory docs without a verifying lane", () => {
    const unbound = unboundMandatoryDocs([
      { docType: "id_proof", mandatory: true },
      { docType: "photo", mandatory: false },
      { docType: "noc", mandatory: true, verifiedAtLane: "inspection" },
    ]);
    expect(unbound.map((d) => d.docType)).toEqual(["id_proof"]);
  });
});
