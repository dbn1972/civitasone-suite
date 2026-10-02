import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState, LoadErrorState } from "@/app/_components/ds";
import { getAdminTenantDetail, getAdminTenantModules } from "@/app/_data/loaders";
import { toHumanError } from "@/lib/messages";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { TenantModulesTable } from "./TenantModulesTable";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // GAP-ADMIN-TENANTS-DETAIL-02: a cross-tenant record -- platform operators
  // only (admin-service GET /v1/admin/tenants/:id is requireSuperAdmin).
  // Gate before the loaders run so a tenant user guessing an id never even
  // triggers the fetch.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Tenant" area="tenant records" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const { id } = await params;
  const [detailResult, modulesResult] = await Promise.all([
    getAdminTenantDetail(id),
    getAdminTenantModules(id),
  ]);

  const tenant = detailResult.data;
  const modules = modulesResult.data;
  const source = detailResult.source === "error" || modulesResult.source === "error" ? "error" : "api";

  // GAP-ADMIN-TENANTS-DETAIL-01: fetchJson returns data=null for EVERY failure
  // (401/403/404/5xx/network), so branching on `!tenant` alone used to report
  // an outage or an access denial as "Tenant not found — it may have been
  // removed". Only a real 404 is "not found"; 403 shows Access restricted and
  // anything else the retryable load-error state (LoadErrorState does both).
  if (detailResult.source === "error" && detailResult.status !== 404) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Tenant" back="/admin/tenants" />
        <LoadErrorState
          result={detailResult}
          area="tenant"
          module="this tenant"
          backHref="/admin/tenants"
          backLabel="Back to Tenants"
          requiredRoles={[...PLATFORM_ADMIN_ROLES]}
        />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Tenant Not Found" back="/admin/tenants" />
        <Card>
          <EmptyState
            icon="🔍"
            title="Tenant not found"
            message="No tenant exists for the given ID. It may have been removed."
          />
        </Card>
      </div>
    );
  }

  const enabledCount = modules.filter((m) => m.enabled === "Yes").length;
  const totalUsers = modules.reduce((sum, m) => sum + m.users, 0);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Tenant: ${tenant.name}`}
        subtitle={`Edition: ${tenant.edition} · Status: ${tenant.status} · Region: ${tenant.region}`}
        back="/admin/tenants"
      />
      <StatGrid>
        <StatCard icon="📦" iconBg="#eef2ff" label="Modules Enabled" value={enabledCount} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Active Users" value={totalUsers} />
        <StatCard icon="🏢" iconBg="#fffaeb" label="Edition" value={tenant.edition} />
        <StatCard icon="🔒" iconBg="#fce7ee" label="Status" value={tenant.status} />
      </StatGrid>
      <Card title="Module Usage">
        {/* UX-012: the data-source badge now lives inside TenantModulesTable,
            driven by the same useSeededResource call that produces its rows —
            not a second, independent read of `source` here that could
            disagree with the table's own cache state (UX-002's pattern). */}
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "tenant modules" })} />
        ) : modules.length === 0 ? (
          <EmptyState icon="📦" title="No modules" message="No modules configured for this tenant." />
        ) : (
          <TenantModulesTable modules={modules} source="api" />
        )}
      </Card>
    </div>
  );
}
