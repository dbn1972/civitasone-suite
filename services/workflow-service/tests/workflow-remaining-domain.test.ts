/**
 * Workflow Service — remaining domain tests (authority, closure, finalization,
 * case-links, messages, designer, comments, timeline).
 * Packs #04, #09, #20, #06, #24, #15, #10, #31.
 */
import { describe, it, expect } from "vitest";
import { isEffective, evaluateAuthority, type AuthorityLimit } from "../src/modules/authority/domain.js";
import { canClose, canReopen, canArchive, initialStatus } from "../src/modules/closure/domain.js";
import { assertEditable, isProtected, canReverse, assessImpact } from "../src/modules/finalization/domain.js";
import { validateLink, wouldCreateCycle, planSplit, planMerge, containmentEdge } from "../src/modules/case-links/domain.js";
import { assertValidMessageName, assertValidCorrelationKey, resolveCorrelationKey, computeTimeoutAt, isExpired, DomainError } from "../src/modules/messages/domain.js";
import { mergeTimeline } from "../src/modules/timeline/domain.js";
import { visibleTo, buildThreads, validateBody } from "../src/modules/comments/domain.js";

// ─── Authority ───────────────────────────────────────────────────────────────
describe("authority — isEffective", () => {
  const base: AuthorityLimit = { id: "l1", scopeType: "role", scopeRef: "finance_officer", authorityType: "financial", currency: "INR", maxAmount: 1_000_000n, effectiveFrom: "2025-01-01", effectiveTo: "2027-12-31", escalateToScopeType: null, escalateToRef: null, status: "active" };
  it("active + within dates = effective", () => expect(isEffective(base, "2026-07-15")).toBe(true));
  it("inactive = not effective", () => expect(isEffective({ ...base, status: "inactive" }, "2026-07-15")).toBe(false));
  it("before effectiveFrom = not effective", () => expect(isEffective(base, "2024-12-31")).toBe(false));
  it("after effectiveTo = not effective", () => expect(isEffective(base, "2028-01-01")).toBe(false));
  it("null effectiveTo = open-ended", () => expect(isEffective({ ...base, effectiveTo: null }, "2099-01-01")).toBe(true));
});

describe("authority — evaluateAuthority", () => {
  const limits: AuthorityLimit[] = [
    { id: "l1", scopeType: "role", scopeRef: "clerk", authorityType: "financial", currency: "INR", maxAmount: 500_000n, effectiveFrom: "2025-01-01", effectiveTo: null, escalateToScopeType: "role", escalateToRef: "officer", status: "active" },
    { id: "l2", scopeType: "role", scopeRef: "officer", authorityType: "financial", currency: "INR", maxAmount: 5_000_000n, effectiveFrom: "2025-01-01", effectiveTo: null, escalateToScopeType: null, escalateToRef: null, status: "active" },
  ];
  it("within actor authority = no escalation", () => {
    const r = evaluateAuthority(limits, { scopes: [{ scopeType: "role", scopeRef: "clerk" }] }, "financial", 400_000n, "2026-07-15");
    expect(r.withinActorAuthority).toBe(true);
    expect(r.requiresEscalation).toBe(false);
  });
  it("exceeds actor authority = escalation to officer", () => {
    const r = evaluateAuthority(limits, { scopes: [{ scopeType: "role", scopeRef: "clerk" }] }, "financial", 2_000_000n, "2026-07-15");
    expect(r.requiresEscalation).toBe(true);
    expect(r.covered).toBe(true);
    expect(r.finalApprover!.scopeRef).toBe("officer");
  });
  it("exceeds all limits = uncovered", () => {
    const r = evaluateAuthority(limits, { scopes: [{ scopeType: "role", scopeRef: "clerk" }] }, "financial", 99_000_000n, "2026-07-15");
    expect(r.covered).toBe(false);
  });
});

// ─── Closure ─────────────────────────────────────────────────────────────────
describe("closure lifecycle", () => {
  it("canClose from open with reason", () => expect(canClose("open", "Work completed").allowed).toBe(true));
  it("canClose fails from archived", () => expect(canClose("archived", "x").allowed).toBe(false));
  it("canClose fails without reason", () => expect(canClose("open", "").errors).toContain("REASON_REQUIRED"));
  it("canReopen from closed", () => expect(canReopen("closed", "Reopening for review").allowed).toBe(true));
  it("canReopen fails from open", () => expect(canReopen("open", "x").allowed).toBe(false));
  it("canArchive from closed only", () => expect(canArchive("closed").allowed).toBe(true));
  it("canArchive fails from open", () => expect(canArchive("open").allowed).toBe(false));
  it("initialStatus is open", () => expect(initialStatus()).toBe("open"));
});

// ─── Finalization ────────────────────────────────────────────────────────────
describe("finalization / reversal", () => {
  it("assertEditable: finalized = not editable", () => {
    expect(assertEditable({ instanceId: "i1", finalized: true, finalizedBy: "u1", finalizedAt: "t", reversed: false, reversedBy: null, reversedAt: null }).allowed).toBe(false);
  });
  it("assertEditable: reversed = editable again", () => {
    expect(assertEditable({ instanceId: "i1", finalized: true, finalizedBy: "u1", finalizedAt: "t", reversed: true, reversedBy: "u2", reversedAt: "t2" }).allowed).toBe(true);
  });
  it("isProtected: finalized + not reversed", () => {
    expect(isProtected({ instanceId: "i1", finalized: true, finalizedBy: "u1", finalizedAt: "t", reversed: false, reversedBy: null, reversedAt: null })).toBe(true);
  });
  it("canReverse: all checks pass", () => {
    const r = canReverse({ state: { instanceId: "i1", finalized: true, finalizedBy: "u1", finalizedAt: "t", reversed: false, reversedBy: null, reversedAt: null }, hasAuthority: true, reason: "Error found", dependencies: [] });
    expect(r.allowed).toBe(true);
  });
  it("canReverse: blocks on blocking dependencies", () => {
    const r = canReverse({ state: { instanceId: "i1", finalized: true, finalizedBy: "u1", finalizedAt: "t", reversed: false, reversedBy: null, reversedAt: null }, hasAuthority: true, reason: "Fix", dependencies: [{ type: "payment", id: "p1", blocking: true }] });
    expect(r.errors).toContain("BLOCKING_DEPENDENCIES");
  });
  it("assessImpact: counts blockers", () => {
    const r = assessImpact("i1", [{ type: "payment", id: "p1", blocking: true }, { type: "audit", id: "a1", blocking: false }]);
    expect(r.blockingCount).toBe(1);
    expect(r.reversible).toBe(false);
  });
});

// ─── Case Links ──────────────────────────────────────────────────────────────
describe("case-links — cycle detection & validation", () => {
  it("self-link detected", () => {
    const r = validateLink({ fromCaseId: "A", toCaseId: "A", type: "parent_child", existing: [] });
    expect(r.errors).toContain("SELF_LINK");
  });
  it("cycle in parent_child detected", () => {
    const existing = [{ fromCaseId: "B", toCaseId: "A", type: "parent_child" as const }];
    const r = validateLink({ fromCaseId: "A", toCaseId: "B", type: "parent_child", existing });
    expect(r.errors).toContain("CYCLE_DETECTED");
  });
  it("duplicate link detected", () => {
    const existing = [{ fromCaseId: "A", toCaseId: "B", type: "related" as const }];
    const r = validateLink({ fromCaseId: "A", toCaseId: "B", type: "related", existing });
    expect(r.errors).toContain("DUPLICATE_LINK");
  });
  it("valid link passes", () => {
    expect(validateLink({ fromCaseId: "A", toCaseId: "B", type: "related", existing: [] }).allowed).toBe(true);
  });
  it("planSplit needs >= 2 children", () => {
    expect(planSplit([{ title: "A", caseType: "x" }]).errors).toContain("SPLIT_NEEDS_TWO_CHILDREN");
  });
  it("planSplit valid with allocations summing to 100", () => {
    expect(planSplit([{ title: "A", caseType: "x", allocation: 60 }, { title: "B", caseType: "x", allocation: 40 }]).allowed).toBe(true);
  });
  it("planMerge: target cannot be a source", () => {
    expect(planMerge(["A", "B", "C"], "B").errors).toContain("TARGET_IN_SOURCES");
  });
  it("planMerge valid", () => {
    expect(planMerge(["A", "B"], "C").allowed).toBe(true);
  });
});

// ─── Messages ────────────────────────────────────────────────────────────────
describe("messages — validation & correlation", () => {
  it("valid message name passes", () => expect(() => assertValidMessageName("payment.confirmed")).not.toThrow());
  it("empty message name throws", () => expect(() => assertValidMessageName("")).toThrow(DomainError));
  it("invalid chars throw", () => expect(() => assertValidMessageName("hello world")).toThrow(DomainError));
  it("valid correlation key", () => expect(() => assertValidCorrelationKey("order-12345")).not.toThrow());
  it("resolveCorrelationKey: resolves dot-path", () => {
    expect(resolveCorrelationKey("order.id", { order: { id: "ORD-001" } })).toBe("ORD-001");
  });
  it("resolveCorrelationKey: throws on unresolvable", () => {
    expect(() => resolveCorrelationKey("missing.path", {})).toThrow(DomainError);
  });
  it("computeTimeoutAt: adds minutes", () => {
    const from = new Date("2026-07-15T10:00:00Z");
    const timeout = computeTimeoutAt(60, from);
    expect(timeout!.toISOString()).toBe("2026-07-15T11:00:00.000Z");
  });
  it("computeTimeoutAt: null when no timeout", () => expect(computeTimeoutAt(null)).toBeNull());
  it("isExpired: past timeout = expired", () => {
    expect(isExpired(new Date("2026-07-15T10:00:00Z"), new Date("2026-07-15T11:00:00Z"))).toBe(true);
  });
});

// ─── Comments ────────────────────────────────────────────────────────────────
describe("comments — visibility & threading", () => {
  const comments = [
    { id: "c1", parentCommentId: null, visibility: "external", body: "Hi" },
    { id: "c2", parentCommentId: null, visibility: "internal", body: "Internal note" },
    { id: "c3", parentCommentId: "c1", visibility: "external", body: "Reply" },
  ];
  it("external viewer sees only external", () => expect(visibleTo(comments, "external").length).toBe(2));
  it("internal viewer sees all", () => expect(visibleTo(comments, "internal").length).toBe(3));
  it("buildThreads: nests replies", () => {
    const threads = buildThreads(comments);
    expect(threads.length).toBe(2); // c1 (with reply c3) and c2
    expect(threads[0]!.replies.length).toBe(1);
  });
  it("validateBody: empty body rejected", () => expect(validateBody("").errors).toContain("BODY_REQUIRED"));
  it("validateBody: non-empty passes", () => expect(validateBody("Hello").allowed).toBe(true));
});

// ─── Timeline ────────────────────────────────────────────────────────────────
describe("timeline — merge ordering", () => {
  it("merges entries newest-first", () => {
    const list1 = [{ source: "transition" as const, id: "t1", at: "2026-07-15T10:00:00Z", actorId: "u1", action: "approve", summary: "", detail: {} }];
    const list2 = [{ source: "comment" as const, id: "c1", at: "2026-07-15T11:00:00Z", actorId: "u2", action: "comment", summary: "", detail: {} }];
    const merged = mergeTimeline(list1, list2);
    expect(merged[0]!.id).toBe("c1"); // newer first
    expect(merged[1]!.id).toBe("t1");
  });
  it("empty lists produce empty result", () => expect(mergeTimeline([], []).length).toBe(0));
});
