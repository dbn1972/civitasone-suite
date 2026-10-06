/**
 * GAP-TENANT-ADMIN-ORG-TYPE-05: PATCH /v1/tenants/:id must reject a settings
 * payload whose orgType is not in the supported enum, and accept a valid one.
 * The updateTenant consumer already emits a tenant.updated audit event in the
 * same transaction as the write (see modules/tenant/consumer.ts), so a valid
 * org-type change is audited. This test pins the validator contract (pure, no
 * DB / app build).
 */
import { describe, it, expect } from "vitest";
import { updateTenantBody, ORG_TYPES } from "../src/modules/tenant/validators.js";

describe("GAP-TENANT-ADMIN-ORG-TYPE-05 — orgType enum validation", () => {
  it("accepts a valid orgType in settings", () => {
    const r = updateTenantBody.safeParse({ settings: { orgType: "private" } });
    expect(r.success).toBe(true);
  });

  it("rejects a bogus orgType", () => {
    const r = updateTenantBody.safeParse({ settings: { orgType: "bogus" } });
    expect(r.success).toBe(false);
  });

  it("rejects a non-string orgType", () => {
    const r = updateTenantBody.safeParse({ settings: { orgType: 5 } });
    expect(r.success).toBe(false);
  });

  it("still allows settings without orgType (other keys untouched)", () => {
    const r = updateTenantBody.safeParse({ settings: { theme: "dark" } });
    expect(r.success).toBe(true);
  });

  it("the enum matches the web ORG_TYPES list exactly", () => {
    expect([...ORG_TYPES]).toEqual([
      "govt_dept", "govt_autonomous", "psu", "private", "ngo", "cooperative", "municipal", "educational",
    ]);
  });
});
