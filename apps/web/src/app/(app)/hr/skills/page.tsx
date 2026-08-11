import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  skill: string;
  category: string;
  proficiency: string;
  assessedBy: string;
  lastAssessed: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/skills", [], {
    telemetryKey: "hr.skills",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function SkillsPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "skill", label: "Skill" },
    { key: "category", label: "Category" },
    { key: "proficiency", label: "Proficiency" },
    { key: "assessedBy", label: "Assessed By" },
    { key: "lastAssessed", label: "Last Assessed" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Skill Matrix" subtitle="Employee skill mapping and proficiency assessment." back="/hr" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <Card title="Employee Skills">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or skill…"
          pageSize={15}
          emptyIcon="🎯"
          emptyTitle="No skills recorded"
          emptyMessage="Employee skills and proficiency levels appear here. Skills are added during onboarding and updated after training completions."
        />
      </Card>
    </main>
  );
}
