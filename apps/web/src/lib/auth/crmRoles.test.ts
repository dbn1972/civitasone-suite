import { describe, it, expect } from "vitest";
import { CRM_PII_READ_ROLES } from "./crmRoles";
import * as roleGuard from "./roleGuard";

describe("CRM_PII_READ_ROLES (GAP-CRM-DEDUP-CANDIDATES-01)", () => {
  it("is ONE list: the server-only roleGuard re-exports the client-safe module, not a copy", () => {
    expect(roleGuard.CRM_PII_READ_ROLES).toBe(CRM_PII_READ_ROLES);
  });

  it("matches the roles crm-service accepts for the audited contact reveal", () => {
    expect([...CRM_PII_READ_ROLES].sort()).toEqual(["admin", "crm_admin", "platform_admin", "super_admin", "tenant_admin"]);
  });

  it("does not include the base crm_user", () => {
    expect(CRM_PII_READ_ROLES).not.toContain("crm_user");
  });
});
