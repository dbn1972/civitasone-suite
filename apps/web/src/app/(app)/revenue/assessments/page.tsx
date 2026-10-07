import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
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
  // GAP-REVENUE-ASSESSMENTS-04: a failed fetch defaults to [], which would show
  // a false "0" on every stat and an "empty" table. Treat error as unknown.
  const isError = source === "error";

  const activeCount = assessments.filter((a) => a.status === "active").length;
  const revisedCount = assessments.filter((a) => a.status === "revised").length;
  const closedCount = assessments.filter((a) => a.status === "closed").length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Assessments"
        subtitle="Raise, revise, and remit municipal tax assessments against registered assessees."
        back="/revenue"
        actions={isError ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="📊" iconBg="#eff6ff" label="Total Assessments" value={isError ? null : assessments.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={isError ? null : activeCount} />
        <StatCard icon="✏️" iconBg="#fffaeb" label="Revised" value={isError ? null : revisedCount} />
        <StatCard icon="🔒" iconBg="#eef2ff" label="Closed" value={isError ? null : closedCount} />
      </StatGrid>

      <AssessmentCreateForm />

      <Card title="Assessments">
        {isError ? (
          <RefreshErrorState error={toHumanError("load", { area: "assessments" })} backHref="/revenue" />
        ) : (
          <AssessmentsTable assessments={assessments} />
        )}
      </Card>
    </div>
  );
}
