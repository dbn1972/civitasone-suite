import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { getPayrollRunDetails, getPayrollStructures } from "../../../_data/loaders";
import { useResource } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatRupees } from "@/lib/formatters";
import { CreatePayrollRunForm } from "./CreatePayrollRunForm";
import { PayrollRunsTable } from "./PayrollRunsTable";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

const PAYROLL_ADMIN_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];

export default async function PayrollPage() {
  const t = await getTranslations("payroll");
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));

  const [runsResult, { data: structures }] = await Promise.all([
    getPayrollRunDetails(),
    getPayrollStructures(),
  ]);
  const { data: runs, source } = runsResult;
  const runsResource = useResource(runsResult);
  const errored = runsResource.status === "error";

  const totalRuns = errored ? null : runs.length;
  const totalEmployeesPaid = errored
    ? null
    : runs
        .filter((r) => r.status === "paid" || r.status === "completed")
        .reduce((sum, r) => sum + r.employeeCount, 0);
  const totalGross = errored
    ? null
    : runs
        .filter((r) => r.status === "paid" || r.status === "completed")
        .reduce((sum, r) => sum + r.grossAmount, 0);
  const pending = errored ? null : runs.filter((r) => r.status === "draft" || r.status === "processing").length;
  const existingPeriods = runs.map((r) => r.payPeriod);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle="Monthly salary processing and statutory run status."
        help="payroll"
      />
      {/* UX-002: the payroll-runs data-source badge now lives inside
          PayrollRunsTable, driven by the same useSeededResource call that
          produces the table's rows — not a second, independent read of
          `source` here that could disagree with the table's cache state. */}
      {canAdminister && !errored && (
        structures.length === 0 ? (
          <Card>
            <p style={{ color: "var(--ink2)", fontSize: 14, padding: "12px 20px" }}>
              No pay structures configured — create one first.{" "}
              <Link href="/hr/payroll/structures" style={{ color: "var(--primary-d)", textDecoration: "underline" }}>
                Go to pay structures →
              </Link>
            </p>
          </Card>
        ) : (
          <CreatePayrollRunForm structures={structures} existingPeriods={existingPeriods} />
        )
      )}
      <StatGrid>
        <StatCard icon="💰" iconBg="var(--goodbg)" label="Total Runs" value={totalRuns ?? "—"} />
        <StatCard icon="👥" iconBg="var(--infobg)" label="Employees Paid" value={totalEmployeesPaid === null ? "—" : totalEmployeesPaid.toLocaleString("en-IN")} />
        <StatCard icon="🏛" iconBg="var(--warnbg)" label="Total Gross" value={totalGross === null ? "—" : formatRupees(totalGross)} />
        <StatCard icon="📄" iconBg="var(--panel)" label="Pending" value={pending ?? "—"} />
      </StatGrid>
      <Card title="Payroll Runs">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "payroll runs" })} backHref="/hr" />
          </div>
        ) : (
          <PayrollRunsTable runs={runs} source={source} canAdminister={canAdminister} />
        )}
      </Card>
    </main>
  );
}
