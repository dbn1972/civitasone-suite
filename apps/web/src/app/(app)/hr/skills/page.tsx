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
  return fetchJson<unknown, Row[]>("/api/v1/hrms/skills", [], {
    telemetryKey: "hr.skills",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function SkillsPage() {
  const { data: items, source } = await getData();

  const expert = items.filter((i) => ["expert", "advanced"].includes((i.proficiency ?? "").toLowerCase())).length;
  const beginner = items.filter((i) => ["beginner", "basic"].includes((i.proficiency ?? "").toLowerCase())).length;
  const employees = new Set(items.map((i) => i.employee)).size;

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
      <PageHeader
        title="Skill Matrix"
        subtitle="Employee competency mapping, proficiency levels, and skill gap identification."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#e6f0ff" label="Skill Records" value={items.length} />
        <StatCard icon="👤" iconBg="#f5f5f5" label="Employees Mapped" value={employees} />
        <StatCard icon="⭐" iconBg="#fffbe6" label="Expert / Advanced" value={expert} />
        <StatCard icon="📚" iconBg="#fff1f0" label="Beginner / Basic" value={beginner} />
      </StatGrid>
      <Card title="Employee Competency Assessments">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee, skill or category…"
          pageSize={15}
          emptyIcon="🎯"
          emptyTitle="No skill assessments recorded"
          emptyMessage="Employee skills and proficiency levels appear here after formal assessments. Skills are added during onboarding and updated periodically after training completions."
        />
      </Card>
    </main>
  );
}
