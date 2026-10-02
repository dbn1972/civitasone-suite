import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getSessionRoles, PAYROLL_REPORT_ROLES } from "@/lib/auth/roleGuard";
import { summarizeArrears } from "./arrearsSummary";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { resolveEmployeeNames, employeeDisplayLabel } from "@/app/_data/employeeNames";
import { formatMoney, formatPeriod } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

// Wire shape from GET /v1/payroll/arrears (payroll-service, world-class-routes.ts ->
// repo.listArrears -> `SELECT * FROM payroll.payroll_arrears`). These are the literal
// DB columns (migrations/0035_world_class_payroll.sql + 0011 `source` column) — there
// is no `employee`/`department`/`arrearType`/`period`/`amount`/`payableMonth` field on
// the wire. This type documents what the API actually sends so the mapper below can't
// silently drift from it again.
type ArrearApiRow = {
  id: string;
  employee_id: string;
  run_id: string | null;
  component_code: string;
  from_period: string;
  to_period: string;
  old_amount_minor: number | string;
  new_amount_minor: number | string;
  difference_minor: number | string;
  reason: string | null;
  status: string;
  source: string;
  created_at: string;
} & Record<string, unknown>;

type Row = {
  id: string;
  employee_id: string;
  component_code: string;
  from_period: string;
  to_period: string;
  difference_minor: number | string;
  reason: string;
  status: string;
} & Record<string, unknown>;

type DisplayRow = Row & {
  employee_label: string;
  component_label: string;
  from_period_display: string;
  to_period_display: string;
};

/**
 * Translate the raw payroll_arrears columns into what the table needs. Kept as an
 * explicit function (rather than typing the table straight off the wire row) so the
 * two shapes can't drift apart unnoticed the way they previously did: the table used
 * to ask for `employee`/`department`/`arrearType`/`period`/`amount`/`payableMonth`,
 * none of which the API has ever sent, so every real row rendered blank.
 *
 * `difference_minor` (new - old, in paise) is the amount actually owed; it is kept in
 * minor units for the table's `cellType: "amount"` (formatMoney) rendering — never
 * convert to a float rupee value before display.
 */
function mapArrearRow(r: ArrearApiRow): Row {
  return {
    ...r,
    id: r.id,
    employee_id: r.employee_id,
    component_code: r.component_code,
    from_period: r.from_period,
    to_period: r.to_period,
    difference_minor: r.difference_minor ?? 0,
    reason: r.reason ?? "—",
    status: r.status,
  };
}

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/payroll/arrears", [], {
    telemetryKey: "payroll.arrears",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ArrearApiRow[] })?.data;
      return Array.isArray(arr) ? arr.map(mapArrearRow) : null;
    },
  });
  return r;
}

// GAP-PAYROLL-ARREARS-01: component codes the payroll engine itself emits
// (consumer.ts collectAdHocEarnings / salary components) get a readable
// label; any other code is shown as-is rather than guessed at.
const COMPONENT_LABEL_KEYS: Record<string, string> = {
  BASIC: "componentBasic",
  DA: "componentDa",
  HRA: "componentHra",
  TA: "componentTa",
  ARREAR: "componentArrear",
  ARREAR_RECOVERY: "componentArrearRecovery",
};

export default async function ArrearsPage() {
  const t = await getTranslations("arrears");
  // GAP-PAYROLL-ARREARS-04: hr/layout.tsx admits employee/manager, but the
  // tenant-wide arrears register (salary differences, DPDP-sensitive) is
  // payroll-service ROLES-only (PAYROLL_REPORT_ROLES mirrors it). Gate the page
  // so those roles get a clear denial rather than a failed fetch.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_REPORT_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="arrears" requiredRoles={PAYROLL_REPORT_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }
  const { data: items, source } = await getData();
  const errored = source === "error";

  // GAP-PAYROLL-ARREARS-01: one batched directory lookup for every employee on
  // the page (not one per row) -- names, not raw UUIDs.
  const names = await resolveEmployeeNames(items.map((i) => i.employee_id));

  const columns: {
    key: keyof DisplayRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "status" | "amount";
    sortable?: boolean;
  }[] = [
    { key: "employee_label", label: t("colEmployee") },
    { key: "component_label", label: t("colArrearType") },
    // Display strings ("Jul 2026") would sort alphabetically; rows arrive
    // newest-period first instead (below).
    { key: "from_period_display", label: t("colFromPeriod"), sortable: false },
    { key: "to_period_display", label: t("colToPeriod"), sortable: false },
    { key: "difference_minor", label: t("colAmount"), align: "right", cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
    { key: "reason", label: t("colReason") },
  ];

  const rows: DisplayRow[] = [...items]
    .sort((a, b) => b.from_period.localeCompare(a.from_period))
    .map((i) => {
      const labelKey = COMPONENT_LABEL_KEYS[i.component_code];
      return {
        ...i,
        employee_label: employeeDisplayLabel(names, i.employee_id, t("unknownEmployee")),
        component_label: labelKey ? t(labelKey) : i.component_code,
        from_period_display: formatPeriod(i.from_period),
        to_period_display: formatPeriod(i.to_period),
      };
    });

  // GAP-PAYROLL-ARREARS-02: outstanding = pending + approved only, net of recoveries.
  const { outstandingNetMinor } = summarizeArrears(items);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* GAP-PAYROLL-ARREARS-05: back to the payroll hub, like every sibling payroll page. */}
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel={t("backLabel")} />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={errored ? null : items.filter((i) => i.status === "pending").length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApprovedPaid")} value={errored ? null : items.filter((i) => i.status === "approved" || i.status === "paid").length} />
        <StatCard icon="💰" iconBg="var(--panel)" label={t("statTotalArrearsAmount")} value={errored ? null : formatMoney(outstandingNetMinor)} />
      </StatGrid>
      <Card title={t("registerCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "arrears" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<DisplayRow> columns={columns} rows={rows} sortable filterable filterPlaceholder={t("filterPlaceholder")} pageSize={15} emptyIcon="📋" emptyTitle={t("emptyTitle")} emptyMessage={t("emptyMessage")} />
        )}
      </Card>
    </div>
  );
}
