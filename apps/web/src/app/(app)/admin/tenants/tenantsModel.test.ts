import { describe, it, expect } from "vitest";
import { summariseTenants } from "./tenantsModel";

describe("summariseTenants", () => {
  it("counts by status from the given rows", () => {
    expect(summariseTenants([{ status: "active" }, { status: "Trial" }, { status: "suspended" }, { status: "active" }], false))
      .toEqual({ total: 4, active: 2, trial: 1, suspended: 1 });
  });
  it("is all-null when unavailable", () => {
    expect(summariseTenants([], true)).toEqual({ total: null, active: null, trial: null, suspended: null });
  });
});
