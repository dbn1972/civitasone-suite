import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { getProjectDprs } from "@/app/_data/loaders";
import { DprTrackingTable } from "./DprTrackingTable";

export default async function DprTrackingPage() {
  const { data: rows, source } = await getProjectDprs();

  const total = rows.length;
  const approved = rows.filter((r) => r.status === "approved").length;
  const underReview = rows.filter((r) => r.status === "under review" || r.status === "submitted").length;
  const returned = rows.filter((r) => r.status === "rejected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="DPR Tracking" subtitle="Detailed Project Report submission, review and approval status." back="/projects" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📄" iconBg="#eff6ff" label="Total DPRs" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Approved" value={approved} />
        <StatCard icon="🔍" iconBg="#fffaeb" label="Under Review" value={underReview} />
        <StatCard icon="↩️" iconBg="#fef3f2" label="Returned" value={returned} />
      </StatGrid>
      <Card title="DPR Register">
        {rows.length === 0 ? (
          <EmptyState icon="📄" title="No DPRs" message="No Detailed Project Reports have been submitted yet." action={<a href="/projects/list" className="btn primary">View Projects</a>} />
        ) : (
          <DprTrackingTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
