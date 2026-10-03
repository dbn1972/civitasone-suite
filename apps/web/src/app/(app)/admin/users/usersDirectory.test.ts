import { describe, it, expect } from "vitest";
import { applyStatusDelta, directoryHref, pageWindow, statusRefusalMessage } from "./usersDirectory";

describe("usersDirectory (GAP-ADMIN-USERS-03)", () => {
  it("builds stable hrefs: empty filters vanish, page 1 is implicit", () => {
    expect(directoryHref({})).toBe("/admin/users");
    expect(directoryHref({ q: "  rao ", status: "active", page: 1 })).toBe("/admin/users?q=rao&status=active");
    expect(directoryHref({ q: "a&b=c", page: 3 })).toBe("/admin/users?q=a%26b%3Dc&page=3");
  });
  it("computes the visible window and whether older/newer pages exist", () => {
    expect(pageWindow(1, 25, 63, 25)).toEqual({ first: 1, last: 25, hasPrev: false, hasNext: true });
    expect(pageWindow(3, 25, 63, 13)).toEqual({ first: 51, last: 63, hasPrev: true, hasNext: false });
    expect(pageWindow(1, 25, 0, 0)).toEqual({ first: 0, last: 0, hasPrev: false, hasNext: false });
  });
  it("moves one user between status buckets and never goes below zero", () => {
    const c = { active: 2, suspended: 0, locked: 0, deactivated: 0 };
    expect(applyStatusDelta(c, "active", "suspended")).toEqual({ active: 1, suspended: 1, locked: 0, deactivated: 0 });
    expect(applyStatusDelta({ ...c, active: 0 }, "active", "suspended").active).toBe(0);
    expect(applyStatusDelta(c, "active", "active")).toBe(c);
  });
  it("maps refusal codes to plain language and leaves unknown codes to the generic message", () => {
    expect(statusRefusalMessage("LAST_TENANT_ADMIN")).toMatch(/last active tenant admin/);
    expect(statusRefusalMessage("SELF_STATUS_CHANGE")).toMatch(/your own account/);
    expect(statusRefusalMessage("SOMETHING_ELSE")).toBeNull();
  });
});
