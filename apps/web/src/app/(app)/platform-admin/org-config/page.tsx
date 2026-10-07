import { requireAnyRole, PLATFORM_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { getOrgHierarchyLevels } from "@/app/_data/loaders";
import { PageHeader, StatCard } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { OrgConfigPage } from "./OrgConfigPage";

// COMP-014: every load/save goes through the real per-tenant org-hierarchy-
// levels store (admin-service GET/PUT /v1/admin/org-hierarchy-levels, tenant
// override with platform-default fallback). Full history: see commit log.
export default async function OrgConfigRoute() {
  requireAnyRole(PLATFORM_ADMIN_ROLES, "/dashboard");
  const { data: levels, source } = await getOrgHierarchyLevels();

  // GAP-PLATFORM-ADMIN-ORG-CONFIG-05: subtitle and stat tiles are derived from
  // the tenant's REAL configured levels, not hardcoded "GFR 2017" / "Top-down"
  // / a fixed "Ministry → Department → …" chain. On a load error show "—".
  const errored = source === "error";
  const chain = levels.map((l) => l.label).join(" → ");
  const subtitle = errored
    ? "Configure your organisation's reporting hierarchy."
    : chain
      ? `Reporting hierarchy — ${chain}.`
      : "No hierarchy levels are configured yet.";
  const topLevel = errored ? null : levels[0]?.label ?? "—";
  const lowestLevel = errored ? null : levels[levels.length - 1]?.label ?? "—";

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "Org Configuration" }]} />
      <PageHeader
        back="/platform-admin"
        title="Organisation Configuration"
        subtitle={subtitle}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Hierarchy levels" value={errored ? null : levels.length} />
        <StatCard icon="⬆️" iconBg="#ecfdf3" label="Top level" value={topLevel} />
        <StatCard icon="⬇️" iconBg="#f1f5f9" label="Lowest level" value={lowestLevel} />
        <StatCard icon="✏️" iconBg="#fffaeb" label="Editable" value={errored ? null : "Name, order, description"} />
      </div>
      <OrgConfigPage initialLevels={levels} source={source} />
    </div>
  );
}
