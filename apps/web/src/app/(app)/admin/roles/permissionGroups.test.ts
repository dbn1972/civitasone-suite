import { describe, it, expect } from "vitest";
import { groupPermissions, permissionPrefix, permissionsTruncated, PERMISSIONS_PAGE_LIMIT } from "./permissionGroups";

const p = (key: string, name = key) => ({ id: key, key, name, description: null });

describe("permission grouping (GAP-ADMIN-ROLES-04/06)", () => {
  it("derives the prefix from the first . or :", () => {
    expect(permissionPrefix("hr.leave.approve")).toBe("hr");
    expect(permissionPrefix("finance:read")).toBe("finance");
    expect(permissionPrefix("superuser")).toBe("general");
  });
  it("groups and filters", () => {
    const perms = [p("hr.read"), p("hr.write"), p("finance.read", "View finance")];
    expect(groupPermissions(perms, "").map((g) => [g.prefix, g.items.length])).toEqual([["hr", 2], ["finance", 1]]);
    expect(groupPermissions(perms, "HR").map((g) => g.prefix)).toEqual(["hr"]);
    expect(groupPermissions(perms, "view fin")[0].items[0].key).toBe("finance.read");
    expect(groupPermissions(perms, "zzz")).toEqual([]);
  });
  it("flags a full page as truncated", () => {
    expect(permissionsTruncated(PERMISSIONS_PAGE_LIMIT)).toBe(true);
    expect(permissionsTruncated(PERMISSIONS_PAGE_LIMIT - 1)).toBe(false);
  });
});
