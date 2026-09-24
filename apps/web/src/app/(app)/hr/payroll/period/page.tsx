import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getPayrollRunDetails } from "@/app/_data/loaders";
import type { PayrollRunDetail } from "@civitasone/types";
import { formatRupees } from "@/lib/formatters";
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
  const items = runs.map(toRow);

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right"; render?: (r: Row) => string }[] = [
    { key: "month", label: t("colMonth") },
    { key: "runDate", label: t("colRunDate") },
    { key: "employeesProcessed", label: t("colEmployees"), align: "right" },
    { key: "grossPayout", label: t("colGross"), align: "right", render: (r) => formatRupees(r.grossPayout) },
    { key: "netPayout", label: t("colNet"), align: "right", render: (r) => formatRupees(r.netPayout) },
    { key: "deductions", label: t("colDeductions"), align: "right", render: (r) => formatRupees(r.deductions) },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} message="Couldn't load payroll periods — showing nothing" />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotal")} value={items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statCompleted")} value={items.filter((i) => i.status === "completed" || i.status === "paid").length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statProcessing")} value={items.filter((i) => i.status === "processing" || i.status === "draft").length} />
        <StatCard icon="👥" iconBg="var(--infobg)" label={t("statEmployees")} value={items.reduce((s, i) => s + (Number(i.employeesProcessed) || 0), 0).toLocaleString("en-IN")} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder={t("filterPlaceholder")} pageSize={15} emptyIcon="📅" emptyTitle={t("emptyTitle")} emptyMessage={t("emptyMessage")} />
      </Card>
    </main>
  );
}
