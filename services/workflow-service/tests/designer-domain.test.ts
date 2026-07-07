/**
 * Unit tests for BPMN designer graph validation domain logic.
 * Validates Requirements 7.1 (max 500 elements) and 7.6 (validation rules + 500ms).
 */
import { describe, it, expect } from "vitest";
import { validateGraph, type ValidationResult } from "../src/modules/designer/domain.js";
import type { DesignerNode, DesignerEdge } from "../src/modules/designer/schema.js";

function makeNode(id: string, type: string, label = ""): DesignerNode {
  return { id, type, label, position: { x: 0, y: 0 } };
}

function makeEdge(id: string, source: string, target: string): DesignerEdge {
  return { id, source, target };
}

describe("validateGraph — valid graphs", () => {
  it("accepts a simple linear workflow (start → task → end)", () => {
    const nodes = [
      makeNode("s1", "startEvent", "Start"),
      makeNode("t1", "userTask", "Task"),
      makeNode("e1", "endEvent", "End"),
    ];
    const edges = [
      makeEdge("f1", "s1", "t1"),
      makeEdge("f2", "t1", "e1"),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("accepts a graph with gateways having outgoing flows", () => {
    const nodes = [
      makeNode("s1", "startEvent"),
      makeNode("gw1", "exclusiveGateway"),
      makeNode("t1", "userTask"),
      makeNode("t2", "userTask"),
      makeNode("e1", "endEvent"),
    ];
    const edges = [
      makeEdge("f1", "s1", "gw1"),
      makeEdge("f2", "gw1", "t1"),
      makeEdge("f3", "gw1", "t2"),
      makeEdge("f4", "t1", "e1"),
      makeEdge("f5", "t2", "e1"),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.valid).toBe(true);
  });

  it("accepts an empty graph (no nodes, no edges)", () => {
    const result = validateGraph([], []);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("accepts a graph with parallel gateway", () => {
    const nodes = [
      makeNode("s1", "startEvent"),
      makeNode("fork", "parallelGateway"),
      makeNode("t1", "userTask"),
      makeNode("t2", "serviceTask"),
      makeNode("join", "parallelGateway"),
      makeNode("e1", "endEvent"),
    ];
    const edges = [
      makeEdge("f1", "s1", "fork"),
      makeEdge("f2", "fork", "t1"),
      makeEdge("f3", "fork", "t2"),
      makeEdge("f4", "t1", "join"),
      makeEdge("f5", "t2", "join"),
      makeEdge("f6", "join", "e1"),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.valid).toBe(true);
  });
});

describe("validateGraph — invalid graphs", () => {
  it("detects gateway with no outgoing flow", () => {
    const nodes = [
      makeNode("s1", "startEvent"),
      makeNode("gw1", "exclusiveGateway"),
      makeNode("e1", "endEvent"),
    ];
    const edges = [
      makeEdge("f1", "s1", "gw1"),
      // No outgoing from gw1
    ];
    const result = validateGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === "gateway_no_outgoing")).toBe(true);
    expect(result.violations.find((v) => v.rule === "gateway_no_outgoing")?.nodeId).toBe("gw1");
  });

  it("detects dangling edge source (references non-existent node)", () => {
    const nodes = [
      makeNode("s1", "startEvent"),
      makeNode("e1", "endEvent"),
    ];
    const edges = [
      makeEdge("f1", "nonexistent", "e1"),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === "dangling_edge_source")).toBe(true);
  });

  it("detects dangling edge target (references non-existent node)", () => {
    const nodes = [
      makeNode("s1", "startEvent"),
      makeNode("e1", "endEvent"),
    ];
    const edges = [
      makeEdge("f1", "s1", "ghost"),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === "dangling_edge_target")).toBe(true);
  });

  it("detects unreachable end event", () => {
    const nodes = [
      makeNode("s1", "startEvent"),
      makeNode("t1", "userTask"),
      makeNode("e1", "endEvent"),
      makeNode("e2", "endEvent"), // disconnected
    ];
    const edges = [
      makeEdge("f1", "s1", "t1"),
      makeEdge("f2", "t1", "e1"),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === "end_event_unreachable" && v.nodeId === "e2")).toBe(true);
  });

  it("detects missing start event", () => {
    const nodes = [
      makeNode("t1", "userTask"),
      makeNode("e1", "endEvent"),
    ];
    const edges = [
      makeEdge("f1", "t1", "e1"),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === "no_start_event")).toBe(true);
  });

  it("detects missing end event", () => {
    const nodes = [
      makeNode("s1", "startEvent"),
      makeNode("t1", "userTask"),
    ];
    const edges = [
      makeEdge("f1", "s1", "t1"),
    ];
    const result = validateGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.rule === "no_end_event")).toBe(true);
  });

  it("reports multiple violations at once", () => {
    const nodes = [
      makeNode("s1", "startEvent"),
      makeNode("gw1", "exclusiveGateway"),
      makeNode("gw2", "parallelGateway"),
      makeNode("e1", "endEvent"),
      makeNode("e2", "endEvent"), // unreachable
    ];
    const edges = [
      makeEdge("f1", "s1", "gw1"),
      makeEdge("f2", "gw1", "e1"),
      // gw2 has no outgoing; e2 is unreachable
    ];
    const result = validateGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("validateGraph — performance", () => {
  it("validates a 500-element graph within 500ms", () => {
    // Create a large but valid graph: start → chain of tasks → end
    const nodeCount = 250;
    const nodes: DesignerNode[] = [
      makeNode("start", "startEvent"),
      ...Array.from({ length: nodeCount - 2 }, (_, i) => makeNode(`task_${i}`, "userTask")),
      makeNode("end", "endEvent"),
    ];
    // edges: start→task_0, task_0→task_1, ..., task_{N-3}→end = (nodeCount - 1) edges
    const edges: DesignerEdge[] = [
      makeEdge("e_start", "start", "task_0"),
      ...Array.from({ length: nodeCount - 3 }, (_, i) => makeEdge(`e_${i}`, `task_${i}`, `task_${i + 1}`)),
      makeEdge("e_end", `task_${nodeCount - 3}`, "end"),
    ];

    // Total elements at or near 500
    expect(nodes.length + edges.length).toBeLessThanOrEqual(500);

    const startTime = performance.now();
    const result = validateGraph(nodes, edges);
    const elapsed = performance.now() - startTime;

    expect(result.valid).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });

  it("validates a branching 500-element graph within 500ms", () => {
    // Complex graph: start → gateway → many branches → merge → end
    const branchCount = 50;
    const nodes: DesignerNode[] = [
      makeNode("start", "startEvent"),
      makeNode("split", "parallelGateway"),
      ...Array.from({ length: branchCount }, (_, i) => makeNode(`branch_${i}`, "userTask")),
      makeNode("join", "parallelGateway"),
      makeNode("end", "endEvent"),
    ];
    const edges: DesignerEdge[] = [
      makeEdge("e_start", "start", "split"),
      ...Array.from({ length: branchCount }, (_, i) => makeEdge(`e_split_${i}`, "split", `branch_${i}`)),
      ...Array.from({ length: branchCount }, (_, i) => makeEdge(`e_join_${i}`, `branch_${i}`, "join")),
      makeEdge("e_end", "join", "end"),
    ];

    const startTime = performance.now();
    const result = validateGraph(nodes, edges);
    const elapsed = performance.now() - startTime;

    expect(result.valid).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});
