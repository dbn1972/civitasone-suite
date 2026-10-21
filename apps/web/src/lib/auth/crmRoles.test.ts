import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CRM_PII_READ_ROLES } from "./crmRoles";
import * as roleGuard from "./roleGuard";

/**
 * crm-service's shared/pii-reveal.ts is the authority: its reveal endpoint accepts
 * exactly CRM_PII_READ_ROLES. The web copy only decides which controls to OFFER, so the
 * two lists must not drift - read the server source and compare, rather than comparing
 * the web list to a literal typed into this test.
 */
const SERVER_FILE = resolve(__dirname, "../../../../../services/crm-service/src/shared/pii-reveal.ts");

function serverRoles(): string[] {
  const src = readFileSync(SERVER_FILE, "utf8");
  const body = /export const CRM_PII_READ_ROLES = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
  return [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}

describe("CRM_PII_READ_ROLES (GAP-CRM-DEDUP-CANDIDATES-01)", () => {
  it("is ONE list: the server-only roleGuard re-exports the client-safe module, not a copy", () => {
    expect(roleGuard.CRM_PII_READ_ROLES).toBe(CRM_PII_READ_ROLES);
  });

  it("could read the crm-service role list it is compared against", () => {
    expect(serverRoles().length).toBeGreaterThan(0);
  });

  it("matches, element for element, the roles crm-service/src/shared/pii-reveal.ts accepts", () => {
    expect([...CRM_PII_READ_ROLES].sort()).toEqual([...serverRoles()].sort());
  });

  it("is pinned to the reviewed set (a change here is a deliberate access-policy change)", () => {
    expect([...CRM_PII_READ_ROLES].sort()).toEqual(["admin", "crm_admin", "platform_admin", "super_admin", "tenant_admin"]);
  });

  it("does not include the base crm_user", () => {
    expect(CRM_PII_READ_ROLES).not.toContain("crm_user");
  });
});
