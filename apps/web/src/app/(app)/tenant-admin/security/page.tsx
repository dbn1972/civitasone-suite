import { PageHeader, StatCard, StatGrid, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Breadcrumb } from "../Breadcrumb";
import { getSecurityOverview } from "@/app/_data/loaders";
import { SecurityTable } from "./SecurityTable";

export default async function SecurityCenterPage() {
  const { data: overview, source } = await getSecurityOverview();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Security Center" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Security Center"
        subtitle="Overview of security posture — sessions, MFA adoption, device trust, and recent security events."
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🖥️" iconBg="#eff6ff" label="Active Sessions" value={overview.activeSessions} />
        <StatCard icon="🚫" iconBg="#fef3f2" label="Failed Logins (24h)" value={overview.failedLogins24h} />
        <StatCard icon="🔐" iconBg="#ecfdf3" label="MFA Adoption" value={`${overview.mfaAdoptionRate}%`} />
        <StatCard icon="📱" iconBg="#f1f5f9" label="Trusted Devices" value={overview.trustedDevices} />
      </StatGrid>

      {overview.events.length === 0 ? (
        <Card title="Recent Security Events" link={<a href="/tenant-admin/audit" className="lnk">View full audit log →</a>}>
          <EmptyState icon="🛡️" title="No recent security events" message="Security events will appear here when detected." />
        </Card>
      ) : (
        <Card title="Recent Security Events" link={<a href="/tenant-admin/audit" className="lnk">View full audit log →</a>}>
          <SecurityTable events={overview.events} source={source} />
        </Card>
      )}
    </main>
  );
}
