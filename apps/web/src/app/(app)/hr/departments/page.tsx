import Link from "next/link";
import { PageHeader, Card, EmptyState } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { DepartmentsTable } from "./DepartmentsTable";

type Dept = { id: string; code: string; name: string; parentId: string | null } & Record<string, unknown>;

async function getDepartments(): Promise<Dept[]> {
  try {
    const r = await fetchJson<unknown, Dept[]>("/api/v1/hrms/departments", [], {
      telemetryKey: "config.departments",
      mapResponse: (p) => (p as { data: Dept[] })?.data ?? null,
    });
    return r.data ?? [];
  } catch {
    return [];
  }
}

const newBtnStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "0 16px",
  display: "flex",
  alignItems: "center",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 14,
  background: "var(--primary)",
  color: "#fff",
  textDecoration: "none",
};

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
        actions={
          <Link href="/hr/departments/new" style={newBtnStyle}>
            + New Department
          </Link>
        }
      />

      <Card title={`Departments (${depts.length})`}>
        {depts.length === 0 ? (
          <EmptyState
            icon="🗂️"
            title="No departments yet"
            message="Create your first department so employees can be assigned to teams."
          />
        ) : (
          <DepartmentsTable depts={depts} />
        )}
      </Card>
    </main>
  );
}
