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

  // Actionable insights — surface what needs attention today
  const pendingLeaves = data.pendingLeaves ?? 0;
  const payrollDue = data.payrollDue ?? 0;
  const actionItems: { label: string; href: string; urgency: "high" | "medium" | "low" }[] = [];
  if (pendingLeaves > 0) actionItems.push({ label: `${pendingLeaves} leave request${pendingLeaves > 1 ? "s" : ""} pending approval`, href: "/hr/leave/approvals", urgency: "high" });
  if (payrollDue > 0) actionItems.push({ label: "Payroll run due for this month", href: "/hr/payroll", urgency: "high" });
  if (openRoles > 0) actionItems.push({ label: `${openRoles} open role${openRoles > 1 ? "s" : ""} awaiting candidates`, href: "/hr/recruitment", urgency: "medium" });

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="HR Dashboard"
        subtitle="People operations overview."
        help="hr"
      />
      {anyError && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f7f0" label="Headcount" value={data.headcount.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#e6f0ff" label="Present Today" value={`${data.attendanceTodayPct.toFixed(1)}%`} />
        <StatCard icon="🌴" iconBg="#fffbe6" label="On Leave" value={onLeaveCount} />
        <StatCard icon="🎯" iconBg="#fff0f0" label="Open Roles" value={openRoles} />
      </StatGrid>

      {/* Actionable guidance — tells the user what needs attention */}
      {actionItems.length > 0 && (
        <Card title="Needs your attention" padding>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {actionItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: item.urgency === "high" ? "var(--error-bg, #fef2f2)" : "var(--warn-bg, #fffbeb)",
                    border: `1px solid ${item.urgency === "high" ? "var(--error-border, #fecaca)" : "var(--warn-border, #fde68a)"}`,
                    textDecoration: "none",
                    color: "inherit",
                    fontSize: 13,
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 16 }}>
                    {item.urgency === "high" ? "🔴" : "🟡"}
                  </span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  <span style={{ color: "var(--primary-d)", fontWeight: 500 }}>Review →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Employees"
        link={<Link href="/hr/employees">View all →</Link>}
      >
        <DataTable<EmpRow>
          columns={columns}
          rows={recentEmployees}
          rowLinkPrefix="/hr/employees/"
          rowLinkKey="id"
          sortable
          filterable
          emptyIcon="👥"
          emptyTitle="No employees"
          emptyMessage="No employee records found."
        />
      </Card>
    </main>
  );
}
