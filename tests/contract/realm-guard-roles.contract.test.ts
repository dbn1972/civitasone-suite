/**
 * UAT bundle 23 (ROLES & NAVIGATION): service guards name realm roles that the realm did not define, so a
 * least-privilege department user could not do normal jobs (GRN needs a store/inventory role, the asset register
 * needs asset_manager, ...). This pins that every role below, each verified in a requireRole guard in the named
 * service, is defined in the checked-in realm, and that the deploy-time sync script is create-only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error plain ESM script, no type declarations
import { planRoleSync, desiredRealmRoles } from "../../scripts/ops/sync-keycloak-realm-roles.mjs";

const ROOT = join(__dirname, "../..");
const realm = JSON.parse(readFileSync(join(ROOT, "infra/keycloak/civitasone-realm.json"), "utf8"));
const defined = new Set<string>(realm.roles.realm.map((r: { name: string }) => r.name));

/** role -> a service source file whose guard names it (verified 2026-11-09). */
const GUARDED: Record<string, string> = {
  store_officer: "services/inventory-service/src/modules/srn/routes.ts",
  warehouse_officer: "services/procurement-service/src/modules/grn/routes.ts",
  store_keeper: "services/inventory-service/src/modules/stores/routes.ts",
  inventory_user: "services/inventory-service/src/modules/stores/routes.ts",
  inventory_manager: "services/inventory-service/src/modules/stores/routes.ts",
  inventory_admin: "services/inventory-service/src/modules/stores/routes.ts",
  asset_manager: "services/asset-service/src/modules/register/routes.ts",
  asset_admin: "services/asset-service/src/modules/register/routes.ts",
  meeting_admin: "services/meeting-service/src/modules/action-item/routes.ts",
  committee_secretary: "services/meeting-service/src/modules/action-item/routes.ts",
  committee_chairperson: "services/meeting-service/src/modules/action-item/routes.ts",
  committee_member: "services/meeting-service/src/modules/action-item/routes.ts",
  observer: "services/meeting-service/src/modules/agenda/routes.ts",
  billing_admin: "services/billing-service/src/modules/einvoice/routes.ts",
  revenue_officer: "services/revenue-service/src/modules/arrears/routes.ts",
  revenue_admin: "services/revenue-service/src/modules/arrears/routes.ts",
  revenue_collector: "services/revenue-service/src/modules/assessment/routes.ts",
  contract_admin: "services/contract-service/src/modules/approvals/routes.ts",
  supervising_officer: "services/inspection-service/src/modules/assignment/routes.ts",
  reviewing_officer: "services/inspection-service/src/modules/dashboard/routes.ts",
  vigilance_officer: "services/audit-service/src/modules/vigilance/routes.ts",
  project_manager: "services/project-service/src/modules/progress/routes.ts",
  project_officer: "services/project-service/src/modules/progress/routes.ts",
};

describe("realm defines every role the UAT journeys need", () => {
  it.each(Object.entries(GUARDED))("%s is a realm role and is named by a real guard (%s)", (role, file) => {
    expect(defined.has(role), `${role} missing from infra/keycloak/civitasone-realm.json`).toBe(true);
    expect(readFileSync(join(ROOT, file), "utf8")).toMatch(new RegExp(`["']${role}["']`));
    const def = realm.roles.realm.find((r: { name: string }) => r.name === role);
    expect(def.description, `${role} needs a description`).toBeTruthy();
  });

  it("has no duplicate role names", () => {
    expect(defined.size).toBe(realm.roles.realm.length);
  });
});

describe("sync-keycloak-realm-roles planRoleSync is create-only", () => {
  const desired = [
    { name: "super_admin", description: "edited text must never be pushed" },
    { name: "store_officer", description: "Stores officer" },
    { name: "store_officer", description: "duplicate in the file" },
    { name: "asset_manager" },
  ];
  it("plans only roles absent live, once each, and never an existing one", () => {
    const plan = planRoleSync(desired, ["super_admin", "employee"]);
    expect(plan.map((r: { name: string }) => r.name)).toEqual(["store_officer", "asset_manager"]);
  });
  it("is idempotent: a fully-synced realm plans nothing", () => {
    expect(planRoleSync(desired, ["super_admin", "store_officer", "asset_manager"])).toEqual([]);
  });
  it("covers the checked-in realm file", () => {
    expect(planRoleSync(desiredRealmRoles(), [...defined])).toEqual([]);
  });
  it("the script source never issues PUT or DELETE", () => {
    const src = readFileSync(join(ROOT, "scripts/ops/sync-keycloak-realm-roles.mjs"), "utf8");
    expect(src).not.toMatch(/method:\s*["'](PUT|DELETE|PATCH)["']/);
  });
});
