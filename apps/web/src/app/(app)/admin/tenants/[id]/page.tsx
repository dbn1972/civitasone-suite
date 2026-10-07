import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState, LoadErrorState } from "@/app/_components/ds";
import {
  getAdminTenantDetail, getAdminTenantModules, getAdminTenantLifecycleRequests, getAdminTenantApprovalPolicy,
} from "@/app/_data/loaders";
import { toHumanError } from "@/lib/messages";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { isUuid } from "@/lib/pathSegment";
import { TenantModulesTable } from "./TenantModulesTable";
import { seatsInUse, hasNoModules, settingsRows } from "./tenantDetailView";
import { TenantLifecycleSection } from "./TenantLifecycleSection";
import { ApprovalPolicyCard } from "./ApprovalPolicyCard";
import { normalizePolicy, pendingPolicyOf, tenantStatCardTone, tenantStatusKey, tenantStatusTone } from "./lifecycleModel";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // GAP-ADMIN-TENANTS-DETAIL-02: a cross-tenant record -- platform operators
  // only (admin-service GET /v1/admin/tenants/:id is requireSuperAdmin).
  // Gate before the loaders run so a tenant user guessing an id never even
  // triggers the fetch.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Tenant" area="tenant records" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const { id } = await params;
  // GAP-ADMIN-TENANTS-DETAIL-03: tenant ids are uuids (admin-service idParam);
  // anything else never reaches the upstream path.
  if (!isUuid(id)) notFound();
  const [detailResult, modulesResult, requestsResult, policyResult] = await Promise.all([
    getAdminTenantDetail(id),
    getAdminTenantModules(id),
    getAdminTenantLifecycleRequests(id),
    getAdminTenantApprovalPolicy(id),
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
      <div className="page-main wrap">
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
      <div className="page-main wrap">
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
  const seats = seatsInUse(modules);
  const settings = settingsRows(tenant.settings);
  const t = await getTranslations("tenantLifecycle");
  const statusKey = tenantStatusKey(tenant.status);
  const statusLabel = t(`tenantStatus.${statusKey}`);
  const policy = normalizePolicy(policyResult.data);
  const requests = Array.isArray(requestsResult.data) ? requestsResult.data : [];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={`Tenant: ${tenant.name}`}
        subtitle={`${tenant.domain ? `Domain: ${tenant.domain} · ` : ""}Edition: ${tenant.edition} · Status: ${statusLabel} · Region: ${tenant.region}`}
        back="/admin/tenants"
        actions={
          <>
            <span className={`pill ${tenantStatusTone(tenant.status)}`}>{statusLabel}</span>
            <Link href="/admin/onboarding" className="btn ghost sm">Onboarding queue</Link>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="📦" iconBg="#eef2ff" label="Modules Enabled" value={enabledCount} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Module seats in use" value={seats ?? "—"} />
        <StatCard icon="🏢" iconBg="#fffaeb" label="Edition" value={tenant.edition} />
        <StatCard icon="🔒" tone={tenantStatCardTone(tenant.status)} label="Status" value={statusLabel} />
      </StatGrid>
      <TenantLifecycleSection
        tenantId={id}
        tenantName={tenant.name}
        tenantStatus={tenant.status}
        current={{ name: tenant.name, domain: tenant.domain ?? "", edition: tenant.edition }}
        initialRequests={requests}
        requestsSource={requestsResult.source === "error" ? "error" : "api"}
        policy={policy}
      />
      <ApprovalPolicyCard
        tenantId={id}
        policy={policy}
        isDefault={policyResult.data?.isDefault ?? true}
        pending={pendingPolicyOf(requests, policyResult.data)}
        source={policyResult.source === "error" ? "error" : "api"}
      />
      <Card title="Module Usage">
        {/* UX-012: the data-source badge now lives inside TenantModulesTable,
            driven by the same useSeededResource call that produces its rows —
            not a second, independent read of `source` here that could
            disagree with the table's own cache state (UX-002's pattern). */}
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "tenant modules" })} />
        ) : hasNoModules(modules) ? (
          <EmptyState icon="📦" title="No modules" message="No modules configured for this tenant." />
        ) : (
          <TenantModulesTable tenantId={id} modules={modules} source="api" />
        )}
      </Card>
      {settings.length > 0 && (
        <Card title="Settings">
          <dl style={{ display: "grid", gridTemplateColumns: "minmax(120px, 220px) 1fr", gap: "6px 16px", margin: 0, fontSize: 13 }}>
            {settings.map((r) => (
              <div key={r.key} style={{ display: "contents" }}>
                <dt style={{ color: "var(--mut)" }}>{r.key}</dt>
                <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{r.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </div>
  );
}
