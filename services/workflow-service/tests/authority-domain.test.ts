/** CAP-025 — authority matrix pure domain: limit resolution + escalation. */
import { describe, it, expect } from "vitest";
import {
  isEffective,
  resolveActorLimit,
  evaluateAuthority,
  resolveEscalation,
  type AuthorityLimit,
} from "../src/modules/authority/domain.js";

function limit(p: Partial<AuthorityLimit> & { id: string; scopeRef: string; maxAmount: number }): AuthorityLimit {
  return {
    scopeType: "role",
    authorityType: "financial",
    currency: "INR",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    escalateToScopeType: null,
    escalateToRef: null,
    status: "active",
    ...p,
  } as AuthorityLimit;
}

// A three-tier escalation ladder: officer → director → board.
const OFFICER = limit({ id: "l1", scopeRef: "officer", maxAmount: 100_000, escalateToScopeType: "role", escalateToRef: "director" });
const DIRECTOR = limit({ id: "l2", scopeRef: "director", maxAmount: 1_000_000, escalateToScopeType: "role", escalateToRef: "board" });
const BOARD = limit({ id: "l3", scopeRef: "board", maxAmount: 100_000_000 });
const LADDER = [OFFICER, DIRECTOR, BOARD];

describe("isEffective", () => {
  it("respects status, from and to bounds", () => {
    expect(isEffective(OFFICER, "2025-01-01")).toBe(true);
    expect(isEffective(limit({ id: "x", scopeRef: "r", maxAmount: 1, status: "draft" }), "2025-01-01")).toBe(false);
    expect(isEffective(limit({ id: "x", scopeRef: "r", maxAmount: 1, effectiveFrom: "2026-01-01" }), "2025-01-01")).toBe(false);
    expect(isEffective(limit({ id: "x", scopeRef: "r", maxAmount: 1, effectiveTo: "2024-12-31" }), "2025-01-01")).toBe(false);
  });
});

describe("resolveActorLimit", () => {
  it("picks the highest effective limit across the actor's scopes", () => {
    const actor = { scopes: [{ scopeType: "role" as const, scopeRef: "officer" }, { scopeType: "role" as const, scopeRef: "director" }] };
    const best = resolveActorLimit(LADDER, actor, "financial", "2025-01-01");
    expect(best?.scopeRef).toBe("director");
  });
  it("returns null when the actor holds no applicable limit", () => {
    const actor = { scopes: [{ scopeType: "role" as const, scopeRef: "intern" }] };
    expect(resolveActorLimit(LADDER, actor, "financial", "2025-01-01")).toBeNull();
  });
});

describe("evaluateAuthority — within authority", () => {
  it("approves when amount is within the actor's own limit (no escalation)", () => {
    const actor = { scopes: [{ scopeType: "role" as const, scopeRef: "director" }] };
    const d = evaluateAuthority(LADDER, actor, "financial", 500_000, "2025-01-01");
    expect(d.withinActorAuthority).toBe(true);
    expect(d.requiresEscalation).toBe(false);
    expect(d.escalationChain).toHaveLength(0);
    expect(d.finalApprover?.scopeRef).toBe("director");
  });
});

describe("evaluateAuthority — limit exceeded triggers escalation", () => {
  it("escalates an officer's over-limit request up to the director who can cover it", () => {
    const actor = { scopes: [{ scopeType: "role" as const, scopeRef: "officer" }] };
    const d = evaluateAuthority(LADDER, actor, "financial", 500_000, "2025-01-01");
    expect(d.withinActorAuthority).toBe(false);
    expect(d.requiresEscalation).toBe(true);
    expect(d.escalationChain.map((c) => c.scopeRef)).toEqual(["director"]);
    expect(d.covered).toBe(true);
    expect(d.finalApprover?.scopeRef).toBe("director");
  });

  it("walks the full ladder to the board for a very large amount", () => {
    const actor = { scopes: [{ scopeType: "role" as const, scopeRef: "officer" }] };
    const d = evaluateAuthority(LADDER, actor, "financial", 50_000_000, "2025-01-01");
    expect(d.escalationChain.map((c) => c.scopeRef)).toEqual(["director", "board"]);
    expect(d.finalApprover?.scopeRef).toBe("board");
    expect(d.covered).toBe(true);
  });

  it("reports uncovered when no office in the chain can authorise the amount", () => {
    const actor = { scopes: [{ scopeType: "role" as const, scopeRef: "officer" }] };
    const d = evaluateAuthority(LADDER, actor, "financial", 500_000_000, "2025-01-01");
    expect(d.covered).toBe(false);
    expect(d.finalApprover).toBeNull();
    expect(d.requiresEscalation).toBe(true);
  });
});

describe("resolveEscalation — cycle guard", () => {
  it("terminates on a cyclic escalation chain", () => {
    const a = limit({ id: "a", scopeRef: "a", maxAmount: 10, escalateToScopeType: "role", escalateToRef: "b" });
    const b = limit({ id: "b", scopeRef: "b", maxAmount: 20, escalateToScopeType: "role", escalateToRef: "a" });
    const res = resolveEscalation([a, b], a, 1000, "financial", "2025-01-01");
    expect(res.covered).toBe(false);
    expect(res.escalationChain.length).toBeLessThanOrEqual(2);
  });
});
