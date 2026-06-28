import { PageHeader, Card, DataTable, EmptyState } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Dept = { id: string; code: string; name: string; parentId: string | null } & Record<string, unknown>;

async function getDepartments(): Promise<Dept[]> {
  const r = await fetchJson<unknown, Dept[]>("/api/v1/hrms/departments", [], {
    telemetryKey: "config.departments",
    mapResponse: (p) => (p as { data: Dept[] })?.data ?? null,
  });
  return r.data;
}

export default async function DepartmentsPage() {
  const depts = await getDepartments();

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Departments"
        subtitle="The teams in your office — Finance, HR, Establishment and others. Add departments so people and work can be sorted correctly."
        back="/hr"
        backLabel="HR"
        help="hr"
      />

      <Card title={`Departments (${depts.length})`}>
        {depts.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="No departments yet"
            message="Create your first department so employees can be assigned to teams."
          />
        ) : (
          <DataTable<Dept>
            columns={[
              { key: "code", label: "Code" },
              { key: "name", label: "Department Name" },
            ]}
            rows={depts}
            sortable
            filterable
            filterPlaceholder="Search departments…"
            emptyIcon="🗂️"
            emptyTitle="No match"
            emptyMessage="Try a different search."
          />
        )}
      </Card>

      <p style={{ marginTop: 16, color: "var(--mut)", fontSize: 13 }}>
        Add departments via <code>POST /v1/hrms/departments</code> with <code>code</code> and <code>name</code>. A full form is being built.
      </p>
    </main>
  );
}
