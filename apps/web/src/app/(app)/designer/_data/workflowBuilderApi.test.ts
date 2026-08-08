import { describe, expect, it } from "vitest";
import { lanesToBpmn } from "./workflowBuilderApi";
import { defaultLanes, lanesToBindings, narrateWorkflow, slaDaysToMinutes } from "./workflowConstants";

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

  it("FN-25: converts SLA days to minutes and pack bindings", () => {
    expect(slaDaysToMinutes(7)).toBe(7 * 1440);
    const bindings = lanesToBindings(
      defaultLanes().map((l) =>
        l.key === "inspection"
          ? {
              ...l,
              designationId: "pos-i",
              escalationDesignationId: "pos-o",
              escalationDesignationLabel: "Officer",
              slaDays: 7,
            }
          : l,
      ),
    );
    const inspection = bindings.find((b) => b.key === "inspection");
    expect(inspection?.escalationDesignationId).toBe("pos-o");
    expect(inspection?.slaDays).toBe(7);
  });
});

describe("lanesToBpmn (re-export)", () => {
  it("builds a linear chain from guided lanes", () => {
    const { elements, edges } = lanesToBpmn(defaultLanes());
    expect(elements.some((e) => e.type === "startEvent")).toBe(true);
    expect(elements.some((e) => e.type === "task" && e.label === "Decision")).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
  });

  it("FN-25: stamps slaMinutes and escalation designation on task nodes", () => {
    const lanes = defaultLanes().map((l) =>
      l.key === "inspection"
        ? {
            ...l,
            slaDays: 7,
            escalationDesignationId: "pos-officer",
            escalationDesignationLabel: "Licensing Officer",
          }
        : l,
    );
    const { elements } = lanesToBpmn(lanes);
    const node = elements.find((e) => e.properties?.laneKey === "inspection");
    expect(node?.properties?.slaMinutes).toBe(7 * 1440);
    expect(node?.properties?.escalationDesignationId).toBe("pos-officer");
  });
});
