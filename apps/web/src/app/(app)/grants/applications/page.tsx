import { PageHeader, Card, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { formatMoney } from "@/lib/formatters";
import { getGrantApplications } from "../_data";
import { ApplicationsTable } from "./ApplicationsTable";

export default async function GrantApplicationsPage() {
  const { data: applications, source } = await getGrantApplications();

  const active = applications.filter((a) => a.status === "active").length;
  const completed = applications.filter((a) => a.status === "completed").length;
  const totalSanctioned = applications.reduce((sum, a) => sum + a.totalAmount, 0);
  const totalDisbursed = applications.reduce((sum, a) => sum + a.disbursedAmount, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/grants">Grants</a>
      </nav>
      <PageHeader
        title="Grant Applications"
        subtitle="All applications across schemes with disbursement status."
        back="/grants"
        backLabel="Grants"
        actions={
          <button type="button" className="btn ghost" aria-label="Filter applications (coming soon)">
            Filter ▾
          </button>
        }
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Grant applications">
        <StatGrid>
          <StatCard icon="📄" iconBg="#f1f5f9" label="Total" value={applications.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Active" value={active} />
          <StatCard icon="🏁" iconBg="#e0f2fe" label="Completed" value={completed} />
          <StatCard
            icon="💰"
            iconBg="#fef9c3"
            label="Total Sanctioned"
            value={formatMoney(totalSanctioned)}
          />
        </StatGrid>
        <Card title="Applications">
          <ApplicationsTable applications={applications} source={source} />
        </Card>
      </main>
    </>
  );
}
