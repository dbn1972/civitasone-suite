import Link from "next/link";
import { PageHeader, DataTable, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getAssessments } from "../_data";

type Row = { id: string; title: string; passing: string; duration: string; attempts: number; status: string };

export default async function Page() {
  const { data: assessments, source } = await getAssessments();

  const rows: Row[] = assessments.map((a) => ({
    id: a.id, title: a.title, passing: `${a.passingScore}`,
    duration: `${a.durationMins} min`, attempts: a.maxAttempts, status: a.status,
  }));

  return (
    <>
      <PageHeader
        title="Assessments"
        subtitle="Published assessments you can attempt. Passing an assessment issues a certificate that updates your competency profile."
        back="/learning"
        actions={<Link className="btn ghost" href="/learning/assessments/verify">Verify a certificate</Link>}
      />
      <div className="card">
        <div className="card-h"><h3>Available assessments</h3></div>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "assessments" })} backHref="/learning" />
        ) : rows.length === 0 ? (
          <EmptyState icon="📝" title="No assessments available" message="Published assessments will appear here to attempt." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "title", label: "Assessment" },
              { key: "passing", label: "Passing score", align: "right" },
              { key: "duration", label: "Duration", align: "right" },
              { key: "attempts", label: "Max attempts", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter assessments…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
