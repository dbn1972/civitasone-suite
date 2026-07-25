/** CAP-030 — version diff + simulation compare pure domain. */
import { describe, it, expect } from "vitest";
import { diffVersions, type VersionGraph } from "../src/modules/definitions/version-diff.js";
import { compareVersions } from "../src/modules/simulation/compare.js";

const V1: VersionGraph = {
  version: 1,
  nodes: [
    { nodeKey: "start", name: "Start", nodeType: "start" },
    { nodeKey: "review", name: "Review", nodeType: "task", roleRef: "officer", slaMinutes: 60 },
    { nodeKey: "end", name: "End", nodeType: "end" },
  ],
  edges: [
    { fromNode: "start", toNode: "review" },
    { fromNode: "review", toNode: "end" },
  ],
};

const V2: VersionGraph = {
  version: 2,
  nodes: [
    { nodeKey: "start", name: "Start", nodeType: "start" },
    { nodeKey: "review", name: "Review", nodeType: "task", roleRef: "director", slaMinutes: 120 }, // changed
    { nodeKey: "audit", name: "Audit", nodeType: "task" }, // added
    { nodeKey: "end", name: "End", nodeType: "end" },
  ],
  edges: [
    { fromNode: "start", toNode: "review" },
    { fromNode: "review", toNode: "audit" }, // changed edge
    { fromNode: "audit", toNode: "end" },
  ],
};

describe("diffVersions", () => {
  it("reports added, removed, and changed nodes/edges", () => {
    const d = diffVersions(V1, V2);
    expect(d.nodesAdded).toContain("audit");
    expect(d.nodesChanged.find((c) => c.nodeKey === "review")?.changes.length).toBeGreaterThan(0);
    expect(d.edgesRemoved).toContain("review->end");
    expect(d.edgesAdded).toEqual(expect.arrayContaining(["review->audit", "audit->end"]));
  });

  it("flags breaking when a node in-flight cases may occupy is removed", () => {
    const withRemoval: VersionGraph = { version: 3, nodes: V1.nodes.filter((n) => n.nodeKey !== "review"), edges: [] };
    const d = diffVersions(V1, withRemoval);
    expect(d.breaking).toBe(true);
    expect(d.breakingNodes).toContain("review");
  });

  it("is non-breaking when only additions/changes occur", () => {
    const d = diffVersions(V1, V2);
    expect(d.breaking).toBe(false);
  });
});

describe("compareVersions", () => {
  it("reports behavioural deltas between two versions", () => {
    const cmp = compareVersions({
      from: { nodes: V1.nodes, edges: V1.edges },
      to: { nodes: V2.nodes, edges: V2.edges },
      instances: 50,
    });
    // V2 has an extra node in the path → more steps and more estimated minutes.
    expect(cmp.avgStepsDelta).toBeGreaterThan(0);
    expect(cmp.pathDeltas.length).toBeGreaterThan(0);
  });
});
