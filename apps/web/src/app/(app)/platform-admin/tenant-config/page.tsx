import { PageHeader, StatCard, RefreshErrorState, EmptyState } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { TenantConfigCard } from "./TenantConfigCard";
import { getTenantConfig } from "@/app/_data/loaders";
import { getSessionRoles, requireAnyRole, PLATFORM_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { daysUntilIST, humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

export default async function TenantConfigPage() {
  requireAnyRole(PLATFORM_ADMIN_ROLES, "/dashboard");
  const roles = getSessionRoles();
  const isPlatformAdmin = roles.includes("platform_admin") || roles.includes("super_admin");

  const { data: config, source } = await getTenantConfig();

  // GAP-PLATFORM-ADMIN-TENANT-CONFIG-05: compute days-left on the server, in
  // IST calendar days, so the client render has no Date.now() to mismatch
  // across hydration and the expiry day itself reads 0 (not a TZ-skewed ±1).
  const daysLeft = config?.licensedUntil ? daysUntilIST(config.licensedUntil) : null;

  // GAP-PLATFORM-ADMIN-TENANT-CONFIG-01: StatCards are derived from the real
  // config, not literals. "License" shows the real licence type or an honest
  // dash; the DB-schema / SSO cards only read "Isolated"/"Keycloak" for a
  // platform admin who can actually see those values.
  const statusLabel = config?.status ? humanizeStatus(config.status) : "—";
  const licenseLabel = config?.licenseType ?? "—";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "Tenant Config" }]} />
      <PageHeader
        back="/platform-admin"
        title="Tenant Configuration"
        subtitle="Tenant identity, infrastructure, storage quota, and license details."
      />

      {source === "error" ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "tenant configuration" })}
          backHref="/platform-admin"
          source={{ area: "tenant configuration", status: 500 }}
        />
      ) : !config ? (
        <EmptyState
          title="No configuration available"
          message="There is no configuration on record for your office yet."
        />
      ) : (
        <>
          <div className="grid g-4" style={{ marginBottom: 18 }}>
            <StatCard icon="🏢" iconBg="#eff6ff" label="Tenant" value={statusLabel} />
            {isPlatformAdmin && config.dbSchema && (
              <StatCard icon="🗄️" iconBg="#ecfdf3" label="DB schema" value="Isolated" />
            )}
            {isPlatformAdmin && config.keycloakRealm && (
              <StatCard icon="🔐" iconBg="#f1f5f9" label="SSO realm" value="Keycloak" />
            )}
            <StatCard icon="📄" iconBg="#fffaeb" label="License" value={licenseLabel} />
          </div>
          {/* GAP-PLATFORM-ADMIN-TENANT-CONFIG-03: the old banner told non-admins
              to "contact a platform admin to modify" settings that have no edit
              path for anyone. Decision (safest default, recorded): tenant
              configuration is read-only in this screen for every audience, so
              the honest copy below replaces the misleading one. */}
          <p style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 16 }}>
            Tenant configuration is managed by the platform operations team and is shown here for reference.
          </p>
          <TenantConfigCard config={config} daysLeft={daysLeft} isPlatformAdmin={isPlatformAdmin} />
        </>
      )}
    </div>
  );
}
