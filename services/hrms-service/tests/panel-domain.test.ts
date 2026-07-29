import { describe, it, expect } from "vitest";
import {
  unrecusedConflicts, panelReadiness, validateOutcome, type Panelist,
} from "../src/modules/recruitment/panel-domain.js";

const P = (over: Partial<Panelist> = {}): Panelist => ({ memberId: "m", panelRole: "member", coiDeclared: false, coiType: "none", recused: false, ...over });

describe("unrecusedConflicts", () => {
  it("flags declared, un-recused conflicts only", () => {
    const list = [
      P({ memberId: "a" }),                                              // clean
      P({ memberId: "b", coiDeclared: true, coiType: "relative" }),      // conflict, not recused
      P({ memberId: "c", coiDeclared: true, coiType: "financial", recused: true }), // recused -> ok
    ];
    expect(unrecusedConflicts(list).map((p) => p.memberId)).toEqual(["b"]);
  });
});

describe("panelReadiness", () => {
  it("is ready with a chair, an active voter and no unrecused COI", () => {
    const r = panelReadiness([P({ memberId: "chair", panelRole: "chair" }), P({ memberId: "m1" })]);
    expect(r.ready).toBe(true);
    expect(r.activeVoters).toBe(2);
  });
  it("is not ready without a chair", () => {
    const r = panelReadiness([P({ memberId: "m1" })]);
    expect(r.ready).toBe(false);
    expect(r.reasons.join()).toMatch(/chair/);
  });
  it("is not ready while a declared conflict is un-recused", () => {
    const r = panelReadiness([P({ memberId: "chair", panelRole: "chair" }), P({ memberId: "x", coiDeclared: true, coiType: "relative" })]);
    expect(r.ready).toBe(false);
    expect(r.unrecusedConflicts).toEqual(["x"]);
  });
  it("becomes ready once the conflicted panelist is recused", () => {
    const r = panelReadiness([P({ memberId: "chair", panelRole: "chair" }), P({ memberId: "x", coiDeclared: true, coiType: "relative", recused: true })]);
    expect(r.ready).toBe(true);
  });
  it("does not count observers or recused members as active voters", () => {
    const r = panelReadiness([P({ memberId: "chair", panelRole: "chair" }), P({ memberId: "o", panelRole: "observer" }), P({ memberId: "r", recused: true })]);
    expect(r.activeVoters).toBe(1); // only the chair
  });
});

describe("validateOutcome", () => {
  const future = new Date(Date.now() + 30 * 86400_000).toISOString();
  const past = new Date(Date.now() - 86400_000).toISOString();
  it("requires a valid rejection reason for a rejection", () => {
    expect(validateOutcome({ status: "rejected" }).length).toBeGreaterThan(0);
    expect(validateOutcome({ status: "rejected", rejectionReason: "no_show" })).toEqual([]);
    expect(validateOutcome({ status: "rejected", rejectionReason: "bogus" }).length).toBeGreaterThan(0);
  });
  it("requires a future validity period for a recommendation", () => {
    expect(validateOutcome({ status: "recommended" }).length).toBeGreaterThan(0);
    expect(validateOutcome({ status: "recommended", validUntil: past, nowMs: Date.now() }).length).toBeGreaterThan(0);
    expect(validateOutcome({ status: "recommended", validUntil: future, nowMs: Date.now() })).toEqual([]);
  });
  it("requires a positive waitlist rank for a waitlist", () => {
    expect(validateOutcome({ status: "waitlisted", validUntil: future, nowMs: Date.now() }).length).toBeGreaterThan(0);
    expect(validateOutcome({ status: "waitlisted", validUntil: future, waitlistRank: 3, nowMs: Date.now() })).toEqual([]);
    expect(validateOutcome({ status: "waitlisted", validUntil: future, waitlistRank: 0, nowMs: Date.now() }).length).toBeGreaterThan(0);
  });
});
