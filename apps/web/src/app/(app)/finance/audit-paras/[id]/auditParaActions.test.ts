import { describe, it, expect } from "vitest";
import { availableParaActions, hasEvents } from "./auditParaActions";

describe("availableParaActions (mirrors the finance-service state machine and role split)", () => {
  it("open: a finance officer may reply or escalate, never settle", () => {
    expect(availableParaActions("open", ["finance_officer"])).toEqual(["respond", "escalate"]);
  });
  it("responded: escalate for finance roles; settle only for admins", () => {
    expect(availableParaActions("responded", ["finance_officer"])).toEqual(["escalate"]);
    expect(availableParaActions("responded", ["finance_admin"])).toEqual(["escalate", "settle"]);
  });
  it("escalated: only a reply can move it on", () => {
    expect(availableParaActions("escalated", ["finance_admin"])).toEqual(["respond"]);
  });
  it("settled / dropped / unknown offer nothing, and audit_officer is read-only", () => {
    expect(availableParaActions("settled", ["super_admin"])).toEqual([]);
    expect(availableParaActions("dropped", ["super_admin"])).toEqual([]);
    expect(availableParaActions(null, ["super_admin"])).toEqual([]);
    expect(availableParaActions("open", ["audit_officer"])).toEqual([]);
    expect(availableParaActions("responded", ["audit_officer"])).toEqual([]);
  });
  it("an empty role list (no claim) does not hide controls: the server decides", () => {
    expect(availableParaActions("responded", [])).toEqual(["escalate", "settle"]);
  });
});

describe("hasEvents", () => {
  it("is true only when the para has a recorded step", () => {
    expect(hasEvents([])).toBe(false);
    expect(hasEvents([{ id: "e1" }])).toBe(true);
  });
});
