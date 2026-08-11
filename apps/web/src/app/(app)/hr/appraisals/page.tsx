import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { getAppraisals } from "../../../_data/loaders";
import type { AppraisalSummary } from "@civitasone/types";

export default async function AppraisalsPage() {
  const { data: appraisals, source } = await getAppraisals();

  const total = appraisals.length;
  const pending = appraisals.filter((a) => a.status === "pending").length;
  const inReview = appraisals.filter((a) => a.status === "in_review").length;
  const completed = appraisals.filter((a) => a.status === "completed").length;

  const columns: { key: keyof AppraisalSummary & string; label: string; align?: "left" | "right"; cellType?: "status" }[] = [
    { key: "employeeName", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "appraisalPeriod", label: "Period" },
    { key: "rating", label: "Rating", align: "right" },
    { key: "reviewerName", label: "Reviewer" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Appraisals"
        subtitle="Employee performance review cycle."
        actions={
          <Link href="/hr/appraisals/new" className="btn primary">+ New Appraisal</Link>
        }
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#f5f5f5" label="Total" value={total} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="🔍" iconBg="#e6f0ff" label="In Review" value={inReview} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Completed" value={completed} />
      </StatGrid>
      <Card title="Appraisal Records">
        <DataTable<AppraisalSummary>
          columns={columns}
          rows={appraisals}
          sortable
          filterable
          filterPlaceholder="Filter by employee, period or reviewer…"
          emptyIcon="📊"
          emptyTitle="No appraisals yet"
          emptyMessage="Use '+ New Appraisal' to start a performance review cycle. Each appraisal records ratings, reviewer comments, and links to the employee's goals and KRAs."
          pageSize={15}
        />
      </Card>
    </main>
  );
}
