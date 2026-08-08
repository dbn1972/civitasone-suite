import { describe, it, expect } from "vitest";
import {
  slaDaysToMinutes,
  lanesToExecutableGraph,
  resolveEscalationRecipient,
} from "./lane-compile.js";

describe("FN-25 lane compile → executable SLA clocks", () => {
  it("converts days to minutes", () => {
    expect(slaDaysToMinutes(1)).toBe(1440);
    expect(slaDaysToMinutes(0)).toBeNull();
  });

  it("compiles guided lanes with slaMinutes and escalateToRef", () => {
    const { nodes, edges } = lanesToExecutableGraph([
      { key: "submitted", name: "Submitted", slaDays: 1, designationId: "citizen" },
      {
        key: "inspection",
        name: "Inspection",
        slaDays: 7,
        designationId: "pos-inspector",
        escalationDesignationId: "pos-officer",
      },
      {
        key: "decision",
        name: "Decision",
        slaDays: 5,
        designationId: "pos-officer",
        escalationDesignationId: "pos-chief",
      },
      { key: "issued", name: "Issued", slaDays: 1 },
    ]);

    const inspection = nodes.find((n) => n.nodeKey === "inspection");
    expect(inspection?.slaMinutes).toBe(7 * 1440);
    expect(inspection?.escalateToRef).toBe("pos-officer");
    expect(inspection?.roleRef).toBe("pos-inspector");
    expect(edges.length).toBeGreaterThanOrEqual(3);
  });

  it("skips disabled optional lanes", () => {
    const { nodes } = lanesToExecutableGraph([
      { key: "submitted", name: "Submitted", slaDays: 1 },
      { key: "inspection", name: "Inspection", slaDays: 7, enabled: false },
      { key: "decision", name: "Decision", slaDays: 5, designationId: "pos-o", escalationDesignationId: "pos-c" },
      { key: "issued", name: "Issued", slaDays: 1 },
    ]);
    expect(nodes.find((n) => n.nodeKey === "inspection")).toBeUndefined();
    expect(nodes.find((n) => n.nodeKey === "decision")?.escalateToRef).toBe("pos-c");
  });

  it("resolves escalation recipient preferring superior designation", () => {
    expect(resolveEscalationRecipient({
      escalateToRef: "pos-officer",
      roleRef: "pos-inspector",
      instanceOwnerId: "user-1",
      instanceId: "inst-1",
    })).toBe("pos-officer");

    expect(resolveEscalationRecipient({
      escalateToRef: null,
      roleRef: "pos-inspector",
      instanceOwnerId: "user-1",
      instanceId: "inst-1",
    })).toBe("user-1");
  });
});
