import { getAdminOrgUnits } from "@/app/_data/loaders";
import { OrgHierarchyManager } from "./OrgHierarchyManager";

// COMP-004: this page used to edit a purely local, hardcoded 12-node
// "Ministry of Finance" tree and Save with PUT /v1/admin/org-hierarchy
// {tree} — a shape no route ever accepted (backend has no bulk-replace
// command). tenant-service's org-hierarchy module (real Postgres
// `tenant.org_units` table) is fully built and forwarded here (gap/
// routes.ts) — but its unit-type taxonomy is flat (department/division/
// section/unit/branch, cycle-checked on reparent), with no "Ministry"
// level, so the page's fixed 5-level model was rebuilt around the real
// types. Every action (create, rename) is now a real POST/PATCH against
// GET /v1/admin/org-hierarchy's actual data, followed by a refetch — there
// is no client-side tree state that can drift from the server.
export default async function OrgHierarchyPage() {
  const { data: units, source } = await getAdminOrgUnits();
  return <OrgHierarchyManager initialUnits={units} source={source} />;
}
