import { describe, it, expect } from "vitest";
import { countWbsNodes, normalizeWbsStatus } from "./wbsCounts";
import type { ProjectWbsNode } from "@/app/_data/loaders";

function node(id: string, status: string, parentId: string | null = null): ProjectWbsNode {
  return { id, name: `Node ${id}`, status, parentId };
}

describe("GAP-PROJECTS-WBS-02: countWbsNodes reconciles to total", () => {
  it("buckets sum exactly to total for a fixture incl. blocked and parent nodes", () => {
    const nodes: ProjectWbsNode[] = [
      node("p1", "in_progress"), // parent, counted
      node("c1", "completed", "p1"),
      node("c2", "blocked", "p1"),
      node("c3", "pending", "p1"),
      node("c4", "planned", "p1"),
      node("c5", "on_hold", "p1"), // not completed/inprog/blocked -> notStarted remainder
      node("c6", "weird_status", "p1"), // unknown -> remainder
    ];
    const c = countWbsNodes(nodes);
    expect(c.total).toBe(7);
    expect(c.completed).toBe(1);
    expect(c.inProgress).toBe(1);
    expect(c.blocked).toBe(1);
    expect(c.notStarted).toBe(4); // pending + planned + on_hold + unknown
    expect(c.completed + c.inProgress + c.blocked + c.notStarted).toBe(c.total);
  });

  it("buckets 'in_progress' (snake) and 'in progress' (spaced) identically", () => {
    const c = countWbsNodes([node("a", "in_progress"), node("b", "in progress")]);
    expect(c.inProgress).toBe(2);
  });

  it("a blocked node is NOT silently dropped (old bug: fell into no tile)", () => {
    const c = countWbsNodes([node("a", "blocked")]);
    expect(c.blocked).toBe(1);
    expect(c.total).toBe(1);
    expect(c.completed + c.inProgress + c.blocked + c.notStarted).toBe(1);
  });

  it("empty list yields all-zero counts", () => {
    const c = countWbsNodes([]);
    expect(c).toEqual({ total: 0, completed: 0, inProgress: 0, blocked: 0, notStarted: 0 });
  });
});

describe("normalizeWbsStatus", () => {
  it.each([
    ["in_progress", "in progress"],
    ["InProgress", "in progress"],
    ["on-hold", "on hold"],
    ["  Blocked ", "blocked"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeWbsStatus(input)).toBe(expected);
  });
});
