import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { getHRDashboard, getEmployees, getJobOpenings } from "../../../_data/loaders";

type EmpRow = { id: string; name: string; department: string; status: string } & Record<string, unknown>;

export default async function HRDashboardPage() {
  const [dashResult, empResult, jobResult] = await Promise.all([
    getHRDashboard(),
    getEmployees(),
    getJobOpenings(),
  ]);

  const { data, source } = dashResult;
  const employees = empResult.data as EmpRow[];
  const openRoles = jobResult.data.filter((j) => j.status === "open").length;
  const onLeaveCount = employees.filter(
    (e) => e.status === "on_leave"
  ).length;
  const anyError =
    source === "error" || empResult.source === "error" || jobResult.source === "error";

  const recentEmployees = employees.slice(0, 8);

  const columns: { key: keyof EmpRow & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: "Name" },
    { key: "department", label: "Department" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="HR Dashboard"
        subtitle="People operations overview."
      />
      {anyError && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f7f0" label="Headcount" value={data.headcount.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#e6f0ff" label="Present Today" value={`${data.attendanceTodayPct.toFixed(1)}%`} />
        <StatCard icon="🌴" iconBg="#fffbe6" label="On Leave" value={onLeaveCount} />
        <StatCard icon="🎯" iconBg="#fff0f0" label="Open Roles" value={openRoles} />
      </StatGrid>
      <Card
        title="Employees"
        link={<Link href="/hr/employees">View all →</Link>}
      >
        <DataTable<EmpRow>
          columns={columns}
          rows={recentEmployees}
          rowLinkPrefix="/hr/employees/"
          rowLinkKey="id"
        />
      </Card>
    </main>
  );
}
