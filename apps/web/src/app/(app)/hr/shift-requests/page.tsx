import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

/**
 * ShiftRequestsPage — employee requests to swap/change shift.
 * Maker-checker: employee submits → supervisor approves.
 * GoI context: shift changes must be approved per DoPT staffing guidelines.
 *
 * Canonical route for shift change requests (linked from the HR hub). A
 * duplicate previously lived at /hr/shifts/requests (linked from the Shifts
 * page) with a slightly different, more accurate field mapping -- consolidated
 * here; see HR-A deep-verify notes.
 */

type Row = {
  id: string;
  employeeId: string;
  employeeName: string;
  currentShift: string;
  requestedShift: string;
  effectiveDate: string;
  reason: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  // Real shape from GET /v1/hrms/shift-requests: { id, employeeId, employeeName,
  // currentShift, requestedShift, effectiveDate, reason, status, createdAt }.
  // There is no `department` field -- a column for it previously rendered blank
  // on every row.
  return fetchJson<unknown, Row[]>("/api/v1/hrms/shift-requests", [], {
    telemetryKey: "hr.shift-requests",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      if (!Array.isArray(arr)) return null;
      return arr.map((r) => ({
        ...r,
        employeeName: (r as Record<string, unknown>).employeeName as string ?? r.employeeId,
        reason: r.reason ?? "—",
      }));
    },
  });
}

export default async function ShiftRequestsPage() {
  const t = await getTranslations("shiftRequests");
  const { data: items, source } = await getData();

  const errored = source === "error";
  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const rejected = items.filter((i) => ["rejected", "declined"].includes(i.status)).length;

  const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employeeName", label: t("colEmployee") },
    { key: "currentShift", label: t("colCurrentShift") },
    { key: "requestedShift", label: t("colRequestedShift") },
    { key: "effectiveDate", label: t("colEffectiveDate") },
    { key: "reason", label: t("colReason") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🔄" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? "—" : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPendingLabel")} value={errored ? "—" : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApprovedLabel")} value={errored ? "—" : approved} />
        <StatCard icon="❌" iconBg="var(--badbg, #fff0f0)" label={t("statRejectedLabel")} value={errored ? "—" : rejected} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "shift requests" })} backHref="/hr" />
        ) : (
          <DataTable<Row>
          columns={COLUMNS}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={20}
          emptyIcon="🔄"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
