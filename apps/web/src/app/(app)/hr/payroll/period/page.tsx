import { PageHeader, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getPayrollRunDetails } from "@/app/_data/loaders";
import type { PayrollRunDetail } from "@civitasone/types";
import { toHumanError } from "@/lib/messages";
import type { PillVariant } from "@/app/_components/ds/StatusPill";
import {
  bucketPayrollRuns,
  latestPayrollRun,
  payrollRunStatusLabel,
  payrollRunStatusVariant,
} from "@/lib/payroll/statusLabels";
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
//
// GAP-PAYROLL-PERIOD-01 (W2 payroll rescan): the page title, card title,
// empty-state copy and the HR dashboard tile all promised period management
// ("Payroll Periods", "Period closing and control") that this read-only run
// history does not offer -- there is no payroll period open/close/lock
// endpoint. They now say what the page is: payroll runs listed by pay period.
// (en/hi: payrollPeriod.* and hr.payrollPeriod*.) Whether the route should
// still be redirected or merged into /hr/payroll/runs stays the owner's call.

// GAP-PAYROLL-HOME-01: run money is the API's integer-paise strings
// (grossMinor / netMinor / deductionsMinor), rendered by DataTable's
// cellType "amount" (formatMoney) -- the legacy rupee floats on the wire are
// not read here. A payload without the string shows "—" (unknown), never a
// made-up zero. DataTable sorts these strings numerically.
type Row = {
  id: string;
  month: string;
  runDate: string;
  employeesProcessed: number;
  grossMinor?: string;
  netMinor?: string;
  deductionsMinor?: string;
  status: string;
};

type PeriodColumn = {
  key: keyof Row & string;
  label: string;
  cellType?: "status" | "amount" | "date";
  align?: "left" | "right";
  statusLabels?: Record<string, string>;
  statusVariants?: Record<string, PillVariant>;
};

function toRow(run: PayrollRunDetail): Row {
  return {
    id: run.id,
    month: run.payPeriod,
    runDate: run.runDate,
    employeesProcessed: run.employeeCount,
    grossMinor: run.grossMinor,
    netMinor: run.netMinor,
    deductionsMinor: run.deductionsMinor,
    status: run.status,
  };
}

export default async function PayrollPeriodPage() {
  const t = await getTranslations("payrollPeriod");
  const tCommon = await getTranslations("payrollCommon");
  // GAP-PAYROLL-PERIOD-05: reuses payrollRunsTable's existing status.*
  // translations AND payrollRunStatusVariant (via DataTable's statusLabels /
  // statusVariants column options) instead of a third, independently drifting
  // status rendering -- Home, Runs and Period now show the identical
  // translated text AND tone for the same run. Without the variant a
  // "completed" (approved, awaiting disbursement) run was green here (the
  // global STATUS_MAP) but info-blue on Home/Runs.
  const tStatus = await getTranslations("payrollRunsTable");
  const { data: runs, source } = await getPayrollRunDetails();
  const errored = source === "error";
  const items = runs.map(toRow);
  const statuses = Array.from(new Set(items.map((i) => i.status)));
  const statusLabels = Object.fromEntries(statuses.map((s) => [s, payrollRunStatusLabel(s, tStatus)]));
  const statusVariants: Record<string, PillVariant> = {};
  for (const s of statuses) {
    const variant = payrollRunStatusVariant(s);
    if (variant) statusVariants[s] = variant;
  }

  // GAP-PAYROLL-PERIOD-02: the tiles used to sum employeesProcessed across
  // EVERY run (the same employees counted again each month) and split
  // Completed/Processing on a status pair that dropped the wire's real
  // "completed" (approved, awaiting disbursement -- see HOME-04) and
  // "failed" values, so the tiles never summed to the run count. The shared
  // bucketPayrollRuns() helper (also used by Payroll home) now splits every
  // run into paid / in progress / failed -- three disjoint buckets that always
  // sum to Total -- and the headcount is the LATEST run's, not a cross-month sum.
  const buckets = errored ? null : bucketPayrollRuns(runs);
  const latestRun = errored ? null : latestPayrollRun(runs);

  const columns: PeriodColumn[] = [
    { key: "month", label: t("colMonth") },
    // GAP-PAYROLL-PERIOD-03: this used to print the raw API date string
    // (e.g. "2026-08-31T00:00:00Z") with no formatting at all, unlike the
    // run detail page's formatIndianDate.
    { key: "runDate", label: t("colRunDate"), cellType: "date" },
    { key: "employeesProcessed", label: t("colEmployees"), align: "right" },
    // GAP-PAYROLL-PERIOD-04: these three used to be pre-formatted into
    // separate *Display string fields and rendered as plain text. They are
    // now server-safe cellType "amount" columns (which also keeps the raw
    // value available for sorting). GAP-PAYROLL-HOME-01: the values are the
    // API's integer-paise strings (grossMinor / netMinor / deductionsMinor),
    // which "amount" renders with formatMoney -- not the rupee floats.
    { key: "grossMinor", label: t("colGross"), align: "right", cellType: "amount" },
    { key: "netMinor", label: t("colNet"), align: "right", cellType: "amount" },
    { key: "deductionsMinor", label: t("colDeductions"), align: "right", cellType: "amount" },
    // GAP-PAYROLL-PERIOD-05: raw, untranslated enum before (cellType:
    // "status" had no label option) -- now carries the same translated
    // label and tone Home/Runs show for the same status value.
    { key: "status", label: t("colStatus"), cellType: "status", statusLabels, statusVariants },
  ];

  return (
    <div className="page-main wrap">
      {/* GAP-PAYROLL-PERIOD-03: back now matches every sibling payroll
          route (was "/hr", alone among them). */}
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel={tCommon("backToPayroll")} />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      {/* Five tiles: the shared 4-column StatGrid would orphan the fifth on its own row. */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotal")} value={buckets ? buckets.total : null} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statPaid")} value={buckets ? buckets.paid : null} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statInProgress")} value={buckets ? buckets.inProgress : null} />
        <StatCard icon="⚠️" tone="bad" label={t("statFailed")} value={buckets ? buckets.failed : null} />
        <StatCard icon="👥" iconBg="var(--infobg)" label={t("statEmployeesLatest")} value={latestRun ? latestRun.employeeCount.toLocaleString("en-IN") : null} />
      </div>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "payroll periods" })} backHref="/hr" />
          </div>
        ) : (
          // GAP-PAYROLL-PERIOD-01/03: rows link to the run detail page,
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
