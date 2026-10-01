import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { resolveEmployeeNames, employeeDisplayLabel } from "@/app/_data/employeeNames";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { CreateCorrectionForm } from "./CreateCorrectionForm";
import { toHumanError } from "@/lib/messages";
import { PendingCorrections } from "./PendingCorrections";

type Row = {
  id: string;
  employee_id: string;
  component: string;
  effective_from: string;
  old_value_minor: number | string;
  new_value_minor: number | string;
  arrears_minor: number | string;
  affected_periods: number;
  reason: string | null;
  status: string;
  created_at: string;
} & Record<string, unknown>;

type DisplayRow = Row & { effective_from_display: string; employee_label: string; reason_display: string };

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/corrections", [], {
    telemetryKey: "payroll.corrections",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function CorrectionsPage() {
  const t = await getTranslations("corrections");

  // GAP-PAYROLL-CORRECTIONS-05: GET /v1/payroll/corrections is
  // PAYROLL_READER_ROLES-only and POST is PAYROLL_ADMIN_ROLES-only
  // (payroll-service gap-routes.ts READER_ROLES / PAYROLL_ROLES). hr/layout
  // admits employee/manager too -- they get an explanation, not a failed
  // fetch of every employee's retroactive pay changes, and no form.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_READER_ROLES.includes(r))) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel={t("backLabel")} />
        <PermissionDenied module="salary corrections" requiredRoles={PAYROLL_READER_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }
  const canRecord = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));

  const { data: items, source } = await getData();
  const errored = source === "error";

  const columns: {
    key: keyof DisplayRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "status" | "amount";
  }[] = [
    { key: "employee_label", label: t("colEmployee") },
    { key: "component", label: t("colComponent") },
    { key: "effective_from_display", label: t("colEffectiveFrom") },
    { key: "old_value_minor", label: t("colOldValue"), align: "right", cellType: "amount" },
    { key: "new_value_minor", label: t("colNewValue"), align: "right", cellType: "amount" },
    { key: "arrears_minor", label: t("colArrears"), align: "right", cellType: "amount" },
    { key: "affected_periods", label: t("colPeriods"), align: "right" },
    { key: "status", label: t("colStatus"), cellType: "status" },
    // GAP-PAYROLL-CORRECTIONS-04: the reason was collected but never shown.
    { key: "reason_display", label: t("colReason") },
  ];

  // Server-safe: DataTable's `render` prop cannot cross the server/client
  // boundary, so pre-format the display date into a plain string field.
  // GAP-PAYROLL-CORRECTIONS-02: names via one batched directory lookup.
  const names = await resolveEmployeeNames(items.map((r) => r.employee_id));
  const rows: DisplayRow[] = items.map((row) => ({
    ...row,
    effective_from_display: formatIndianDate(row.effective_from),
    employee_label: employeeDisplayLabel(names, row.employee_id, t("unknownEmployee")),
    reason_display: row.reason?.trim() ? row.reason : "—",
  }));

  const pendingCount = items.filter((r) => r.status === "pending").length;
  const totalArrearsMinor = items.reduce((sum, r) => sum + Number(r.arrears_minor ?? 0), 0);
  const approvedCount = items.filter((r) => r.status === "approved").length;
  const canDecide = canRecord;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={t("backLabel")}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      <StatGrid>
        <StatCard icon="✏️" iconBg="var(--infobg)" label={t("statTotalCorrections")} value={errored ? null : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={errored ? null : pendingCount} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTotalArrears")} value={errored ? null : formatMoney(totalArrearsMinor)} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApproved")} value={errored ? null : approvedCount} />
      </StatGrid>

      {canRecord && <CreateCorrectionForm />}

      {/* GAP-PAYROLL-CORRECTIONS-01: corrections used to stay "Pending"
          forever -- nothing could approve or reject them. Decisions are
          PAYROLL_ROLES-only server-side and must come from someone other
          than the correction's creator. */}
      {!errored && canDecide && (
        <Card title={t("pendingCardTitle")} padding>
          <PendingCorrections rows={items.filter((r) => r.status === "pending")} />
        </Card>
      )}

      <Card title={t("historyCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "corrections" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<DisplayRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="✏️"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>

      <Card title={t("lopCardTitle")} padding>
        <p style={{ fontSize: 13, color: "var(--ink2)" }}>
          {t("lopDescription")}
        </p>
      </Card>
    </div>
  );
}
