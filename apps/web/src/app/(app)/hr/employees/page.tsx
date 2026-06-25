import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getEmployees } from "../../../_data/loaders";
import { EmployeesTable, type EmpRow } from "./EmployeesTable";

export default async function EmployeeDirectoryPage() {
  const { data: rawEmployees, source } = await getEmployees();
  const employees = rawEmployees as EmpRow[];

  const total = employees.length;
  // P1-5: canonical lowercase status contract (see hrms employee/status.ts).
  const SERVING = new Set(["probation", "confirmed", "deputation"]);
  const active = employees.filter((e) => SERVING.has(e.status)).length;
  const onLeave = employees.filter((e) => e.status === "on_leave").length;
  const others = total - active - onLeave;

  return (
    <>
      <PageHeader
        title="Employee Directory"
        subtitle="All staff, grades and posting locations."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f7f0" label="Total" value={total} />
        <StatCard icon="✅" iconBg="#e6f0ff" label="Active" value={active} />
        <StatCard icon="🌴" iconBg="#fffbe6" label="On Leave" value={onLeave} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Others" value={others} />
      </StatGrid>
      <Card title="All Employees">
        <EmployeesTable employees={employees} source={source} />
      </Card>
    </>
  );
}
