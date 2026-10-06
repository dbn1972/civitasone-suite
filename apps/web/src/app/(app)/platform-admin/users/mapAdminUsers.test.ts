import { describe, it, expect } from "vitest";
import { mapAdminUsers } from "./mapAdminUsers";

describe("mapAdminUsers (GAP-PLATFORM-ADMIN-USERS-04)", () => {
  it("drops a row with no id instead of inventing String(Math.random())", () => {
    const out = mapAdminUsers([
      { email: "noid@example.gov.in", roles: ["x"] },
      { id: "real-1", email: "ok@example.gov.in", roles: ["y"], status: "active" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("real-1");
    // No numeric-string random id leaked through.
    expect(out.every((u) => !/^0\.\d+$/.test(u.id))).toBe(true);
  });

  it("drops a row whose id is an empty string", () => {
    expect(mapAdminUsers([{ id: "", email: "a@b.gov.in" }])).toHaveLength(0);
  });

  it("produces stable ids across two identical maps (no Math.random drift)", () => {
    const raw = [{ id: "real-2", email: "s@example.gov.in", roles: [] }];
    const first = mapAdminUsers(raw);
    const second = mapAdminUsers(raw);
    expect(first[0].id).toBe(second[0].id);
  });

  it("defaults optional fields without fabricating identity", () => {
    const [u] = mapAdminUsers([{ id: "real-3", email: "d@example.gov.in" }]);
    expect(u.name).toBeNull();
    expect(u.roles).toEqual([]);
    expect(u.status).toBe("active");
    expect(u.mfaEnabled).toBe(false);
  });
});
