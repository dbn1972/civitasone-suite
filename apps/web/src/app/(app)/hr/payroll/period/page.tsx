import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getPayrollRunDetails } from "@/app/_data/loaders";
import type { PayrollRunDetail } from "@civitasone/types";
import { formatRupees } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

// This page used to call GET /api/v1/finance/periods -- Finance's GL
// period-close endpoint, gated to finance_officer/finance_admin/super_admin
// and backed by open/soft_close/hard_close period rows, none of which carry
// this page's own Row shape (month/runDate/employeesProcessed/grossPayout/
// netPayout/deductions/status). That endpoint returns 200 with an empty/
// unrelated shape rather than erroring, so the mismatch was silent: every
// prominent "Start Run"/"Run Payroll" CTA across the HR dashboard funnelled
// here, to a page that could never show real payroll-run data even when the
// request "succeeded". Switched to the same getPayrollRunDetails() loader
// (GET /api/v1/payroll/runs) the working /hr/payroll root page already
// uses -- this Row shape (month/runDate/employeesProcessed/grossPayout/...)
// was always describing a payroll run, just fetched from the wrong service.


type Row = {
  id: string;
  month: string;
  runDate: string;
  employeesProcessed: number;
  grossPayout: number;
  netPayout: number;
  deductions: number;
  status: string;
};

type DisplayRow = Row & {
  grossPayoutDisplay: string;
  netPayoutDisplay: string;
  deductionsDisplay: string;
};

function toRow(run: PayrollRunDetail): Row {
  // IMPORTANT: PayrollRunDetail's grossAmount/netAmount/deductions are
  // already rupees (payroll-service divides the minor-unit total before
  // returning it) -- pre-format them as display strings here rather than
  // using DataTable's cellType:"amount", which calls formatMoney() and
  // expects minor units. Using cellType:"amount" on an already-rupee value
  // would silently divide it by 100 again (see the same warning in
  // hr/payroll/disbursement/page.tsx, which reads the exact same schema).
  return {
    id: run.id,
    month: run.payPeriod,
    runDate: run.runDate,
    employeesProcessed: run.employeeCount,
    grossPayout: run.grossAmount,
    netPayout: run.netAmount,
    deductions: run.deductions,
    status: run.status,
  };
}

export default async function PayrollPeriodPage() {
  const t = await getTranslations("payrollPeriod");
  const { data: runs, source } = await getPayrollRunDetails();
  const errored = source === "error";
  const items = runs.map(toRow);

  // Server-safe: DataTable's `render` prop cannot cross the server/client
  // boundary (this is an async Server Component), so pre-format the rupee
  // display strings into plain fields instead of using `render`.
  const displayItems: DisplayRow[] = items.map((r) => ({
    ...r,
    grossPayoutDisplay: formatRupees(r.grossPayout),
    netPayoutDisplay: formatRupees(r.netPayout),
    deductionsDisplay: formatRupees(r.deductions),
  }));

  const columns: { key: keyof DisplayRow & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "month", label: t("colMonth") },
    { key: "runDate", label: t("colRunDate") },
    { key: "employeesProcessed", label: t("colEmployees"), align: "right" },
    { key: "grossPayoutDisplay", label: t("colGross"), align: "right" },
    { key: "netPayoutDisplay", label: t("colNet"), align: "right" },
    { key: "deductionsDisplay", label: t("colDeductions"), align: "right" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statCompleted")} value={errored ? null : items.filter((i) => i.status === "completed" || i.status === "paid").length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statProcessing")} value={errored ? null : items.filter((i) => i.status === "processing" || i.status === "draft").length} />
        <StatCard icon="👥" iconBg="var(--infobg)" label={t("statEmployees")} value={errored ? null : items.reduce((s, i) => s + (Number(i.employeesProcessed) || 0), 0).toLocaleString("en-IN")} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "payroll periods" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<DisplayRow> columns={columns} rows={displayItems} sortable filterable filterPlaceholder={t("filterPlaceholder")} pageSize={15} emptyIcon="📅" emptyTitle={t("emptyTitle")} emptyMessage={t("emptyMessage")} />
        )}
      </Card>
    </div>
  );
}
