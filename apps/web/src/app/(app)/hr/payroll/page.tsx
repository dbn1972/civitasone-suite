import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getPayrollRunDetails } from "../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { CreatePayrollRunForm } from "./CreatePayrollRunForm";
import { PayrollRunsTable } from "./PayrollRunsTable";

const STRUCTURES = [
  { id: "ffffffff-0001-0000-0000-000000000001", name: "7th CPC L14" },
  { id: "ffffffff-0001-0000-0000-000000000002", name: "7th CPC L9" },
];

export default async function PayrollPage() {
  const { data: runs, source } = await getPayrollRunDetails();

  const totalRuns = runs.length;
  const totalEmployeesPaid = runs
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + r.employeeCount, 0);
  const totalGross = runs
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + r.grossAmount, 0);
  const pending = runs.filter((r) => r.status === "draft" || r.status === "processing").length;
  const existingPeriods = runs.map((r) => r.payPeriod);

  return (
    <>
      <PageHeader
        title="Payroll Runs"
        subtitle="Monthly salary processing and statutory run status."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <CreatePayrollRunForm structures={STRUCTURES} existingPeriods={existingPeriods} />
      <StatGrid>
        <StatCard icon="💰" iconBg="#e6f7f0" label="Total Runs" value={totalRuns} />
        <StatCard icon="👥" iconBg="#e6f0ff" label="Employees Paid" value={totalEmployeesPaid.toLocaleString("en-IN")} />
        <StatCard icon="🏛" iconBg="#fffbe6" label="Total Gross" value={formatMoney(totalGross)} />
        <StatCard icon="📄" iconBg="#f5f5f5" label="Pending" value={pending} />
      </StatGrid>
      <Card title="Payroll Runs">
        <PayrollRunsTable runs={runs} source={source} />
      </Card>
    </>
  );
}
