import Link from "next/link";
import { PageHeader, DataTable, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { getAssessments } from "../_data";

type Row = { id: string; title: string; passing: string; duration: string; attempts: number; status: string };

// Mirrors services/hrms-service/src/modules/assessment/routes.ts HR_ROLES.
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function Page() {
  const { data: assessments, source } = await getAssessments();

  // GAP-LEARNING-ASSESSMENTS-02 (defence in depth): the backend already scopes
  // non-HR callers to published assessments; the page also filters here so a
  // learner view never lists draft/pending/retired even if the API changes.
  const roles = getSessionRoles();
  const isHr = roles.some((r: string) => HR_ROLES.includes(r));
  const visible = isHr ? assessments : assessments.filter((a) => a.status === "published");

  const rows: Row[] = visible.map((a) => ({
    id: a.id, title: a.title,
    // GAP-LEARNING-ASSESSMENTS-04: passingScore is a raw marks total (0..100000
    // in the backend validator), NOT a percentage — labelling it "%" would be
    // wrong. Show it as a marks figure. (Decision recorded in the GAP report.)
    passing: `${a.passingScore} marks`,
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
            rowLinkKey="id"
            rowLinkPrefix="/learning/assessments/"
            identifyingColumnKey="title"
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
