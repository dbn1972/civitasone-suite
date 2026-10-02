import { describe, it, expect } from "vitest";
import { availableActions, actionsForActor, isCaseOwner, penaltyOptionsFor } from "./caseActions";

describe("case actions (GAP-HR-DISCIPLINARY-DETAIL-06)", () => {
  it("walks the major path", () => {
    expect(availableActions("opened", "major")).toEqual(["charge_memo", "drop"]);
    expect(availableActions("charge_memo_issued", "major")).toEqual(["inquiry", "drop"]);
    expect(availableActions("inquiry_appointed", "major")).toEqual(["finding", "drop"]);
    expect(availableActions("finding_recorded", "major")).toEqual(["penalty", "drop"]);
  });
  it("lets a minor proceeding go straight from charge memo to penalty, never to an inquiry", () => {
    expect(availableActions("charge_memo_issued", "minor")).toEqual(["penalty", "drop"]);
  });
  it("offers nothing on terminal states", () => {
    expect(availableActions("closed", "major")).toEqual([]);
    expect(availableActions("dropped", "minor")).toEqual([]);
  });
  it("does not offer a manual impose from pending_approval (eOffice owns that transition)", () => {
    expect(availableActions("pending_approval", "major")).toEqual(["drop"]);
  });
  it("hides every action from a non-owner", () => {
    expect(actionsForActor("opened", "major", ["hr_admin"], false)).toEqual([]);
  });
  it("hides HR-only actions from hr_officer but keeps vigilance-tier ones", () => {
    expect(actionsForActor("opened", "major", ["hr_officer"], true)).toEqual(["charge_memo"]);
    expect(actionsForActor("opened", "major", ["hr_admin"], true)).toEqual(["charge_memo", "drop"]);
  });
  it("owner check = creator or assigned inquiry officer only", () => {
    const c = { createdBy: "u1", inquiryOfficerId: "u2" };
    expect(isCaseOwner("u1", c)).toBe(true);
    expect(isCaseOwner("u2", c)).toBe(true);
    expect(isCaseOwner("u3", c)).toBe(false);
    expect(isCaseOwner(null, c)).toBe(false);
    expect(isCaseOwner("u1", { createdBy: "x", inquiryOfficerId: null })).toBe(false);
  });
  it("limits a minor proceeding to minor penalties", () => {
    expect(penaltyOptionsFor("minor")).not.toContain("dismissal");
    expect(penaltyOptionsFor("major")).toContain("dismissal");
  });
});
