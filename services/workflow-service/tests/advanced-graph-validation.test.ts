/**
 * Graph validation tests for new advanced node types added by the workflow
 * advanced engine spec: message_catch, message_throw, signal_catch, decision,
 * multi-instance nodes. Pure logic, no DB.
 */
import { describe, it, expect } from "vitest";
import { validateGraph } from "../src/modules/definitions/graph.js";
import type { NodeSpec, EdgeSpec } from "../src/modules/definitions/repo.js";

const n = (nodeKey: string, extra: Partial<NodeSpec> = {}): NodeSpec => ({ nodeKey, name: nodeKey, ...extra });
const e = (fromNode: string, toNode: string, extra: Partial<EdgeSpec> = {}): EdgeSpec => ({ fromNode, toNode, ...extra });

// ---------------------------------------------------------------------------
// message_catch node
// ---------------------------------------------------------------------------
describe("validateGraph — message_catch nodes", () => {
  it("accepts a well-formed message_catch node with messageName and correlationKeyExpr", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("wait", { nodeType: "message_catch", messageName: "payment.confirmed", correlationKeyExpr: "orderId" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "wait"), e("wait", "end")],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a message_catch node with no messageName", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("wait", { nodeType: "message_catch", correlationKeyExpr: "orderId" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "wait"), e("wait", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/message_name/);
  });

  it("rejects a message_catch node with empty messageName", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("wait", { nodeType: "message_catch", messageName: "  ", correlationKeyExpr: "orderId" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "wait"), e("wait", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/message_name/);
  });

  it("rejects a message_catch node with no correlationKeyExpr", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("wait", { nodeType: "message_catch", messageName: "order.paid" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "wait"), e("wait", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/correlation_key_expr/);
  });

  it("rejects a message_catch node with empty correlationKeyExpr", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("wait", { nodeType: "message_catch", messageName: "order.paid", correlationKeyExpr: "" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "wait"), e("wait", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/correlation_key_expr/);
  });
});

// ---------------------------------------------------------------------------
// message_throw node
// ---------------------------------------------------------------------------
describe("validateGraph — message_throw nodes", () => {
  it("accepts a well-formed message_throw node with messageTopic", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("send", { nodeType: "message_throw", messageTopic: "payments.process" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "send"), e("send", "end")],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a message_throw node with no messageTopic", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("send", { nodeType: "message_throw" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "send"), e("send", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/message_topic/);
  });

  it("rejects a message_throw node with empty messageTopic", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("send", { nodeType: "message_throw", messageTopic: "   " }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "send"), e("send", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/message_topic/);
  });
});

// ---------------------------------------------------------------------------
// signal_catch node
// ---------------------------------------------------------------------------
describe("validateGraph — signal_catch nodes", () => {
  it("accepts a well-formed signal_catch node with signalName", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("wait_signal", { nodeType: "signal_catch", signalName: "shift.change" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "wait_signal"), e("wait_signal", "end")],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a signal_catch node with no signalName", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("wait_signal", { nodeType: "signal_catch" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "wait_signal"), e("wait_signal", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/signal_name/);
  });

  it("rejects a signal_catch node with empty signalName", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("wait_signal", { nodeType: "signal_catch", signalName: "" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "wait_signal"), e("wait_signal", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/signal_name/);
  });
});

// ---------------------------------------------------------------------------
// decision node
// ---------------------------------------------------------------------------
describe("validateGraph — decision nodes", () => {
  it("accepts a well-formed decision node with decisionTableCode", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("decide", { nodeType: "decision", decisionTableCode: "approval_routing" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "decide"), e("decide", "end")],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a decision node with no decisionTableCode", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("decide", { nodeType: "decision" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "decide"), e("decide", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/decision_table_code/);
  });

  it("rejects a decision node with empty decisionTableCode", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("decide", { nodeType: "decision", decisionTableCode: "  " }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "decide"), e("decide", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/decision_table_code/);
  });
});

// ---------------------------------------------------------------------------
// multi-instance nodes
// ---------------------------------------------------------------------------
describe("validateGraph — multi-instance nodes", () => {
  it("accepts a multi-instance node with an outgoing edge", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("parallel_review", { multiInstanceCollection: "reviewers", multiInstanceMode: "parallel" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "parallel_review"), e("parallel_review", "end")],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a multi-instance node with no outgoing edge", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("parallel_review", { multiInstanceCollection: "reviewers", multiInstanceMode: "parallel" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "parallel_review"), e("start", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/multi-instance node.*no outgoing/);
  });

  it("ignores multi-instance validation when collection is not set", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("review", {}),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "review"), e("review", "end")],
    );
    expect(r.valid).toBe(true);
  });

  it("ignores multi-instance validation when collection is empty string", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("review", { multiInstanceCollection: "" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "review"), e("review", "end")],
    );
    expect(r.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mixed scenarios with new node types
// ---------------------------------------------------------------------------
describe("validateGraph — mixed advanced node types", () => {
  it("accepts a complex graph with message_catch, decision, and multi-instance", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("wait_payment", { nodeType: "message_catch", messageName: "payment.received", correlationKeyExpr: "invoiceId" }),
        n("route", { nodeType: "decision", decisionTableCode: "payment_routing" }),
        n("multi_approve", { multiInstanceCollection: "approvers", multiInstanceMode: "parallel" }),
        n("end", { nodeType: "end" }),
      ],
      [
        e("start", "wait_payment"),
        e("wait_payment", "route"),
        e("route", "multi_approve"),
        e("multi_approve", "end"),
      ],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts a signal_catch with message_throw combination", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("listen", { nodeType: "signal_catch", signalName: "budget.released" }),
        n("notify", { nodeType: "message_throw", messageTopic: "finance.budget-confirmed" }),
        n("end", { nodeType: "end" }),
      ],
      [
        e("start", "listen"),
        e("listen", "notify"),
        e("notify", "end"),
      ],
    );
    expect(r.valid).toBe(true);
  });

  it("new node types are recognized as known (not rejected as unknown)", () => {
    for (const nodeType of ["message_catch", "message_throw", "signal_catch", "decision"]) {
      const r = validateGraph(
        [
          n("start", { nodeType: "start" }),
          n("x", { nodeType, messageName: "m", correlationKeyExpr: "k", signalName: "s", messageTopic: "t", decisionTableCode: "d" }),
          n("end", { nodeType: "end" }),
        ],
        [e("start", "x"), e("x", "end")],
      );
      const unknownErr = r.errors.find((err) => err.includes("unknown node_type"));
      expect(unknownErr).toBeUndefined();
    }
  });
});
