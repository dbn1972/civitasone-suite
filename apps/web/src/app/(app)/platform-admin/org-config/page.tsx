import { getOrgHierarchyLevels } from "@/app/_data/loaders";
import { PageHeader, StatCard } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { OrgConfigPage } from "./OrgConfigPage";

// COMP-014: this page used to seed its entire table from a hardcoded
// DEFAULT_LEVELS constant and PUT to /v1/admin/org-hierarchy, a path with no
// PUT route at all (the failure was hidden behind an unconditional "Org
// hierarchy saved." notice, and a reload always showed the same hardcoded
// 5 levels regardless). /v1/admin/org-hierarchy-levels (admin-service's new
// org-hierarchy-levels module) is a dedicated backend for this
// hierarchy-LEVEL-taxonomy concept — deliberately distinct from
// /v1/admin/org-hierarchy, the real org-unit-INSTANCE CRUD already consumed
// by admin/org/OrgHierarchyManager.tsx. Every load and save now goes through
// this real per-tenant store (tenant override, platform default fallback —
// see admin-service's migration 0033).
export default async function OrgConfigRoute() {
  const { data: levels, source } = await getOrgHierarchyLevels();
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "Org Configuration" }]} />
      <PageHeader
        back="/platform-admin"
        title="Organisation Configuration"
        subtitle="Configure the Indian government org hierarchy — Ministry → Department → Division → Section → Unit."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Hierarchy levels" value={levels.length} />
        <StatCard icon="📂" iconBg="#ecfdf3" label="Structure" value="GFR 2017" />
        <StatCard icon="🔗" iconBg="#f1f5f9" label="Reporting chain" value="Top-down" />
        <StatCard icon="✏️" iconBg="#fffaeb" label="Editable" value="Name + Order" />
      </div>
      <OrgConfigPage initialLevels={levels} source={source} />
    </div>
  );
}
