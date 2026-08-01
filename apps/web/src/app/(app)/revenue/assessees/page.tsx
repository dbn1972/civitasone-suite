import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AssesseesTable, type AssesseeRow } from "./AssesseesTable";
import { AssesseeCreateForm } from "./AssesseeCreateForm";

async function getAssessees(): Promise<LoaderResult<AssesseeRow[]>> {
  return fetchJson<unknown, AssesseeRow[]>("/api/v1/revenue/assessees", [], {
    telemetryKey: "revenue.assessees.list",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: AssesseeRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function AssesseesPage() {
  const { data: assessees, source } = await getAssessees();

  const activeCount = assessees.filter((a) => a.isActive).length;
  const propertyCount = assessees.filter((a) => a.assesseeType === "property").length;
  const waterCount = assessees.filter((a) => a.assesseeType === "water_connection").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Assessee Register"
        subtitle="Property and water-connection taxpayers registered for municipal revenue collection."
        back="/revenue"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="🧾" iconBg="#eff6ff" label="Registered Assessees" value={assessees.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={activeCount} />
        <StatCard icon="🏠" iconBg="#fffaeb" label="Property Assessees" value={propertyCount} />
        <StatCard icon="🚰" iconBg="#eef2ff" label="Water-Connection Assessees" value={waterCount} />
      </StatGrid>

      <AssesseeCreateForm />

      <Card title="Assessees">
        {source === "error" && assessees.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <AssesseesTable assessees={assessees} />
        )}
      </Card>
    </main>
  );
}
