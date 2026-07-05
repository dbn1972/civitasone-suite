/**
 * Process simulation domain logic tests — validates graph walk, condition-based
 * routing, path distribution, bottleneck detection, and edge cases.
 */
import { describe, it, expect } from "vitest";
import { simulateProcess, type SimulationInput } from "../src/modules/simulation/domain.js";

describe("simulateProcess — basic graph walk", () => {
  it("returns empty result when no nodes provided", () => {
    const result = simulateProcess({ nodes: [], edges: [], instances: 100 });
    expect(result.totalSimulated).toBe(0);
    expect(result.pathDistribution).toEqual([]);
    expect(result.avgSteps).toBe(0);
  });

  it("walks a simple linear graph (start → task → end)", () => {
    const input: SimulationInput = {
      nodes: [
        { nodeKey: "s", name: "Start", nodeType: "start", slaMinutes: null },
        { nodeKey: "t1", name: "Review", nodeType: "task", slaMinutes: 60 },
        { nodeKey: "e", name: "End", nodeType: "end", slaMinutes: null },
      ],
      edges: [
        { fromNode: "s", toNode: "t1", sortOrder: 1 },
        { fromNode: "t1", toNode: "e", sortOrder: 1 },
      ],
      instances: 50,
    };

    const result = simulateProcess(input);
    expect(result.totalSimulated).toBe(50);
    expect(result.avgSteps).toBe(3);
    expect(result.avgEstimatedMinutes).toBe(60);
    expect(result.pathDistribution).toHaveLength(1);
    expect(result.pathDistribution[0]!.path).toEqual(["s", "t1", "e"]);
    expect(result.pathDistribution[0]!.pct).toBe(100);
    expect(result.nodeHitCounts["t1"]).toBe(50);
  });

  it("detects bottleneck nodes ordered by hit count", () => {
    const input: SimulationInput = {
      nodes: [
        { nodeKey: "s", name: "Start", nodeType: "start", slaMinutes: null },
        { nodeKey: "t1", name: "Heavy", nodeType: "task", slaMinutes: 120 },
        { nodeKey: "t2", name: "Light", nodeType: "task", slaMinutes: 5 },
        { nodeKey: "e", name: "End", nodeType: "end", slaMinutes: null },
      ],
      edges: [
        { fromNode: "s", toNode: "t1", sortOrder: 1 },
        { fromNode: "t1", toNode: "t2", sortOrder: 1 },
        { fromNode: "t2", toNode: "e", sortOrder: 1 },
      ],
      instances: 10,
    };

    const result = simulateProcess(input);
    expect(result.bottleneckNodes.length).toBeGreaterThan(0);
    // All nodes hit equally in linear path, but bottleneck includes SLA info
    const heavy = result.bottleneckNodes.find((n) => n.nodeKey === "t1");
    expect(heavy).toBeDefined();
    expect(heavy!.estimatedMinutes).toBe(120);
  });

  it("identifies parallel branch probability", () => {
    const input: SimulationInput = {
      nodes: [
        { nodeKey: "s", name: "Start", nodeType: "start", slaMinutes: null },
        { nodeKey: "fork", name: "Fork", nodeType: "split", slaMinutes: null },
        { nodeKey: "t1", name: "Branch A", nodeType: "task", slaMinutes: 30 },
        { nodeKey: "e", name: "End", nodeType: "end", slaMinutes: null },
      ],
      edges: [
        { fromNode: "s", toNode: "fork", sortOrder: 1 },
        { fromNode: "fork", toNode: "t1", sortOrder: 1 },
        { fromNode: "t1", toNode: "e", sortOrder: 1 },
      ],
      instances: 100,
    };

    const result = simulateProcess(input);
    expect(result.parallelBranchProbability).toBe(100);
  });

  it("handles cycle detection (graph with back-edge)", () => {
    const input: SimulationInput = {
      nodes: [
        { nodeKey: "s", name: "Start", nodeType: "start", slaMinutes: null },
        { nodeKey: "t1", name: "Loop", nodeType: "task", slaMinutes: 10 },
      ],
      edges: [
        { fromNode: "s", toNode: "t1", sortOrder: 1 },
        { fromNode: "t1", toNode: "s", sortOrder: 1 }, // back-edge
      ],
      instances: 5,
    };

    const result = simulateProcess(input);
    // Should not infinite-loop; cycle detection caps it
    expect(result.totalSimulated).toBe(5);
    expect(result.avgSteps).toBe(2); // s → t1, then t1→s detected as visited
  });
});

describe("simulateProcess — condition-aware routing", () => {
  it("routes based on context variants when conditions exist", () => {
    const input: SimulationInput = {
      nodes: [
        { nodeKey: "s", name: "Start", nodeType: "start", slaMinutes: null },
        { nodeKey: "xor", name: "Decision", nodeType: "xor", slaMinutes: null },
        { nodeKey: "approve", name: "Auto Approve", nodeType: "task", slaMinutes: 5 },
        { nodeKey: "review", name: "Manual Review", nodeType: "task", slaMinutes: 120 },
        { nodeKey: "e", name: "End", nodeType: "end", slaMinutes: null },
      ],
      edges: [
        { fromNode: "s", toNode: "xor", sortOrder: 1 },
        { fromNode: "xor", toNode: "approve", condition: "amount < 10000", sortOrder: 1 },
        { fromNode: "xor", toNode: "review", condition: "amount >= 10000", sortOrder: 2 },
        { fromNode: "approve", toNode: "e", sortOrder: 1 },
        { fromNode: "review", toNode: "e", sortOrder: 1 },
      ],
      instances: 4,
      contextVariants: [
        { amount: 5000 },  // → approve
        { amount: 15000 }, // → review
        { amount: 500 },   // → approve
        { amount: 50000 }, // → review
      ],
    };

    const result = simulateProcess(input);
    expect(result.totalSimulated).toBe(4);
    expect(result.pathDistribution).toHaveLength(2);

    const approvePath = result.pathDistribution.find((p) => p.path.includes("approve"));
    const reviewPath = result.pathDistribution.find((p) => p.path.includes("review"));
    expect(approvePath).toBeDefined();
    expect(reviewPath).toBeDefined();
    expect(approvePath!.count).toBe(2);
    expect(reviewPath!.count).toBe(2);
  });

  it("falls back to first edge when no condition matches", () => {
    const input: SimulationInput = {
      nodes: [
        { nodeKey: "s", name: "Start", nodeType: "start", slaMinutes: null },
        { nodeKey: "t1", name: "Default", nodeType: "task", slaMinutes: null },
        { nodeKey: "t2", name: "Conditional", nodeType: "task", slaMinutes: null },
        { nodeKey: "e", name: "End", nodeType: "end", slaMinutes: null },
      ],
      edges: [
        { fromNode: "s", toNode: "t1", condition: "status == 'nope'", sortOrder: 1 },
        { fromNode: "s", toNode: "t2", condition: "status == 'also_nope'", sortOrder: 2 },
        { fromNode: "t1", toNode: "e", sortOrder: 1 },
        { fromNode: "t2", toNode: "e", sortOrder: 1 },
      ],
      instances: 3,
      contextVariants: [{ status: "something_else" }],
    };

    const result = simulateProcess(input);
    // No condition matches → falls back to first edge (t1)
    expect(result.pathDistribution[0]!.path).toContain("t1");
  });

  it("uses deterministic routing when no context variants supplied", () => {
    const input: SimulationInput = {
      nodes: [
        { nodeKey: "s", name: "Start", nodeType: "start", slaMinutes: null },
        { nodeKey: "a", name: "A", nodeType: "task", slaMinutes: null },
        { nodeKey: "b", name: "B", nodeType: "task", slaMinutes: null },
        { nodeKey: "e", name: "End", nodeType: "end", slaMinutes: null },
      ],
      edges: [
        { fromNode: "s", toNode: "a", condition: "priority == 'high'", sortOrder: 1 },
        { fromNode: "s", toNode: "b", sortOrder: 2 },
        { fromNode: "a", toNode: "e", sortOrder: 1 },
        { fromNode: "b", toNode: "e", sortOrder: 1 },
      ],
      instances: 10,
    };

    const result = simulateProcess(input);
    // Without context, all go to first edge (deterministic)
    expect(result.pathDistribution).toHaveLength(1);
  });

  it("handles boolean condition evaluation correctly", () => {
    const input: SimulationInput = {
      nodes: [
        { nodeKey: "s", name: "Start", nodeType: "start", slaMinutes: null },
        { nodeKey: "yes", name: "Yes", nodeType: "task", slaMinutes: null },
        { nodeKey: "no", name: "No", nodeType: "task", slaMinutes: null },
        { nodeKey: "e", name: "End", nodeType: "end", slaMinutes: null },
      ],
      edges: [
        { fromNode: "s", toNode: "yes", condition: "approved == true", sortOrder: 1 },
        { fromNode: "s", toNode: "no", condition: "approved == false", sortOrder: 2 },
        { fromNode: "yes", toNode: "e", sortOrder: 1 },
        { fromNode: "no", toNode: "e", sortOrder: 1 },
      ],
      instances: 2,
      contextVariants: [
        { approved: true },
        { approved: false },
      ],
    };

    const result = simulateProcess(input);
    expect(result.pathDistribution).toHaveLength(2);
    const yesPath = result.pathDistribution.find((p) => p.path.includes("yes"));
    const noPath = result.pathDistribution.find((p) => p.path.includes("no"));
    expect(yesPath!.count).toBe(1);
    expect(noPath!.count).toBe(1);
  });
});

describe("simulateProcess — edge cases", () => {
  it("handles single-node graph (just a start node with no outgoing edges)", () => {
    const result = simulateProcess({
      nodes: [{ nodeKey: "s", name: "Start", nodeType: "start", slaMinutes: null }],
      edges: [],
      instances: 10,
    });
    expect(result.totalSimulated).toBe(10);
    expect(result.avgSteps).toBe(1);
    expect(result.pathDistribution[0]!.path).toEqual(["s"]);
  });

  it("caps path distribution to top 20", () => {
    // Create a graph with many distinct paths via sequential XOR branches
    const nodes = [
      { nodeKey: "s", name: "Start", nodeType: "start", slaMinutes: null },
      { nodeKey: "e", name: "End", nodeType: "end", slaMinutes: null },
    ];
    const edges: SimulationInput["edges"] = [];

    // 25 direct paths from s to e
    for (let i = 0; i < 25; i++) {
      const key = `t${i}`;
      nodes.push({ nodeKey: key, name: `Task ${i}`, nodeType: "task", slaMinutes: null });
      edges.push({ fromNode: "s", toNode: key, condition: `branch == ${i}`, sortOrder: i + 1 });
      edges.push({ fromNode: key, toNode: "e", sortOrder: 1 });
    }

    const contextVariants = Array.from({ length: 25 }, (_, i) => ({ branch: i }));
    const result = simulateProcess({ nodes, edges, instances: 25, contextVariants });
    expect(result.pathDistribution.length).toBeLessThanOrEqual(20);
  });

  it("handles zero instances gracefully", () => {
    const result = simulateProcess({
      nodes: [{ nodeKey: "s", name: "Start", nodeType: "start", slaMinutes: null }],
      edges: [],
      instances: 0,
    });
    expect(result.totalSimulated).toBe(0);
    expect(result.avgSteps).toBe(0);
  });
});
