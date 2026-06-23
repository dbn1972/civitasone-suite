import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getGrantees } from "../../../_data/loaders";
import { GranteesTable } from "./GranteesTable";

export default async function GranteesPage() {
  const { data: grantees, source } = await getGrantees();

  const ngos = grantees.filter((g) => g.type === "ngo").length;
  const totalActiveGrants = grantees.reduce((s, g) => s + g.activeGrants, 0);
  const avgCompliance =
    grantees.length > 0
      ? grantees.reduce((s, g) => s + g.ucCompliancePct, 0) / grantees.length
      : 0;

  return (
    <>
      <PageHeader title="Grantees" subtitle="Registered grantee organisations and compliance status." />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="👤" iconBg="#f1f5f9" label="Total" value={grantees.length} />
        <StatCard icon="🏢" iconBg="#faf5ff" label="NGOs" value={ngos} />
        <StatCard icon="🎁" iconBg="#dcfce7" label="Active Grants" value={totalActiveGrants} />
        <StatCard icon="📋" iconBg="#fef3c7" label="UC Compliance" value={`${avgCompliance.toFixed(1)}%`} />
      </StatGrid>
      <Card title="Grantees">
        <GranteesTable grantees={grantees} source={source} />
      </Card>
    </>
  );
}
