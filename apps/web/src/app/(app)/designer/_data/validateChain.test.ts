import { describe, expect, it } from "vitest";
import { defaultLanes, validateChain } from "./workflowConstants";

/**
 * GAP-DESIGNER-DETAIL-B4-01 & B4-02: validateChain surfaces design-time warnings
 * for empty designations, duplicate designations across action lanes, and SLAs
 * with no escalation target.
 */
describe("validateChain (GAP-DESIGNER-DETAIL-B4-01/B4-02)", () => {
  it("flags an enabled action lane with no designation", () => {
    const lanes = defaultLanes(); // all designations empty by default
    const warnings = validateChain(lanes);
    expect(warnings.some((w) => w.kind === "empty_designation")).toBe(true);
  });

  it("flags duplicate designation across inspection and decision", () => {
    const lanes = defaultLanes().map((l) =>
      l.key === "inspection" || l.key === "decision"
        ? { ...l, designationId: "pos-1", designationLabel: "Officer", slaDays: 5, escalationDesignationId: "pos-9" }
        : { ...l, designationId: "pos-2", escalationDesignationId: "pos-9" },
    );
    const warnings = validateChain(lanes);
    expect(warnings.some((w) => w.kind === "duplicate_designation")).toBe(true);
  });

  it("flags an SLA with no escalation designation and clears when set", () => {
    const withSla = defaultLanes().map((l) =>
      l.key === "decision"
        ? { ...l, designationId: "pos-1", slaDays: 5, escalationDesignationId: "" }
        : { ...l, designationId: "pos-2", escalationDesignationId: "pos-9" },
    );
    expect(validateChain(withSla).some((w) => w.kind === "missing_escalation")).toBe(true);

    const withEscalation = withSla.map((l) =>
      l.key === "decision" ? { ...l, escalationDesignationId: "pos-9" } : l,
    );
    expect(validateChain(withEscalation).some((w) => w.kind === "missing_escalation")).toBe(false);
  });

  it("does not flag terminal submitted/issued lanes", () => {
    const lanes = defaultLanes().map((l) => ({
      ...l,
      designationId: "pos-x",
      escalationDesignationId: "pos-y",
    }));
    const warnings = validateChain(lanes);
    // submitted and issued should not produce empty_designation warnings
    expect(warnings.every((w) => {
      const lane = lanes.find((l) => l.id === w.laneId);
      return lane?.key !== "submitted" && lane?.key !== "issued";
    })).toBe(true);
  });
});
