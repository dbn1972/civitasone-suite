import { getAdminFeatureFlagsManage } from "@/app/_data/loaders";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { FeatureFlagsManager } from "./FeatureFlagsManager";

// COMP-004: this page used to hold 8 hardcoded INITIAL_FLAGS in local state
// with every action (toggle, kill, create) mutating that local array only.
// admin-service's feature-flags module (registered in app.ts, its own real
// Postgres schema `feature_flags`) already ships full CRUD + kill-switch —
// it was simply never wired to this page. Now backed for real: initial list
// via a server loader, every mutation a real fetch to
// /v1/admin/feature-flags/manage[...] followed by a refetch.
export default async function FeatureFlagsPage() {
  // GAP-ADMIN-FEATURE-FLAGS-02: create/toggle/kill are platform-operator
  // actions (admin-service feature-flags/routes.ts ADMIN_ROLES) -- gate
  // before the loader so nobody else is offered the controls.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Feature Flags" area="feature flags" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const { data: flags, source } = await getAdminFeatureFlagsManage();
  return <FeatureFlagsManager initialFlags={flags} source={source} />;
}
