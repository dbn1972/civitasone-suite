import { describe, it, expect } from "vitest";
import { roleDisplayLabel } from "./roles";

describe("roleDisplayLabel (GAP-PLATFORM-ADMIN-HOME-04)", () => {
  it("maps known keys to human labels", () => {
    expect(roleDisplayLabel("platform_admin")).toBe("Platform Admin");
    expect(roleDisplayLabel("hr_staff")).toBe("HR Staff");
  });
  it("humanises an unknown backend-catalogue key rather than dropping it", () => {
    expect(roleDisplayLabel("revenue_officer")).toBe("Revenue Officer");
  });
});
