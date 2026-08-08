import { describe, expect, it } from "vitest";
import { lanesToBpmn } from "./workflowBuilderApi";
import { defaultLanes, narrateWorkflow } from "./workflowConstants";

describe("workflowConstants", () => {
  it("narrates enabled approval steps", () => {
    const lanes = defaultLanes().map((l) =>
      l.key === "decision"
        ? { ...l, designationLabel: "Licensing Officer", slaDays: 5 }
        : l,
    );
    const text = narrateWorkflow(lanes);
    expect(text).toMatch(/licensing officer/i);
    expect(text).toMatch(/5 days/i);
  });
});

describe("lanesToBpmn (re-export)", () => {
  it("builds a linear chain from guided lanes", () => {
    const { elements, edges } = lanesToBpmn(defaultLanes());
    expect(elements.some((e) => e.type === "startEvent")).toBe(true);
    expect(elements.some((e) => e.type === "task" && e.label === "Decision")).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
  });
});
