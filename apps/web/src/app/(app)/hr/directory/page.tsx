import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type Row = {
  id: string;
  name: string;
  department: string;
  designation: string;
  grade: string;
  extension: string;
  email: string;
  location: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=200", [], {
    telemetryKey: "hr.employees_limit_200",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function DirectoryPage() {
  const { data: items, source } = await getData();

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "department", label: "Department" },
    { key: "designation", label: "Designation" },
    { key: "grade", label: "Grade" },
    { key: "extension", label: "Ext." },
    { key: "email", label: "Email" },
    { key: "location", label: "Location" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Employee Directory" subtitle="Search employees by name, department, designation, or extension." back="/hr" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…"
          pageSize={15}
          emptyIcon="📋"
          emptyTitle="No employees in directory"
          emptyMessage="The employee directory is empty. Employees appear here once onboarded and their records are activated."
        />
      </div>
    </main>
  );
}
