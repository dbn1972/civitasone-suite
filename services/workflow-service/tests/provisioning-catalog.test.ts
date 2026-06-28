import { describe, it, expect } from "vitest";
import { STANDARD_DEFINITIONS, linearEdges } from "../src/modules/provisioning/catalog.js";

describe("standard definition catalog", () => {
  it("includes the file_noting chain SO→US→DS", () => {
    const fn = STANDARD_DEFINITIONS.find((d) => d.code === "file_noting");
    expect(fn).toBeDefined();
    expect(fn!.nodes.map((n) => n.nodeKey)).toEqual([
      "draft", "section_review", "us_approve", "ds_approve",
    ]);
  });

  it("derives n-1 linear edges so the last node is terminal", () => {
    for (const def of STANDARD_DEFINITIONS) {
      const edges = linearEdges(def);
      expect(edges).toHaveLength(def.nodes.length - 1);
      // every edge target exists; the final node is never a `from`
      const fromNodes = new Set(edges.map((e) => e.fromNode));
      const lastNode = def.nodes[def.nodes.length - 1]!.nodeKey;
      expect(fromNodes.has(lastNode)).toBe(false); // terminal → triggers domain dispatch
      // chain is contiguous: edge i goes node[i] -> node[i+1]
      edges.forEach((e, i) => {
        expect(e.fromNode).toBe(def.nodes[i]!.nodeKey);
        expect(e.toNode).toBe(def.nodes[i + 1]!.nodeKey);
      });
    }
  });

  it("every node has a role except optional terminals", () => {
    for (const def of STANDARD_DEFINITIONS) {
      for (const n of def.nodes) {
        expect(n.nodeKey.length).toBeGreaterThan(0);
      }
    }
  });
});
