import { describe, it, expect } from "vitest";
import {
  CONTRACTOR_WRITE_ROLES,
  CONTRACTOR_READ_ROLES,
  CONTRACTOR_PII_REVEAL_ROLES,
  canWriteContractors,
  canRevealContractorPii,
} from "./roles";

describe("works contractor roles — mirrors works-service contractor/routes.ts", () => {
  it("WRITE_ROLES matches the service WRITE_ROLES exactly", () => {
    expect([...CONTRACTOR_WRITE_ROLES]).toEqual([
      "works_admin",
      "works_operator",
      "super_admin",
      "dao",
      "do",
    ]);
  });

  it("READ_ROLES is the superset the service grants read access", () => {
    expect([...CONTRACTOR_READ_ROLES]).toEqual([
      "works_admin",
      "works_operator",
      "super_admin",
      "dao",
      "do",
      "works_viewer",
      "sdo",
      "section_officer",
      "estimator",
    ]);
  });

  it("PII reveal is restricted to a tier narrower than write (works_operator excluded)", () => {
    expect([...CONTRACTOR_PII_REVEAL_ROLES]).toEqual(["works_admin", "super_admin", "dao", "do"]);
    expect(canRevealContractorPii(["works_operator"])).toBe(false);
    expect(canRevealContractorPii(["works_viewer"])).toBe(false);
    expect(canRevealContractorPii(["works_admin"])).toBe(true);
  });

  it("canWriteContractors gates write roles", () => {
    expect(canWriteContractors(["works_viewer"])).toBe(false);
    expect(canWriteContractors(["estimator"])).toBe(false);
    expect(canWriteContractors(["dao"])).toBe(true);
  });
});
