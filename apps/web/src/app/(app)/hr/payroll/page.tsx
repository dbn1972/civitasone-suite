import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getPayrollRunDetails, getPayrollStructures } from "../../../_data/loaders";
import { formatRupees } from "@/lib/formatters";
import { CreatePayrollRunForm } from "./CreatePayrollRunForm";
import { PayrollRunsTable } from "./PayrollRunsTable";
import Link from "next/link";

export default async function PayrollPage() {
  const [{ data: runs, source }, { data: structures }] = await Promise.all([
    getPayrollRunDetails(),
    getPayrollStructures(),
  ]);

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
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Payroll Runs"
        subtitle="Monthly salary processing and statutory run status."
        help="payroll"
      />
      <DataSourceBadge source={source} />
      {structures.length === 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="pad">
            <p style={{ color: "var(--ink2)", fontSize: 14 }}>
              No pay structures configured — create one first.{" "}
              <Link href="/hr/payroll/structures" style={{ color: "var(--primary-d)" }}>
                Go to pay structures →
              </Link>
            </p>
          </div>
        </div>
      ) : (
        <CreatePayrollRunForm structures={structures} existingPeriods={existingPeriods} />
      )}
      <StatGrid>
        <StatCard icon="💰" iconBg="#e6f7f0" label="Total Runs" value={totalRuns} />
        <StatCard icon="👥" iconBg="#e6f0ff" label="Employees Paid" value={totalEmployeesPaid.toLocaleString("en-IN")} />
        <StatCard icon="🏛" iconBg="#fffbe6" label="Total Gross" value={formatRupees(totalGross)} />
        <StatCard icon="📄" iconBg="#f5f5f5" label="Pending" value={pending} />
      </StatGrid>
      <Card title="Payroll Runs">
        <PayrollRunsTable runs={runs} source={source} />
      </Card>
    </main>
  );
}
