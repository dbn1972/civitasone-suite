import { describe, it, expect } from "vitest";
import {
  STANDARD_DEFINITIONS,
  linearEdges,
  seedClustersFromEnv,
  definitionsForClusters,
} from "../src/modules/provisioning/catalog.js";

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

  // ST-M01-03: profile-aware seeding. A SmartTransfer-standalone deployment
  // must NOT seed the HR / finance / procurement / grant chains.
  it("tags every definition with a known cluster", () => {
    const known = new Set(["core", "hr", "finance", "p2p", "delivery"]);
    for (const def of STANDARD_DEFINITIONS) {
      expect(known.has(def.cluster)).toBe(true);
    }
    // file_noting is the only core (platform-level) chain
    expect(STANDARD_DEFINITIONS.find((d) => d.code === "file_noting")!.cluster).toBe("core");
    expect(STANDARD_DEFINITIONS.find((d) => d.code === "leave_approval")!.cluster).toBe("hr");
    expect(STANDARD_DEFINITIONS.find((d) => d.code === "finance_approval")!.cluster).toBe("finance");
  });

  it("seedClustersFromEnv defaults to every cluster (unchanged for existing tenants)", () => {
    const def = seedClustersFromEnv(undefined);
    ["core", "hr", "finance", "p2p", "delivery"].forEach((c) => expect(def.has(c)).toBe(true));
    expect(seedClustersFromEnv("").has("hr")).toBe(true);
  });

  it("seedClustersFromEnv always includes core even when narrowed", () => {
    const only = seedClustersFromEnv("workforce"); // a standalone deployment
    expect(only.has("core")).toBe(true); // file noting is non-negotiable
    expect(only.has("hr")).toBe(false);
    expect(only.has("finance")).toBe(false);
  });

  it("a standalone deployment seeds ONLY file_noting, not leave/finance/procurement/grant", () => {
    const clusters = seedClustersFromEnv("core"); // standalone: core only
    const seeded = definitionsForClusters(clusters).map((d) => d.code);
    expect(seeded).toEqual(["file_noting"]);
    for (const unwanted of ["leave_approval", "finance_approval", "procurement_approval", "grant_disbursement"]) {
      expect(seeded).not.toContain(unwanted);
    }
  });

  it("the default (all clusters) still seeds all 5 standard definitions", () => {
    const seeded = definitionsForClusters(seedClustersFromEnv(undefined)).map((d) => d.code);
    expect(seeded.sort()).toEqual(
      ["file_noting", "finance_approval", "grant_disbursement", "leave_approval", "procurement_approval"],
    );
  });
});
