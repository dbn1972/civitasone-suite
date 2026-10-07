import { requireAnyRole, PLATFORM_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { PageHeader, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { getAdminSettings } from "@/app/_data/loaders";
import { toHumanError } from "@/lib/messages";
import { Breadcrumb } from "../Breadcrumb";
import { SystemSettingsPage } from "./SystemSettingsPage";

// GAP-PLATFORM-ADMIN-SYSTEM-SETTINGS-01/02/03/04/05: this route now loads the
// REAL tenant settings (GET /v1/admin/settings — admin-service tenant-settings
// module, tenant_admin-gated, secrets write-only) and derives its stat tiles
// from them, instead of hardcoding "MFA on" / "3 connected" / "smtp.nic.in" and
// seeding the form from DEFAULT_* constants. The whole /platform-admin segment
// is role-gated by platform-admin/layout.tsx (SYSTEM-SETTINGS-03).
export default async function SystemSettingsRoute() {
  requireAnyRole(PLATFORM_ADMIN_ROLES, "/dashboard");
  const { data: settings, source } = await getAdminSettings();

  if (source === "error" || !settings) {
    return (
      <div className="page-main wrap">
        <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "System Settings" }]} />
        <PageHeader back="/platform-admin" title="System Settings" subtitle="General, Email, Security, and Integration configuration for the platform." />
        <RefreshErrorState error={toHumanError("load", { area: "system settings" })} backHref="/platform-admin" />
      </div>
    );
  }

  const sv = (section: Record<string, unknown>, key: string): unknown => section[key];
  const general = settings.general.values;
  const email = settings.email.values;
  const security = settings.security.values;
  const integrations = settings.integrations.values;

  // Derived, honest tiles.
  const generalConfigured = settings.general.configured ? (sv(general, "orgName") as string) || "Configured" : "Not configured";
  const smtpHost = settings.email.configured ? ((sv(email, "smtpHost") as string) || "Not configured") : "Not configured";
  const mfaValue = settings.security.configured
    ? (sv(security, "mfaRequired") === true ? "Required" : "Optional")
    : "Not configured";
  const integrationsConnected = [
    (sv(integrations, "pfmsUrl") as string) ? 1 : 0,
    (sv(integrations, "nicGatewayUrl") as string) ? 1 : 0,
    sv(integrations, "digiLockerEnabled") === true ? 1 : 0,
    sv(integrations, "umangEnabled") === true ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "System Settings" }]} />
      <PageHeader
        back="/platform-admin"
        title="System Settings"
        subtitle="General, Email, Security, and Integration configuration for the platform."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🏢" iconBg="#eff6ff" label="General" value={generalConfigured} />
        <StatCard icon="📧" iconBg="#ecfdf3" label="Email (SMTP)" value={smtpHost} />
        <StatCard icon="🛡️" iconBg="#fef3f2" label="MFA" value={mfaValue} />
        <StatCard icon="🔗" iconBg="#fffaeb" label="Integrations connected" value={settings.integrations.configured ? integrationsConnected : null} />
      </div>
      <SystemSettingsPage initial={settings} />
    </div>
  );
}
