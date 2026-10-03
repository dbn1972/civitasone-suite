import { describe, it, expect } from "vitest";
import { actionsFor, currentStageLabel, parseRequisitions } from "./requisitionView";

describe("actionsFor", () => {
  it("offers only the action that can apply to each status", () => {
    expect(actionsFor("draft")).toEqual(["submit"]);
    expect(actionsFor("returned")).toEqual(["submit"]);
    expect(actionsFor("pending_approval")).toEqual(["approve", "return"]);
    expect(actionsFor("approved")).toEqual(["publish"]);
  });
  it("offers nothing once published, closed, cancelled or on hold", () => {
    for (const s of ["published", "closed", "cancelled", "on_hold", "mystery"]) expect(actionsFor(s)).toEqual([]);
  });
});

describe("currentStageLabel", () => {
  const chain = [{ stage: "Hiring Manager", role: "hiring_manager" }, { stage: "HR", role: "hr_admin" }];
  it("names the stage a pending requisition waits on", () => {
    expect(currentStageLabel({ status: "pending_approval", currentStage: 1, approvalChain: chain })).toBe("HR");
  });
  it("is null outside pending approval or for an out-of-range stage", () => {
    expect(currentStageLabel({ status: "approved", currentStage: 1, approvalChain: chain })).toBeNull();
    expect(currentStageLabel({ status: "pending_approval", currentStage: 9, approvalChain: chain })).toBeNull();
    expect(currentStageLabel({ status: "pending_approval", currentStage: 0 })).toBeNull();
  });
});

describe("parseRequisitions", () => {
  it("accepts { data: [...] } and a bare array", () => {
    expect(parseRequisitions({ data: [{ id: "a" }] })).toHaveLength(1);
    expect(parseRequisitions([{ id: "a" }])).toHaveLength(1);
  });
  it("returns null (an error, not an empty list) for an unexpected payload", () => {
    expect(parseRequisitions({})).toBeNull();
    expect(parseRequisitions(null)).toBeNull();
    expect(parseRequisitions("x")).toBeNull();
  });
});
