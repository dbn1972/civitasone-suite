import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CRM_PII_READ_ROLES, CRM_MERGE_ROLES } from "./crmRoles";
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

/**
 * Both merge endpoints (accounts: contacts/merge-routes.ts, contacts: contacts/routes.ts) gate on
 * `const ADMIN_ROLES = [...]`. The web copy only decides whether the Merge control is OFFERED
 * (accounts page, Duplicate Candidates page), so it must be exactly that list.
 */
function serverAdminRoles(file: string): string[] {
  const src = readFileSync(resolve(__dirname, "../../../../../services/crm-service/src/modules/contacts", file), "utf8");
  const body = /const ADMIN_ROLES = \[([^\]]*)\]/.exec(src)?.[1] ?? "";
  return [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}

describe("CRM_MERGE_ROLES (Duplicate Candidates Merge gate)", () => {
  it("is ONE list: the server-only roleGuard re-exports the client-safe module, not a copy", () => {
    expect(roleGuard.CRM_MERGE_ROLES).toBe(CRM_MERGE_ROLES);
  });

  it.each(["merge-routes.ts", "routes.ts"])("matches, element for element, the ADMIN_ROLES of contacts/%s", (file) => {
    expect(serverAdminRoles(file).length).toBeGreaterThan(0);
    expect([...CRM_MERGE_ROLES].sort()).toEqual([...serverAdminRoles(file)].sort());
  });

  it("does not include the base crm_user or tenant_admin (the server 403s both)", () => {
    expect(CRM_MERGE_ROLES).not.toContain("crm_user");
    expect(CRM_MERGE_ROLES).not.toContain("tenant_admin");
  });
});

/**
 * Web-to-backend drift protection for the rest of the CRM role lists that claim to mirror a crm-service route.
 * Each web list only decides whether a control is OFFERED; the route is the authority, and a role the web names that
 * the route does not admit yields a button that always 403s (a role the route admits that the web omits hides a
 * working control). So each is compared, element for element, with the `const NAME = [...]` it mirrors, read from the
 * server source rather than a literal typed here.
 */
const SERVICE_SRC = resolve(__dirname, "../../../../../services/crm-service/src");

function serverList(file: string, constName: string): string[] {
  const src = readFileSync(resolve(SERVICE_SRC, file), "utf8");
  const body = new RegExp(`const ${constName} = \\[([^\\]]*)\\]`).exec(src)?.[1] ?? "";
  return [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}
const sorted = (xs: readonly string[]) => [...xs].sort();

describe("CRM role lists are pinned to the crm-service route that enforces them", () => {
  it("could read every server list it is compared against (a renamed constant fails here, not silently)", () => {
    for (const [file, name] of [
      ["modules/products/routes.ts", "ADMIN_ROLES"],
      ["modules/service-requests/routes.ts", "ADMIN_ROLES"],
      ["modules/teams/routes.ts", "ADMIN_ROLES"],
      ["modules/dashboard/campaign-roi-routes.ts", "ADMIN_ROLES"],
      ["modules/documents/routes.ts", "VERIFY_ROLES"],
      ["modules/deals/quotation-approval-routes.ts", "ADMIN_ROLES"],
      ["modules/onboarding/routes.ts", "KYC_APPROVER_ROLES"],
      ["modules/grievances/routes.ts", "ADMIN_ROLES"],
      ["modules/contacts/routes.ts", "CRM_ROLES"],
    ] as const) {
      expect(serverList(file, name).length, `${file} ${name}`).toBeGreaterThan(0);
    }
  });

  it.each(["modules/products/routes.ts", "modules/service-requests/routes.ts", "modules/teams/routes.ts"])(
    "CRM_STRICT_ADMIN_ROLES matches ADMIN_ROLES of %s (Product Catalogue, Service Types, Agent Workload)",
    (file) => {
      expect(sorted(roleGuard.CRM_STRICT_ADMIN_ROLES)).toEqual(sorted(serverList(file, "ADMIN_ROLES")));
    },
  );

  it("CRM_CAMPAIGN_PERFORMANCE_POST_ROLES matches ADMIN_ROLES of dashboard/campaign-roi-routes.ts", () => {
    expect(sorted(roleGuard.CRM_CAMPAIGN_PERFORMANCE_POST_ROLES)).toEqual(sorted(serverList("modules/dashboard/campaign-roi-routes.ts", "ADMIN_ROLES")));
  });

  it("CRM_SERVICE_REQUEST_ASSIGN_ROLES matches ADMIN_ROLES of service-requests/routes.ts (PATCH .../assign)", () => {
    expect(sorted(roleGuard.CRM_SERVICE_REQUEST_ASSIGN_ROLES)).toEqual(sorted(serverList("modules/service-requests/routes.ts", "ADMIN_ROLES")));
  });

  it("the service-request detail page uses the exported assign list, not a local copy of it", () => {
    const page = readFileSync(resolve(__dirname, "../../app/(app)/crm/service-requests/[id]/page.tsx"), "utf8");
    expect(page).toContain("CRM_SERVICE_REQUEST_ASSIGN_ROLES");
    expect(page).not.toMatch(/const ASSIGN_ROLES\b/);
  });

  it("CRM_VERIFY_ROLES is exactly VERIFY_ROLES of documents/routes.ts - no admin / platform_admin (the server 403s both)", () => {
    expect(sorted(roleGuard.CRM_VERIFY_ROLES)).toEqual(sorted(serverList("modules/documents/routes.ts", "VERIFY_ROLES")));
    expect(roleGuard.CRM_VERIFY_ROLES).not.toContain("admin");
    expect(roleGuard.CRM_VERIFY_ROLES).not.toContain("platform_admin");
    expect(roleGuard.CRM_VERIFY_ROLES).not.toContain("crm_user");
  });

  it("CRM_QUOTATION_APPROVE_ROLES matches ADMIN_ROLES of deals/quotation-approval-routes.ts", () => {
    expect(sorted(roleGuard.CRM_QUOTATION_APPROVE_ROLES)).toEqual(sorted(serverList("modules/deals/quotation-approval-routes.ts", "ADMIN_ROLES")));
  });

  it("CRM_KYC_APPROVER_ROLES matches KYC_APPROVER_ROLES of onboarding/routes.ts", () => {
    expect(sorted(roleGuard.CRM_KYC_APPROVER_ROLES)).toEqual(sorted(serverList("modules/onboarding/routes.ts", "KYC_APPROVER_ROLES")));
  });

  it("CRM_GRIEVANCE_CLOSE_ROLES matches ADMIN_ROLES of grievances/routes.ts", () => {
    expect(sorted(roleGuard.CRM_GRIEVANCE_CLOSE_ROLES)).toEqual(sorted(serverList("modules/grievances/routes.ts", "ADMIN_ROLES")));
  });

  it("CRM_CONTACT_READ_ROLES matches CRM_ROLES of contacts/routes.ts (GET /v1/crm/contacts/:id)", () => {
    expect(sorted(roleGuard.CRM_CONTACT_READ_ROLES)).toEqual(sorted(serverList("modules/contacts/routes.ts", "CRM_ROLES")));
  });
});
