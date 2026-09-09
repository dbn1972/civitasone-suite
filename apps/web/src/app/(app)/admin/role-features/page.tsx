import { getAdminRolesList, getRoleFeatureGrants } from "@/app/_data/loaders";
import { RoleFeaturesManager } from "./RoleFeaturesManager";

// COMP-004: this page used to hold 16 hardcoded INITIAL_GRANTS across a
// fixed 6-role x 16-feature matrix, with handleSave() a documented no-op
// ("In production: POST to API"). policy-service's role-features module
// (services/policy-service/src/modules/role-features) is fully built —
// real Postgres table `role_features.role_feature_grants`, command/consumer
// write path, GET/POST/DELETE routes registered at /v1/policy/role-features
// — and reachable through the gateway's existing "policy-v1" prefix with no
// admin-service proxy needed. It was simply never wired to this page.
//
// Now: the roles column comes from the real GET /v1/admin/roles (this
// tenant's actual RBAC roles, not 6 invented role names), and every grant/
// revoke is a real POST/DELETE against the real grants table. The list of
// selectable feature KEYS stays a curated picklist (FEATURE_KEYS in
// RoleFeaturesManager.tsx) — there is no backend registry of "every feature
// that could ever exist" to load one from; only which grants exist is real
// data, and that now is. Grant/revoke is async (command -> queue ->
// consumer), so the matrix updates optimistically from each request's own
// 202 response and a banner says the change is still settling.
export default async function RoleFeaturesPage() {
  const [{ data: roles, source: rolesSource }, { data: grants, source: grantsSource }] = await Promise.all([
    getAdminRolesList(),
    getRoleFeatureGrants(),
  ]);
  const source = rolesSource === "error" || grantsSource === "error" ? "error" : "api";
  return <RoleFeaturesManager roles={roles} initialGrants={grants} source={source} />;
}
