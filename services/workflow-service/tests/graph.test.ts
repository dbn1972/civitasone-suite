/**
 * validateGraph structural-validation tests (src/modules/definitions/graph.ts)
 * and computeDueAt (src/shared/sla.ts). Pure logic, no DB.
 *
 * These prove a typo'd edge, a missing terminal, an unknown node type, a
 * strand-only loop, and the timer/call/deemed-approval safety rules are all
 * rejected at deploy time so a bad definition can never strand an instance.
 */
import { describe, it, expect } from "vitest";
import { validateGraph } from "../src/modules/definitions/graph.js";
import type { NodeSpec, EdgeSpec } from "../src/modules/definitions/repo.js";
import { computeDueAt } from "../src/shared/sla.js";

const n = (nodeKey: string, extra: Partial<NodeSpec> = {}): NodeSpec => ({ nodeKey, name: nodeKey, ...extra });
const e = (fromNode: string, toNode: string, extra: Partial<EdgeSpec> = {}): EdgeSpec => ({ fromNode, toNode, ...extra });

describe("validateGraph — happy paths", () => {
  it("accepts a simple linear start→task→end graph", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("review"), n("done", { nodeType: "end" })],
      [e("start", "review"), e("review", "done")],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it("accepts a split/join parallel graph", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("fork", { nodeType: "split" }), n("a"), n("b"), n("join", { nodeType: "join" }), n("end", { nodeType: "end" })],
      [e("start", "fork"), e("fork", "a"), e("fork", "b"), e("a", "join"), e("b", "join"), e("join", "end")],
    );
    expect(r.valid).toBe(true);
  });
});

describe("validateGraph — structural rejections", () => {
  it("rejects an empty graph", () => {
    const r = validateGraph([], []);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/no nodes/);
  });
  it("rejects a duplicate nodeKey", () => {
    const r = validateGraph([n("a"), n("a"), n("end", { nodeType: "end" })], [e("a", "end")]);
    expect(r.errors.join()).toMatch(/duplicate nodeKey/);
  });
  it("rejects an edge to a missing node (the typo case)", () => {
    const r = validateGraph([n("start", { nodeType: "start" }), n("end", { nodeType: "end" })], [e("start", "nope")]);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/missing node/);
  });
  it("rejects a malformed edge condition at deploy time", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("end", { nodeType: "end" })],
      [e("start", "end", { condition: "amount >" })],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/invalid condition/);
  });
  it("rejects an unknown node type (would strand the instance)", () => {
    const r = validateGraph([n("start", { nodeType: "start" }), n("weird", { nodeType: "frobnicate" }), n("end", { nodeType: "end" })], [e("start", "weird"), e("weird", "end")]);
    expect(r.errors.join()).toMatch(/unknown node_type/);
  });
  it("rejects an unknown assign strategy", () => {
    const r = validateGraph([n("start", { nodeType: "start" }), n("t", { assignStrategy: "bogus" }), n("end", { nodeType: "end" })], [e("start", "t"), e("t", "end")]);
    expect(r.errors.join()).toMatch(/unknown assign_strategy/);
  });
  it("rejects a graph with no terminal (every node has an outgoing edge)", () => {
    const r = validateGraph([n("a"), n("b")], [e("a", "b"), e("b", "a")]);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/no terminal|can only loop/);
  });
  it("rejects an unreachable node", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("orphan"), n("end", { nodeType: "end" })],
      [e("start", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/unreachable/);
  });
  it("rejects a strand-only loop with no escape to a terminal", () => {
    // start → loopA ⇄ loopB (no path to end); end is unreachable too.
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("loopA"), n("loopB"), n("end", { nodeType: "end" })],
      [e("start", "loopA"), e("loopA", "loopB"), e("loopB", "loopA")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/can only loop|unreachable/);
  });
});

describe("validateGraph — call-activity rules", () => {
  it("rejects a call node with no call_definition_code", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("call", { nodeType: "call" }), n("end", { nodeType: "end" })],
      [e("start", "call"), e("call", "end")],
    );
    expect(r.errors.join()).toMatch(/call_definition_code/);
  });
  it("rejects a call node with no outgoing edge (parent could never resume)", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("call", { nodeType: "call", callDefinitionCode: "child_flow" }), n("end", { nodeType: "end" })],
      [e("start", "call"), e("start", "end")],
    );
    expect(r.errors.join()).toMatch(/no outgoing edge/);
  });
  it("accepts a well-formed call node", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("call", { nodeType: "call", callDefinitionCode: "child_flow" }), n("end", { nodeType: "end" })],
      [e("start", "call"), e("call", "end")],
    );
    expect(r.valid).toBe(true);
  });
});

describe("validateGraph — timer / deemed-approval rules", () => {
  it("rejects a timer node with no outgoing edge", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("wait", { nodeType: "timer", timerMinutes: 60 }), n("end", { nodeType: "end" })],
      [e("start", "wait")],
    );
    expect(r.errors.join()).toMatch(/timer node.*no outgoing/);
  });
  it("rejects timer_minutes < 1 (instant deemed-approval laundering)", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("wait", { nodeType: "timer", timerMinutes: 0 }), n("review"), n("end", { nodeType: "end" })],
      [e("start", "wait"), e("wait", "review"), e("review", "end")],
    );
    expect(r.errors.join()).toMatch(/timer_minutes must be >= 1/);
  });
  it("rejects a deemed-approval timer feeding straight into a terminal", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("wait", { nodeType: "timer", timerMinutes: 60, deemedApproval: true }), n("end", { nodeType: "end" })],
      [e("start", "wait"), e("wait", "end")],
    );
    expect(r.errors.join()).toMatch(/auto-dispatch a domain approval|human step is required/);
  });
  it("accepts a deemed-approval timer with a human step before the terminal", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("wait", { nodeType: "timer", timerMinutes: 60, deemedApproval: true }), n("review"), n("end", { nodeType: "end" })],
      [e("start", "wait"), e("wait", "review"), e("review", "end")],
    );
    expect(r.valid).toBe(true);
  });
});

describe("validateGraph — cycles are warnings (intended loops), not errors", () => {
  it("reports a return-loop as a warning while still valid", () => {
    // review → done (end); review can also return to start; start → review.
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("review"), n("done", { nodeType: "end" })],
      [e("start", "review"), e("review", "done"), e("review", "start")],
    );
    expect(r.valid).toBe(true);
    expect(r.warnings.join()).toMatch(/cycle/);
  });
});

describe("computeDueAt", () => {
  it("returns null for null/undefined/non-positive SLA", () => {
    expect(computeDueAt(null)).toBeNull();
    expect(computeDueAt(undefined)).toBeNull();
    expect(computeDueAt(0)).toBeNull();
    expect(computeDueAt(-5)).toBeNull();
  });
  it("adds the SLA minutes onto the from-time", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(computeDueAt(90, from)?.toISOString()).toBe("2026-01-01T01:30:00.000Z");
  });
});
