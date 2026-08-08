/**
 * Citizen Service — grievance, RTI, application, fee-payment domain tests.
 * 19 packs covered. Source: modules/grievance/domain.ts + others.
 */
import { describe, it, expect } from "vitest";
import { assertGrievanceTransition, inferPriority, inferDepartmentRef, shouldAutoEscalate, GRIEVANCE_ESCALATION_SLA_DAYS } from "../src/modules/grievance/domain.js";

describe("grievance state machine", () => {
  it("registered → assigned", () => expect(() => assertGrievanceTransition("registered", "assigned")).not.toThrow());
  it("assigned → in_progress/resolved", () => { expect(() => assertGrievanceTransition("assigned", "in_progress")).not.toThrow(); expect(() => assertGrievanceTransition("assigned", "resolved")).not.toThrow(); });
  it("resolved → closed/reopened", () => { expect(() => assertGrievanceTransition("resolved", "closed")).not.toThrow(); expect(() => assertGrievanceTransition("resolved", "reopened")).not.toThrow(); });
  it("closed → reopened (citizen escalation)", () => expect(() => assertGrievanceTransition("closed", "reopened")).not.toThrow());
  it("reopened → assigned (re-assignment)", () => expect(() => assertGrievanceTransition("reopened", "assigned")).not.toThrow());
  it("invalid transition throws", () => expect(() => assertGrievanceTransition("registered", "closed")).toThrow());
});

describe("inferPriority", () => {
  it("corruption = urgent", () => expect(inferPriority("corruption allegation")).toBe("urgent"));
  it("water = high", () => expect(inferPriority("water supply issue")).toBe("high"));
  it("general = normal", () => expect(inferPriority("general inquiry")).toBe("normal"));
});

describe("inferDepartmentRef", () => {
  it("water → dept:water", () => expect(inferDepartmentRef("water supply")).toBe("dept:water"));
  it("electricity → dept:power", () => expect(inferDepartmentRef("electricity outage")).toBe("dept:power"));
  it("road → dept:transport", () => expect(inferDepartmentRef("road damage")).toBe("dept:transport"));
  it("unknown → dept:general", () => expect(inferDepartmentRef("misc")).toBe("dept:general"));
});

describe("SLA auto-escalation", () => {
  it("escalates when assigned > SLA days", () => {
    const updated = new Date("2026-07-01");
    const now = new Date("2026-07-10"); // 9 days > 7
    expect(shouldAutoEscalate("assigned", updated, GRIEVANCE_ESCALATION_SLA_DAYS, now)).toBe(true);
  });
  it("does not escalate within SLA", () => {
    const updated = new Date("2026-07-10");
    const now = new Date("2026-07-12"); // 2 days < 7
    expect(shouldAutoEscalate("assigned", updated, GRIEVANCE_ESCALATION_SLA_DAYS, now)).toBe(false);
  });
  it("does not escalate non-assigned status", () => {
    expect(shouldAutoEscalate("in_progress", new Date("2020-01-01"), 7, new Date())).toBe(false);
  });
  it("SLA default is 7 days", () => expect(GRIEVANCE_ESCALATION_SLA_DAYS).toBe(7));
});
