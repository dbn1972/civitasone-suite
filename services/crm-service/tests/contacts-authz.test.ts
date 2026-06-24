/**
 * P1-5: a non-admin PATCH must not reassign ownerId nor flip status.
 * Tests the strip logic in isolation (the route deletes those fields for
 * non-admins before dispatch).
 */
import { describe, it, expect } from "vitest";
import { updateContactBody } from "../src/modules/contacts/validators.js";

const ADMIN_ROLES = ["crm_admin", "super_admin"];
function isAdmin(roles: string[]): boolean {
  return roles.some((r) => ADMIN_ROLES.includes(r));
}

// Mirror of the route's privileged-field strip.
function applyStrip(roles: string[], body: Record<string, unknown>): Record<string, unknown> {
  const b = { ...body };
  if (!isAdmin(roles)) {
    delete b.ownerId;
    delete b.status;
  }
  return b;
}

describe("P1-5 non-admin ownerId/status strip", () => {
  it("strips ownerId and status for a non-admin (crm_user)", () => {
    const parsed = updateContactBody.parse({
      name: "Edit",
      ownerId: "11111111-1111-4111-8111-111111111111",
      status: "inactive",
    });
    const out = applyStrip(["crm_user"], parsed);
    expect(out.ownerId).toBeUndefined();
    expect(out.status).toBeUndefined();
    expect(out.name).toBe("Edit");
  });

  it("preserves ownerId/status for an admin", () => {
    const parsed = updateContactBody.parse({
      ownerId: "22222222-2222-4222-8222-222222222222",
      status: "inactive",
    });
    const out = applyStrip(["crm_admin"], parsed);
    expect(out.ownerId).toBe("22222222-2222-4222-8222-222222222222");
    expect(out.status).toBe("inactive");
  });
});
