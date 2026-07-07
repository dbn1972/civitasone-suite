import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { getAdminTenantDetail, getAdminTenantModules } from "@/app/_data/loaders";
import { TenantModulesTable } from "./TenantModulesTable";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detailResult, modulesResult] = await Promise.all([
    getAdminTenantDetail(id),
    getAdminTenantModules(id),
  ]);

  const tenant = detailResult.data;
  const modules = modulesResult.data;
  const source = detailResult.source === "error" || modulesResult.source === "error" ? "error" : "api";

  if (!tenant) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Tenant Not Found" back="/admin/tenants" />
        <Card>
          <EmptyState
            icon="🔍"
            title="Tenant not found"
            message="No tenant exists for the given ID. It may have been removed."
          />
        </Card>
      </main>
    );
  }

  const enabledCount = modules.filter((m) => m.enabled === "Yes").length;
  const totalUsers = modules.reduce((sum, m) => sum + m.users, 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Tenant: ${tenant.name}`}
        subtitle={`Edition: ${tenant.edition} · Status: ${tenant.status} · Region: ${tenant.region}`}
        back="/admin/tenants"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📦" iconBg="#eef2ff" label="Modules Enabled" value={enabledCount} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Active Users" value={totalUsers} />
        <StatCard icon="🏢" iconBg="#fffaeb" label="Edition" value={tenant.edition} />
        <StatCard icon="🔒" iconBg="#fce7ee" label="Status" value={tenant.status} />
      </StatGrid>
      <Card title="Module Usage">
        {modules.length === 0 ? (
          <EmptyState icon="📦" title="No modules" message="No modules configured for this tenant." />
        ) : (
          <TenantModulesTable modules={modules} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
