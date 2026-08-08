/**
 * Workflow Service — domain tests (quorum, deviations, workbaskets, checklists).
 * Packs #27, #16, #32, #08.
 */
import { describe, it, expect } from "vitest";
import { tallyQuorum, consolidateParallel } from "../src/modules/quorum/domain.js";
import { validateRaise, canReview, canRevoke, isActive, hasLapsed, decisionStatus } from "../src/modules/deviations/domain.js";
import { normalizeFilter } from "../src/modules/workbaskets/domain.js";
import { instantiate, evaluateGate, toggleItem, validateTemplate } from "../src/modules/checklists/domain.js";

// ─── Quorum ──────────────────────────────────────────────────────────────────
describe("tallyQuorum — majority rule", () => {
  it("approves once majority reached", () => {
    const r = tallyQuorum({ rule: "majority", totalMembers: 5, votes: ["approve", "approve", "approve"] });
    expect(r.decided).toBe(true);
    expect(r.outcome).toBe("approve");
  });
  it("rejects once approval unreachable", () => {
    const r = tallyQuorum({ rule: "majority", totalMembers: 5, votes: ["reject", "reject", "reject"] });
    expect(r.decided).toBe(true);
    expect(r.outcome).toBe("reject");
  });
  it("pending when not yet settled", () => {
    const r = tallyQuorum({ rule: "majority", totalMembers: 5, votes: ["approve", "reject"] });
    expect(r.decided).toBe(false);
    expect(r.outcome).toBeNull();
  });
});

describe("tallyQuorum — unanimous rule", () => {
  it("approves when all approve", () => {
    const r = tallyQuorum({ rule: "unanimous", totalMembers: 3, votes: ["approve", "approve", "approve"] });
    expect(r.outcome).toBe("approve");
  });
  it("rejects on first rejection", () => {
    const r = tallyQuorum({ rule: "unanimous", totalMembers: 3, votes: ["approve", "reject"] });
    expect(r.decided).toBe(true);
    expect(r.outcome).toBe("reject");
  });
  it("abstention breaks unanimity", () => {
    const r = tallyQuorum({ rule: "unanimous", totalMembers: 3, votes: ["approve", "approve", "abstain"] });
    expect(r.outcome).toBe("reject");
  });
});

describe("tallyQuorum — threshold rule", () => {
  it("approves at threshold", () => {
    const r = tallyQuorum({ rule: "threshold", totalMembers: 5, threshold: 3, votes: ["approve", "approve", "approve"] });
    expect(r.outcome).toBe("approve");
  });
  it("rejects when unreachable", () => {
    const r = tallyQuorum({ rule: "threshold", totalMembers: 5, threshold: 4, votes: ["reject", "reject", "reject"] });
    expect(r.outcome).toBe("reject");
  });
});

describe("consolidateParallel", () => {
  it("all mode: approve when all approve", () => {
    expect(consolidateParallel("all", ["approve", "approve"]).outcome).toBe("approve");
  });
  it("all mode: reject on any rejection", () => {
    expect(consolidateParallel("all", ["approve", "reject"]).outcome).toBe("reject");
  });
  it("any mode: approve on first approval", () => {
    expect(consolidateParallel("any", ["pending", "approve"]).outcome).toBe("approve");
  });
  it("any mode: reject only when ALL reject", () => {
    expect(consolidateParallel("any", ["reject", "reject"]).outcome).toBe("reject");
  });
  it("any mode: pending when none approved/all rejected", () => {
    expect(consolidateParallel("any", ["reject", "pending"]).outcome).toBe("pending");
  });
});

// ─── Deviations ──────────────────────────────────────────────────────────────
describe("deviations — lifecycle", () => {
  it("validateRaise: requires non-empty reason", () => {
    expect(validateRaise("").allowed).toBe(false);
    expect(validateRaise("Need waiver for budget override").allowed).toBe(true);
  });
  it("canReview: maker-checker enforced", () => {
    const state = { status: "pending" as const, requestedBy: "user-a", expiresAt: null };
    expect(canReview(state, "user-b").allowed).toBe(true);
    expect(canReview(state, "user-a").allowed).toBe(false); // self-review
  });
  it("canReview: only pending can be reviewed", () => {
    const state = { status: "approved" as const, requestedBy: "user-a", expiresAt: null };
    expect(canReview(state, "user-b").allowed).toBe(false);
  });
  it("canRevoke: only approved can be revoked", () => {
    expect(canRevoke({ status: "approved", requestedBy: "a", expiresAt: null }).allowed).toBe(true);
    expect(canRevoke({ status: "pending", requestedBy: "a", expiresAt: null }).allowed).toBe(false);
  });
  it("isActive: approved + unexpired", () => {
    expect(isActive({ status: "approved", requestedBy: "a", expiresAt: "2099-12-31T00:00:00Z" })).toBe(true);
    expect(isActive({ status: "approved", requestedBy: "a", expiresAt: "2020-01-01T00:00:00Z" })).toBe(false);
    expect(isActive({ status: "pending", requestedBy: "a", expiresAt: null })).toBe(false);
  });
  it("hasLapsed: approved + past expiry", () => {
    expect(hasLapsed({ status: "approved", requestedBy: "a", expiresAt: "2020-01-01T00:00:00Z" })).toBe(true);
    expect(hasLapsed({ status: "approved", requestedBy: "a", expiresAt: null })).toBe(false);
  });
  it("decisionStatus maps correctly", () => {
    expect(decisionStatus("approve")).toBe("approved");
    expect(decisionStatus("reject")).toBe("rejected");
  });
});

// ─── Workbaskets ─────────────────────────────────────────────────────────────
describe("workbaskets — filter normalization", () => {
  it("accepts valid filter", () => {
    const r = normalizeFilter({ status: ["pending", "active"], overdue: true });
    expect(r.errors.length).toBe(0);
    expect(r.filter.status).toEqual(["pending", "active"]);
    expect(r.filter.overdue).toBe(true);
  });
  it("rejects invalid status", () => {
    const r = normalizeFilter({ status: ["invalid_status"] });
    expect(r.errors).toContain("INVALID_STATUS");
  });
  it("rejects assignee + unassigned together", () => {
    const r = normalizeFilter({ assigneeId: "user-1", unassigned: true });
    expect(r.errors).toContain("ASSIGNEE_AND_UNASSIGNED");
  });
  it("rejects invalid sort", () => {
    const r = normalizeFilter({}, "DROP TABLE");
    expect(r.errors).toContain("INVALID_SORT");
  });
  it("accepts valid sort keys", () => {
    expect(normalizeFilter({}, "created_at").errors.length).toBe(0);
    expect(normalizeFilter({}, "due_at").errors.length).toBe(0);
  });
});

// ─── Checklists ──────────────────────────────────────────────────────────────
describe("checklists — gate evaluation", () => {
  it("gate opens when all required items checked", () => {
    const items = [
      { key: "k1", label: "Doc 1", required: true, checked: true },
      { key: "k2", label: "Doc 2", required: true, checked: true },
      { key: "k3", label: "Optional", required: false, checked: false },
    ];
    const g = evaluateGate(items);
    expect(g.open).toBe(true);
    expect(g.blockingKeys).toEqual([]);
  });
  it("gate blocked by unchecked required item", () => {
    const items = [
      { key: "k1", label: "Doc 1", required: true, checked: true },
      { key: "k2", label: "Doc 2", required: true, checked: false },
    ];
    const g = evaluateGate(items);
    expect(g.open).toBe(false);
    expect(g.blockingKeys).toEqual(["k2"]);
  });
  it("no required items = gate always open", () => {
    const items = [{ key: "k1", label: "Optional", required: false, checked: false }];
    expect(evaluateGate(items).open).toBe(true);
  });
});

describe("checklists — instantiate + toggleItem", () => {
  it("instantiate creates unchecked items from template", () => {
    const items = instantiate([{ key: "a", label: "A", required: true }, { key: "b", label: "B" }]);
    expect(items.length).toBe(2);
    expect(items[0]!.checked).toBe(false);
    expect(items[1]!.required).toBe(false);
  });
  it("toggleItem checks and records actor/time", () => {
    const items = instantiate([{ key: "a", label: "A", required: true }]);
    const r = toggleItem(items, "a", true, "user-1", "2026-07-15T10:00:00Z");
    expect(r.found).toBe(true);
    expect(r.items[0]!.checked).toBe(true);
    expect(r.items[0]!.checkedBy).toBe("user-1");
  });
  it("toggleItem unchecks", () => {
    const items = [{ key: "a", label: "A", required: true, checked: true, checkedBy: "u1", checkedAt: "t" }];
    const r = toggleItem(items, "a", false, "u2", "t2");
    expect(r.items[0]!.checked).toBe(false);
    expect(r.items[0]!.checkedBy).toBeNull();
  });
  it("toggleItem: unknown key → found=false", () => {
    const r = toggleItem([], "nonexistent", true, "u1", "t");
    expect(r.found).toBe(false);
  });
});

describe("checklists — validateTemplate", () => {
  it("valid template passes", () => {
    expect(validateTemplate([{ key: "a", label: "A" }]).allowed).toBe(true);
  });
  it("empty items rejected", () => {
    expect(validateTemplate([]).errors).toContain("NO_ITEMS");
  });
  it("duplicate keys rejected", () => {
    expect(validateTemplate([{ key: "a", label: "A" }, { key: "a", label: "B" }]).errors).toContain("DUPLICATE_KEY");
  });
  it("empty key rejected", () => {
    expect(validateTemplate([{ key: "", label: "X" }]).errors).toContain("INVALID_KEY");
  });
});
