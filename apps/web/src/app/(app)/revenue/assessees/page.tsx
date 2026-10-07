import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
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
  // GAP-REVENUE-ASSESSEES-01: a failed fetch defaults `assessees` to [], which
  // would otherwise render a false "0 registered assessees". Treat an error
  // source as "unknown", not "zero".
  const isError = source === "error";

  const activeCount = assessees.filter((a) => a.isActive).length;
  const propertyCount = assessees.filter((a) => a.assesseeType === "property").length;
  const waterCount = assessees.filter((a) => a.assesseeType === "water_connection").length;
  // GAP-REVENUE-ASSESSEES-02: the create form offers Trade and Other too; count
  // them so Property + Water + Other reconciles to Registered.
  const otherCount = assessees.filter(
    (a) => a.assesseeType !== "property" && a.assesseeType !== "water_connection",
  ).length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Assessee Register"
        subtitle="Property and water-connection taxpayers registered for municipal revenue collection."
        back="/revenue"
        actions={isError ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="🧾" iconBg="#eff6ff" label="Registered Assessees" value={isError ? null : assessees.length} />
        <StatCard icon="🏠" iconBg="#fffaeb" label="Property Assessees" value={isError ? null : propertyCount} />
        <StatCard icon="🚰" iconBg="#eef2ff" label="Water-Connection Assessees" value={isError ? null : waterCount} />
        <StatCard icon="🏪" iconBg="#f3e8ff" label="Trade & Other" value={isError ? null : otherCount} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={isError ? null : activeCount} />
      </StatGrid>

      <AssesseeCreateForm />

      <Card title="Assessees">
        {isError ? (
          <RefreshErrorState error={toHumanError("load", { area: "assessees" })} backHref="/revenue" />
        ) : (
          <AssesseesTable assessees={assessees} />
        )}
      </Card>
    </div>
  );
}
