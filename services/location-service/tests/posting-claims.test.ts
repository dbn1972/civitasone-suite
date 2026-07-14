/**
 * EPIC-2 T2.2: the active-posting resolver shapes an office/position/jurisdiction
 * posting into the JWT org-claim fragment the token issuer embeds. Pins the
 * claim mapping so a regression in claim names/shape is caught (those names are
 * the contract with packages/auth toRequestContext).
 */
import { describe, it, expect } from "vitest";
import { toOrgClaims, type ActivePosting } from "../src/modules/hierarchy/posting-resolver.js";

const SDM: ActivePosting = {
  employeeId: "eeeeeeee-0001-0000-0000-000000000005",
  officeId: "of-sdm",
  officeType: "sdm_office",
  domain: "revenue",
  positionId: "pos-sdm",
  designation: "Sub-Divisional Magistrate",
  magisterial: true,
  jurisdictionUnitIds: ["unit-subdivision-1"],
  jurisdictionLevels: ["subdivision"],
};

describe("posting -> JWT org claims (EPIC-2 T2.2)", () => {
  it("maps office/position/domain/jurisdiction to the snake_case claim fragment", () => {
    expect(toOrgClaims(SDM)).toEqual({
      office_id: "of-sdm",
      position_id: "pos-sdm",
      dept_code: "revenue",
      hierarchy_domain: "revenue",
      jurisdiction_unit_ids: ["unit-subdivision-1"],
    });
  });

  it("carries every jurisdiction unit the office covers", () => {
    const multi = { ...SDM, jurisdictionUnitIds: ["u1", "u2", "u3"] };
    expect(toOrgClaims(multi).jurisdiction_unit_ids).toEqual(["u1", "u2", "u3"]);
  });

  it("derives dept_code + hierarchy_domain from the office domain (police)", () => {
    const sho = { ...SDM, domain: "police", officeType: "police_station" };
    const claims = toOrgClaims(sho);
    expect(claims.dept_code).toBe("police");
    expect(claims.hierarchy_domain).toBe("police");
  });
});
