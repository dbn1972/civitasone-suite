import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AssessmentsTable, type AssessmentRow } from "./AssessmentsTable";
import { AssessmentCreateForm } from "./AssessmentCreateForm";

async function getAssessments(): Promise<LoaderResult<AssessmentRow[]>> {
  return fetchJson<unknown, AssessmentRow[]>("/api/v1/revenue/assessments", [], {
    telemetryKey: "revenue.assessments.list",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: AssessmentRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function AssessmentsPage() {
  const { data: assessments, source } = await getAssessments();

  const activeCount = assessments.filter((a) => a.status === "active").length;
  const revisedCount = assessments.filter((a) => a.status === "revised").length;
  const closedCount = assessments.filter((a) => a.status === "closed").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Assessments"
        subtitle="Raise, revise, and remit municipal tax assessments against registered assessees."
        back="/revenue"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="📊" iconBg="#eff6ff" label="Total Assessments" value={assessments.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={activeCount} />
        <StatCard icon="✏️" iconBg="#fffaeb" label="Revised" value={revisedCount} />
        <StatCard icon="🔒" iconBg="#eef2ff" label="Closed" value={closedCount} />
      </StatGrid>

      <AssessmentCreateForm />

      <Card title="Assessments">
        {source === "error" && assessments.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <AssessmentsTable assessments={assessments} />
        )}
      </Card>
    </main>
  );
}
