import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
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
  return fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=200", [], {
    telemetryKey: "hr.employees_limit_200",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function DirectoryPage() {
  const { data: items, source } = await getData();

  const depts = new Set(items.map((i) => i.department).filter(Boolean)).size;
  const locations = new Set(items.map((i) => i.location).filter(Boolean)).size;

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
      <PageHeader
        title="Employee Directory"
        subtitle="Search employees by name, department, designation, extension, or location."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f0ff" label="Total Employees" value={items.length} />
        <StatCard icon="🏢" iconBg="#f5f5f5" label="Departments" value={depts} />
        <StatCard icon="📍" iconBg="#fffbe6" label="Locations" value={locations} />
      </StatGrid>
      <Card title="Directory">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Search by name, department, designation, extension or location…"
          pageSize={20}
          emptyIcon="👥"
          emptyTitle="No employees in directory"
          emptyMessage="The employee directory is empty. Employees appear here once their service records are activated."
        />
      </Card>
    </main>
  );
}
