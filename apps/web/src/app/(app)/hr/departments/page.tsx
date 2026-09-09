import Link from "next/link";
import { PageHeader, Card, EmptyState, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { DepartmentsTable } from "./DepartmentsTable";

type Dept = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  employeeCount?: number;
} & Record<string, unknown>;

async function getDepartments(): Promise<LoaderResult<Dept[]>> {
  try {
    const r = await fetchJson<unknown, Dept[]>("/api/v1/hrms/departments", [], {
      telemetryKey: "config.departments",
      mapResponse: (p) => (p as { data: Dept[] })?.data ?? null,
    });
    return r;
  } catch {
    return { data: [], source: "error" as const };
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
  const result = await getDepartments();
  const { data: depts } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const rootDepts = errored ? null : depts.filter((d) => !d.parentId).length;
  const subDepts  = errored ? null : depts.filter((d) => !!d.parentId).length;
  const withCode  = errored ? null : depts.filter((d) => !!d.code).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
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

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" style={{ marginBottom: 12 }}>
        <ol
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            listStyle: "none",
            margin: 0,
            padding: 0,
            fontSize: 12,
            color: "var(--mut,#64748b)",
          }}
        >
          <li>
            <Link href="/" style={{ color: "var(--mut,#64748b)", textDecoration: "none" }}>
              Home
            </Link>
          </li>
          <li aria-hidden="true" style={{ fontSize: 10 }}>›</li>
          <li>
            <Link href="/hr" style={{ color: "var(--mut,#64748b)", textDecoration: "none" }}>
              HR
            </Link>
          </li>
          <li aria-hidden="true" style={{ fontSize: 10 }}>›</li>
          <li aria-current="page" style={{ fontWeight: 600, color: "var(--fg,#0f172a)" }}>
            Departments
          </li>
        </ol>
      </nav>

      <StatGrid>
        <StatCard icon="🗂️" iconBg="#e6f0ff" label="Total Departments" value={errored ? "—" : depts.length} />
        <StatCard icon="🌳" iconBg="#e6f7f0" label="Root Departments"  value={rootDepts ?? "—"} />
        <StatCard icon="🌿" iconBg="#fff7e6" label="Sub-Departments"   value={subDepts ?? "—"} />
        <StatCard icon="🏷️" iconBg="#f5f5f5" label="With Code"         value={withCode ?? "—"} />
      </StatGrid>

      <Card title={errored ? "Departments" : `Departments (${depts.length})`}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "departments" })} backHref="/hr" />
          </div>
        ) : depts.length === 0 ? (
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
