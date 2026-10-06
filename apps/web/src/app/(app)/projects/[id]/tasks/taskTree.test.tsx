import { describe, it, expect } from "vitest";
import { orderTaskTree } from "./taskTree";

describe("GAP-PROJECTS-DETAIL-TASKS-02 orderTaskTree", () => {
  it("places children directly under their parent and sets depth across 3 levels", () => {
    const input = [
      { id: "a", parentTaskId: null, name: "A" },
      { id: "b", parentTaskId: null, name: "B" },
      { id: "a1", parentTaskId: "a", name: "A1" },
      { id: "a1x", parentTaskId: "a1", name: "A1X" },
      { id: "a2", parentTaskId: "a", name: "A2" },
    ];
    const out = orderTaskTree(input);
    expect(out.map((t) => t.id)).toEqual(["a", "a1", "a1x", "a2", "b"]);
    expect(out.map((t) => t.depth)).toEqual([0, 1, 2, 1, 0]);
  });

  it("treats an orphaned sub-task (unresolved parent) as a root rather than dropping it", () => {
    const input = [
      { id: "x", parentTaskId: "missing", name: "X" },
      { id: "y", parentTaskId: null, name: "Y" },
    ];
    const out = orderTaskTree(input);
    expect(out.map((t) => t.id).sort()).toEqual(["x", "y"]);
    expect(out.every((t) => t.depth === 0)).toBe(true);
  });

  it("never loses a task caught in a cycle", () => {
    const input = [
      { id: "c1", parentTaskId: "c2", name: "C1" },
      { id: "c2", parentTaskId: "c1", name: "C2" },
    ];
    const out = orderTaskTree(input);
    expect(out.map((t) => t.id).sort()).toEqual(["c1", "c2"]);
  });
});
