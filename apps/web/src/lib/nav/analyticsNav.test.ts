import { describe, it, expect } from "vitest";
import { visibleNavGroups } from "./navModel";

const ids = (a: Parameters<typeof visibleNavGroups>[0]) => visibleNavGroups(a).flatMap((g) => g.items.map((i) => i.id));

describe("Analytics sidebar entry", () => {
  it.each(["analytics_user", "analytics_viewer", "analytics_admin", "tenant_admin", "super_admin", "platform_admin"])(
    "%s sees Data & Analytics",
    (role) => expect(ids({ roles: [role], enabledModules: ["analytics"] })).toContain("analytics"),
  );
  it("a plain employee does not", () => {
    expect(ids({ roles: ["employee"], enabledModules: ["analytics"] })).not.toContain("analytics");
  });
  it("is hidden when the analytics module is disabled", () => {
    expect(ids({ roles: ["analytics_admin"], enabledModules: ["finance"] })).not.toContain("analytics");
  });
});
