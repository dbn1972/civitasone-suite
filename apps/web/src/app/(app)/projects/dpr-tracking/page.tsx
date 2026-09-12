import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getProjectDprs } from "@/app/_data/loaders";
import { DprTrackingTable } from "./DprTrackingTable";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

export default async function DprTrackingPage() {
  const result = await getProjectDprs();
  const { data: rows, source } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const total = errored ? null : rows.length;
  const approved = errored ? null : rows.filter((r) => r.status === "approved").length;
  const underReview = errored ? null : rows.filter((r) => r.status === "under review" || r.status === "submitted").length;
  const returned = errored ? null : rows.filter((r) => r.status === "rejected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="DPR Tracking" subtitle="Detailed Project Report submission, review and approval status." back="/projects" />
      <StatGrid>
        <StatCard icon="📄" iconBg="#eff6ff" label="Total DPRs" value={total ?? "—"} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Approved" value={approved ?? "—"} />
        <StatCard icon="🔍" iconBg="#fffaeb" label="Under Review" value={underReview ?? "—"} />
        <StatCard icon="↩️" iconBg="#fef3f2" label="Returned" value={returned ?? "—"} />
      </StatGrid>
      <Card title="DPR Register">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "DPRs" })} backHref="/projects" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="📄" title="No DPRs" message="No Detailed Project Reports have been submitted yet." action={<a href="/projects/list" className="btn primary">View Projects</a>} />
        ) : (
          <DprTrackingTable rows={rows} source={source === "error" ? "error" : "api"} />
        )}
      </Card>
    </main>
  );
}
