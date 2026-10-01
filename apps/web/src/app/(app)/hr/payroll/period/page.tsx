import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getPayrollRunDetails } from "@/app/_data/loaders";
import type { PayrollRunDetail } from "@civitasone/types";
import { toHumanError } from "@/lib/messages";
import { payrollRunStatusLabel } from "@/lib/payroll/statusLabels";
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
//
// GAP-PAYROLL-PERIOD-01: kept as a distinct route rather than redirected to
// /hr/payroll/runs -- several dashboard CTAs already funnel here (see the
// history above) and this file cannot audit every one of them to confirm a
// redirect would not silently break a link; row-linking and status/date
// formatting are now brought in line with the sibling routes instead
// (PERIOD-02/03/04/05 below), which is the lower-risk half of the catalog's
// two offered options. Whether this route should eventually be redirected
// or merged with /hr/payroll/runs remains a product decision.

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
  // GAP-PAYROLL-PERIOD-05: reuses payrollRunsTable's existing status.*
  // translations (via DataTable's statusLabels column option) instead of a
  // third, independently drifting status rendering -- Home, Runs and
  // Period now show the identical translated text for the same run.
  const tStatus = await getTranslations("payrollRunsTable");
  const { data: runs, source } = await getPayrollRunDetails();
  const errored = source === "error";
  const items = runs.map(toRow);
  const statusLabels = Object.fromEntries(
    Array.from(new Set(items.map((i) => i.status))).map((s) => [s, payrollRunStatusLabel(s, tStatus)]),
  );

  // GAP-PAYROLL-PERIOD-02: this used to sum employeesProcessed across EVERY
  // run (the same employees counted again each month) and split Completed/
  // Processing on a status pair that silently dropped the wire's real
  // "completed" (approved, awaiting disbursement -- see HOME-04) and
  // "failed" values from both buckets, so the two tiles never summed to the
  // total run count. "Completed" here now means actually paid; "Processing"
  // means everything else (draft/processing/completed-awaiting-disbursement/
  // failed), so the two always sum to the total.
  const paidCount = errored ? 0 : items.filter((i) => i.status === "paid").length;
  const notYetPaidCount = errored ? 0 : items.length - paidCount;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "rupees" | "date"; align?: "left" | "right"; statusLabels?: Record<string, string> }[] = [
    { key: "month", label: t("colMonth") },
    // GAP-PAYROLL-PERIOD-03: this used to print the raw API date string
    // (e.g. "2026-08-31T00:00:00Z") with no formatting at all, unlike the
    // run detail page's formatIndianDate.
    { key: "runDate", label: t("colRunDate"), cellType: "date" },
    { key: "employeesProcessed", label: t("colEmployees"), align: "right" },
    // GAP-PAYROLL-PERIOD-04: these three used to be pre-formatted into
    // separate *Display string fields and rendered as plain text, because
    // the comment here believed DataTable had no server-safe rupee
    // cellType -- it already does (cellType:"rupees", used elsewhere in
    // this exact module), which also keeps the raw numeric value available
    // for sorting. grossAmount/netAmount/deductions are already rupees
    // (payroll-service divides the minor-unit total before returning them);
    // cellType:"rupees" (never "amount", which calls formatMoney and
    // expects minor units) is the correct, canonical path.
    { key: "grossPayout", label: t("colGross"), align: "right", cellType: "rupees" },
    { key: "netPayout", label: t("colNet"), align: "right", cellType: "rupees" },
    { key: "deductions", label: t("colDeductions"), align: "right", cellType: "rupees" },
    // GAP-PAYROLL-PERIOD-05: raw, untranslated enum before (cellType:
    // "status" had no label option) -- now carries the same translated
    // label Home/Runs show for the same status value.
    { key: "status", label: t("colStatus"), cellType: "status", statusLabels },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* GAP-PAYROLL-PERIOD-03: back now matches every sibling payroll
          route (was "/hr", alone among them). */}
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel="Payroll" />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statCompleted")} value={errored ? null : paidCount} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statProcessing")} value={errored ? null : notYetPaidCount} />
        <StatCard icon="👥" iconBg="var(--infobg)" label={t("statEmployees")} value={errored ? null : items.reduce((s, i) => s + (Number(i.employeesProcessed) || 0), 0).toLocaleString("en-IN")} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "payroll periods" })} backHref="/hr" />
          </div>
        ) : (
          // GAP-PAYROLL-PERIOD-01/03: rows now link to the run detail page,
          // same as Home/Runs, instead of being inert text.
          <DataTable<Row>
            columns={columns}
            rows={items}
            rowLinkKey="id"
            rowLinkPrefix="/hr/payroll/"
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="📅"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}
