import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getSecurityOverview } from "@/app/_data/loaders";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { SecurityTable } from "./SecurityTable";

export default async function SecurityCenterPage() {
  const result = await getSecurityOverview();
  const { data: overview, source } = result;
  const errored = useResource(result).status === "error";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Security Center" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Security Center"
        subtitle="Overview of security posture — sessions, MFA adoption, device trust, and recent security events."
      />
      {/* UX-012: the data-source badge now lives inside SecurityTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}

      <StatGrid>
        <StatCard icon="🖥️" iconBg="#eff6ff" label="Active Sessions" value={errored ? "—" : overview.activeSessions} />
        <StatCard icon="🚫" iconBg="#fef3f2" label="Failed Logins (24h)" value={errored ? "—" : overview.failedLogins24h} />
        <StatCard icon="🔐" iconBg="#ecfdf3" label="MFA Adoption" value={errored ? "—" : `${overview.mfaAdoptionRate}%`} />
        <StatCard icon="📱" iconBg="#f1f5f9" label="Trusted Devices" value={errored ? "—" : overview.trustedDevices} />
      </StatGrid>

      {errored ? (
        <Card title="Recent Security Events" link={<a href="/tenant-admin/audit" className="lnk">View full audit log →</a>}>
          <RefreshErrorState error={toHumanError("load", { area: "security events" })} backHref="/tenant-admin" />
        </Card>
      ) : overview.events.length === 0 ? (
        <Card title="Recent Security Events" link={<a href="/tenant-admin/audit" className="lnk">View full audit log →</a>}>
          <EmptyState icon="🛡️" title="No recent security events" message="Security events will appear here when detected." />
        </Card>
      ) : (
        <Card title="Recent Security Events" link={<a href="/tenant-admin/audit" className="lnk">View full audit log →</a>}>
          <SecurityTable events={overview.events} source={source} />
        </Card>
      )}
    </div>
  );
}
