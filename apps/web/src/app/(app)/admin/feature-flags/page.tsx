import { getAdminFeatureFlagsManage } from "@/app/_data/loaders";
import { FeatureFlagsManager } from "./FeatureFlagsManager";

// COMP-004: this page used to hold 8 hardcoded INITIAL_FLAGS in local state
// with every action (toggle, kill, create) mutating that local array only.
// admin-service's feature-flags module (registered in app.ts, its own real
// Postgres schema `feature_flags`) already ships full CRUD + kill-switch —
// it was simply never wired to this page. Now backed for real: initial list
// via a server loader, every mutation a real fetch to
// /v1/admin/feature-flags/manage[...] followed by a refetch.
export default async function FeatureFlagsPage() {
  const { data: flags, source } = await getAdminFeatureFlagsManage();
  return <FeatureFlagsManager initialFlags={flags} source={source} />;
}
