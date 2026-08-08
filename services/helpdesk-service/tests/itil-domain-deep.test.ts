/**
 * Helpdesk Service — ITIL Domain: Deep tests for ticket type state machines.
 *
 * Tests incident/problem/change workflows, initial statuses, valid transitions,
 * invalid transitions, type-specific required fields, and status validation.
 *
 * Source: modules/tickets/itil-domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  TICKET_TYPES, INCIDENT_STATUSES, PROBLEM_STATUSES, CHANGE_STATUSES,
  getStatusesForType, getInitialStatus, isValidTransition, getValidNextStatuses,
  isValidStatusForType, validateTypeFields, getRequiredFieldNames,
} from "../src/modules/tickets/itil-domain.js";

describe("TICKET_TYPES constant", () => {
  it("contains exactly 3 types", () => expect(TICKET_TYPES).toHaveLength(3));
  it("incident, problem, change", () => expect([...TICKET_TYPES]).toEqual(["incident", "problem", "change"]));
});

describe("getInitialStatus", () => {
  it("incident starts at 'open'", () => expect(getInitialStatus("incident")).toBe("open"));
  it("problem starts at 'identified'", () => expect(getInitialStatus("problem")).toBe("identified"));
  it("change starts at 'requested'", () => expect(getInitialStatus("change")).toBe("requested"));
});

describe("getStatusesForType", () => {
  it("incident: open, investigating, resolved, closed", () => {
    expect([...getStatusesForType("incident")]).toEqual(["open", "investigating", "resolved", "closed"]);
  });
  it("problem: identified, root_cause, fix_applied, closed", () => {
    expect([...getStatusesForType("problem")]).toEqual(["identified", "root_cause", "fix_applied", "closed"]);
  });
  it("change: requested, approved, implemented, reviewed, closed", () => {
    expect([...getStatusesForType("change")]).toEqual(["requested", "approved", "implemented", "reviewed", "closed"]);
  });
});

describe("isValidTransition — incident workflow", () => {
  it("open → investigating", () => expect(isValidTransition("incident", "open", "investigating")).toBe(true));
  it("investigating → resolved", () => expect(isValidTransition("incident", "investigating", "resolved")).toBe(true));
  it("resolved → closed", () => expect(isValidTransition("incident", "resolved", "closed")).toBe(true));
  it("closed is terminal", () => expect(isValidTransition("incident", "closed", "open")).toBe(false));
  it("open → resolved is illegal (skip)", () => expect(isValidTransition("incident", "open", "resolved")).toBe(false));
  it("open → closed is illegal", () => expect(isValidTransition("incident", "open", "closed")).toBe(false));
});

describe("isValidTransition — problem workflow", () => {
  it("identified → root_cause", () => expect(isValidTransition("problem", "identified", "root_cause")).toBe(true));
  it("root_cause → fix_applied", () => expect(isValidTransition("problem", "root_cause", "fix_applied")).toBe(true));
  it("fix_applied → closed", () => expect(isValidTransition("problem", "fix_applied", "closed")).toBe(true));
  it("identified → closed is illegal", () => expect(isValidTransition("problem", "identified", "closed")).toBe(false));
  it("closed is terminal", () => expect(isValidTransition("problem", "closed", "identified")).toBe(false));
});

describe("isValidTransition — change workflow", () => {
  it("requested → approved", () => expect(isValidTransition("change", "requested", "approved")).toBe(true));
  it("approved → implemented", () => expect(isValidTransition("change", "approved", "implemented")).toBe(true));
  it("implemented → reviewed", () => expect(isValidTransition("change", "implemented", "reviewed")).toBe(true));
  it("reviewed → closed", () => expect(isValidTransition("change", "reviewed", "closed")).toBe(true));
  it("requested → implemented is illegal (skip approval)", () => expect(isValidTransition("change", "requested", "implemented")).toBe(false));
  it("closed is terminal", () => expect(isValidTransition("change", "closed", "requested")).toBe(false));
});

describe("getValidNextStatuses", () => {
  it("incident open → [investigating]", () => expect([...getValidNextStatuses("incident", "open")]).toEqual(["investigating"]));
  it("problem root_cause → [fix_applied]", () => expect([...getValidNextStatuses("problem", "root_cause")]).toEqual(["fix_applied"]));
  it("change closed → []", () => expect([...getValidNextStatuses("change", "closed")]).toEqual([]));
  it("unknown status → []", () => expect([...getValidNextStatuses("incident", "unknown")]).toEqual([]));
});

describe("isValidStatusForType", () => {
  it("open is valid for incident", () => expect(isValidStatusForType("incident", "open")).toBe(true));
  it("open is NOT valid for problem", () => expect(isValidStatusForType("problem", "open")).toBe(false));
  it("requested is valid for change", () => expect(isValidStatusForType("change", "requested")).toBe(true));
  it("requested is NOT valid for incident", () => expect(isValidStatusForType("incident", "requested")).toBe(false));
});

describe("validateTypeFields — required field checks", () => {
  it("incident requires impactLevel + urgency", () => {
    expect(getRequiredFieldNames("incident")).toEqual(["impactLevel", "urgency"]);
  });
  it("problem requires symptomDescription", () => {
    expect(getRequiredFieldNames("problem")).toEqual(["symptomDescription"]);
  });
  it("change requires changeReason + riskAssessment", () => {
    expect(getRequiredFieldNames("change")).toEqual(["changeReason", "riskAssessment"]);
  });

  it("returns missing fields when not provided", () => {
    expect(validateTypeFields("incident", undefined)).toEqual(["impactLevel", "urgency"]);
  });
  it("returns empty when all provided", () => {
    expect(validateTypeFields("incident", { impactLevel: "high", urgency: "critical" })).toEqual([]);
  });
  it("identifies individual missing fields", () => {
    expect(validateTypeFields("incident", { impactLevel: "high" })).toEqual(["urgency"]);
  });
  it("treats empty strings as missing", () => {
    expect(validateTypeFields("problem", { symptomDescription: "" })).toEqual(["symptomDescription"]);
  });
  it("treats null as missing", () => {
    expect(validateTypeFields("change", { changeReason: null, riskAssessment: "low" })).toEqual(["changeReason"]);
  });
});
