import { describe, expect, it } from "vitest";
import { defaultLanes, narrateWorkflow } from "./workflowConstants";
import {
  describeRevertToTemplateDiff,
  lanesFromBpmn,
  lanesToBpmn,
  roundTripLanes,
} from "./workflowRoundTrip";

describe("workflow BPMN round-trip", () => {
  it("regenerates guided lanes from template BPMN", () => {
    const lanes = defaultLanes().map((l) =>
      l.key === "decision"
        ? { ...l, designationId: "pos-1", designationLabel: "Licensing Officer", slaDays: 5 }
        : l,
    );
    const again = roundTripLanes(lanes);
    expect(again).not.toBeNull();
    const decision = again!.find((l) => l.key === "decision");
    expect(decision?.designationLabel).toBe("Licensing Officer");
    expect(decision?.slaDays).toBe(5);
    expect(decision?.enabled).toBe(true);
  });

  it("builds a linear BPMN chain from guided lanes", () => {
    const { elements, edges } = lanesToBpmn(defaultLanes());
    expect(elements.some((e) => e.type === "startEvent")).toBe(true);
    expect(elements.some((e) => e.type === "task" && e.label === "Decision")).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
  });

  it("treats free-form gateway graphs as non-template (custom mode)", () => {
    const parsed = lanesFromBpmn([
      { id: "start_1", type: "startEvent", label: "Start", position: { x: 0, y: 0 } },
      { id: "gw_1", type: "exclusiveGateway", label: "Branch", position: { x: 100, y: 0 } },
      { id: "end_1", type: "endEvent", label: "End", position: { x: 200, y: 0 } },
    ]);
    expect(parsed).toBeNull();
  });

  it("omits disabled optional lanes from the BPMN projection", () => {
    const lanes = defaultLanes().map((l) =>
      l.key === "inspection" ? { ...l, enabled: false } : l,
    );
    const { elements } = lanesToBpmn(lanes);
    expect(elements.some((e) => e.id === "lane_inspection")).toBe(false);
    expect(elements.some((e) => e.id === "lane_decision")).toBe(true);
  });
});

describe("describeRevertToTemplateDiff", () => {
  it("surfaces mode change and lane-level human diffs", () => {
    const template = defaultLanes().map((l) =>
      l.key === "decision"
        ? { ...l, designationLabel: "Licensing Officer", slaDays: 5 }
        : l,
    );
    const custom = template.map((l) =>
      l.key === "decision"
        ? { ...l, designationLabel: "Chief Officer", slaDays: 10 }
        : l.key === "inspection"
          ? { ...l, enabled: false }
          : l,
    );

    const rows = describeRevertToTemplateDiff(custom, template);
    expect(rows[0]?.label).toBe("Workflow mode");
    expect(rows[0]?.before).toMatch(/custom/i);
    expect(rows[0]?.after).toMatch(/guided/i);

    const decision = rows.find((r) => r.label === "Decision");
    expect(decision?.before).toMatch(/Chief Officer/);
    expect(decision?.after).toMatch(/Licensing Officer/);
    expect(decision?.before).toMatch(/10 days/);
    expect(decision?.after).toMatch(/5 days/);

    const inspection = rows.find((r) => r.label === "Inspection");
    expect(inspection?.before).toBe("Off");
    expect(inspection?.after).toMatch(/Inspection/);
  });

  it("still explains revert when lane settings match the snapshot", () => {
    const lanes = defaultLanes();
    const rows = describeRevertToTemplateDiff(lanes, lanes);
    expect(rows.some((r) => r.label === "Workflow mode")).toBe(true);
    expect(rows.some((r) => r.label === "Steps")).toBe(true);
  });
});

describe("narrateWorkflow (guided verification)", () => {
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
