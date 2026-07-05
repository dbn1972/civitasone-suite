/**
 * Graph validation tests for advanced node types added by the workflow-advanced-engine spec:
 * message_catch, message_throw, signal_catch, decision, multi-instance.
 *
 * Pure logic — no DB or network required.
 */
import { describe, it, expect } from "vitest";
import { validateGraph } from "../src/modules/definitions/graph.js";
import type { NodeSpec, EdgeSpec } from "../src/modules/definitions/repo.js";

const n = (nodeKey: string, extra: Partial<NodeSpec> = {}): NodeSpec => ({ nodeKey, name: nodeKey, ...extra });
const e = (fromNode: string, toNode: string, extra: Partial<EdgeSpec> = {}): EdgeSpec => ({ fromNode, toNode, ...extra });

describe("validateGraph — message_catch node", () => {
  it("rejects message_catch without message_name", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("mc", { nodeType: "message_catch", correlationKeyExpr: "ctx.orderId" }), n("end", { nodeType: "end" })],
      [e("start", "mc"), e("mc", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/message_catch.*message_name/);
  });

  it("rejects message_catch without correlation_key_expr", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("mc", { nodeType: "message_catch", messageName: "order.placed" }), n("end", { nodeType: "end" })],
      [e("start", "mc"), e("mc", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/message_catch.*correlation_key_expr/);
  });

  it("accepts message_catch with both message_name and correlation_key_expr", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("mc", { nodeType: "message_catch", messageName: "order.placed", correlationKeyExpr: "ctx.orderId" }), n("end", { nodeType: "end" })],
      [e("start", "mc"), e("mc", "end")],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe("validateGraph — message_throw node", () => {
  it("rejects message_throw without message_topic", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("mt", { nodeType: "message_throw" }), n("end", { nodeType: "end" })],
      [e("start", "mt"), e("mt", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/message_throw.*message_topic/);
  });

  it("accepts message_throw with message_topic", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("mt", { nodeType: "message_throw", messageTopic: "notifications.send" }), n("end", { nodeType: "end" })],
      [e("start", "mt"), e("mt", "end")],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe("validateGraph — signal_catch node", () => {
  it("rejects signal_catch without signal_name", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("sc", { nodeType: "signal_catch" }), n("end", { nodeType: "end" })],
      [e("start", "sc"), e("sc", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/signal_catch.*signal_name/);
  });

  it("accepts signal_catch with signal_name", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("sc", { nodeType: "signal_catch", signalName: "budget.approved" }), n("end", { nodeType: "end" })],
      [e("start", "sc"), e("sc", "end")],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe("validateGraph — decision node", () => {
  it("rejects decision node without decision_table_code", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("d", { nodeType: "decision" }), n("end", { nodeType: "end" })],
      [e("start", "d"), e("d", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/decision.*decision_table_code/);
  });

  it("accepts decision node with decision_table_code", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("d", { nodeType: "decision", decisionTableCode: "leave_policy_v2" }), n("end", { nodeType: "end" })],
      [e("start", "d"), e("d", "end")],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe("validateGraph — multi-instance node", () => {
  it("rejects multi-instance node without outgoing edge", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("mi", { multiInstanceCollection: "ctx.approvers", multiInstanceMode: "parallel" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "mi"), e("start", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/multi-instance.*no outgoing edge/);
  });

  it("accepts multi-instance node with outgoing edge", () => {
    const r = validateGraph(
      [
        n("start", { nodeType: "start" }),
        n("mi", { multiInstanceCollection: "ctx.approvers", multiInstanceMode: "parallel" }),
        n("end", { nodeType: "end" }),
      ],
      [e("start", "mi"), e("mi", "end")],
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe("validateGraph — unknown node type", () => {
  it("rejects an unknown node type", () => {
    const r = validateGraph(
      [n("start", { nodeType: "start" }), n("x", { nodeType: "foobar_unknown" }), n("end", { nodeType: "end" })],
      [e("start", "x"), e("x", "end")],
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/unknown node_type.*foobar_unknown/);
  });
});

describe("validateGraph — mixed advanced node types", () => {
  it("accepts a valid graph combining all new node types", () => {
    const nodes: NodeSpec[] = [
      n("start", { nodeType: "start" }),
      n("wait_msg", { nodeType: "message_catch", messageName: "invoice.received", correlationKeyExpr: "ctx.invoiceId" }),
      n("send_msg", { nodeType: "message_throw", messageTopic: "notifications.invoice" }),
      n("wait_signal", { nodeType: "signal_catch", signalName: "budget.released" }),
      n("decide", { nodeType: "decision", decisionTableCode: "approval_level" }),
      n("multi_review", { multiInstanceCollection: "ctx.reviewers", multiInstanceMode: "parallel", multiInstanceCompletion: "all" }),
      n("end", { nodeType: "end" }),
    ];
    const edges: EdgeSpec[] = [
      e("start", "wait_msg"),
      e("wait_msg", "send_msg"),
      e("send_msg", "wait_signal"),
      e("wait_signal", "decide"),
      e("decide", "multi_review"),
      e("multi_review", "end"),
    ];
    const r = validateGraph(nodes, edges);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
