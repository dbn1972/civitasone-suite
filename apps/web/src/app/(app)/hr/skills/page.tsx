import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

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

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/skills/team-heatmap", [], {
    telemetryKey: "hr.skills",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function SkillsPage() {
  const items = await getData();

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
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…" pageSize={15} />
      </div>
    </main>
  );
}
