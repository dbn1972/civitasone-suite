import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";
import { humanizeStatus } from "@/lib/formatters";

type Row = {
  id: string;
  employee: string;
  department: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  // GAP-HR-CHECKIN-LOG-01: the API field is `source` (attendance/repo.ts) —
  // this used to be named `checkinSource` here, so it never matched
  // anything and was always undefined.
  source: string;
  totalHours: string;
} & Record<string, unknown>;

// GAP-HR-CHECKIN-LOG-01: the only source values this service actually
// writes today are "manual" (schema default), "regularisation"
// (f3-consumer.ts) and "leave_approval" (leave-sync.ts) — "biometric"/
// "mobile" do not exist anywhere in the codebase yet (grepped), despite the
// subtitle/empty-state copy describing them; kept here so the column and
// the stat tiles are already correct the day a biometric/mobile integration
// starts writing real values, and humanizeStatus (imported lazily below)
// covers anything else unforeseen.
const SOURCE_LABEL_KEYS: Record<string, string> = {
  manual: "sourceManual",
  biometric: "sourceBiometric",
  mobile: "sourceMobile",
  regularisation: "sourceRegularisation",
  leave_approval: "sourceLeaveApproval",
};

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/attendance/checkin-log", [], {
    telemetryKey: "hr.attendance_checkin-log",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r;
}

export default async function CheckinLogPage() {
  const t = await getTranslations("checkinLog");
  const { data: rawItems, source } = await getData();

  const errored = source === "error";
  // GAP-HR-CHECKIN-LOG-01: was `items.length - biometric`, which mislabeled
  // every regularisation/leave_approval row as "mobile/manual" (and read a
  // field — checkinSource — that never existed, so biometric was always 0
  // and this tile always equalled the total). Now an explicit count of just
  // the two values it actually names.
  const biometric = rawItems.filter((i) => i.source === "biometric").length;
  const mobileManual = rawItems.filter((i) => i.source === "manual" || i.source === "mobile").length;
  const missingCheckout = rawItems.filter((i) => !i.checkOut).length;

  function sourceLabel(value: string): string {
    const key = SOURCE_LABEL_KEYS[value];
    return key ? t(key) : humanizeStatus(value);
  }

  // DataTable ("use client") can't accept a `render:` callback from this
  // Server Component (see DataTable.tsx's Column<T> doc comment / the
  // GAP-HR-EXPENSES-01 crash class it documents) — so GAP-HR-CHECKIN-LOG-01's
  // source-label mapping and GAP-HR-CHECKIN-LOG-03's checkIn/checkOut "—"
  // fallback are both applied here, as plain data, before the rows ever
  // reach DataTable. The date column stays a raw ISO string and uses the
  // built-in, server-safe cellType:"date" (formatIndianDate) instead.
  const items = rawItems.map((r) => ({
    ...r,
    checkIn: r.checkIn ?? "—",
    checkOut: r.checkOut ?? "—",
    source: sourceLabel(r.source),
  }));

  const columns: { key: keyof Row & string; label: string; cellType?: "date" }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "date", label: t("colDate"), cellType: "date" },
    { key: "checkIn", label: t("colCheckIn") },
    { key: "checkOut", label: t("colCheckOut") },
    { key: "totalHours", label: t("colTotalHours") },
    { key: "source", label: t("colSource") },
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
        <StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? "—" : items.length} />
        <StatCard icon="🔒" iconBg="var(--goodbg, #e6f7f0)" label={t("statBiometricLabel")} value={errored ? "—" : biometric} />
        <StatCard icon="⚠️" iconBg="var(--warnbg, #fff7e6)" label={t("statMissingCheckoutLabel")} value={errored ? "—" : missingCheckout} />
        <StatCard icon="📱" iconBg="var(--bg, #f5f5f5)" label={t("statMobileManualLabel")} value={errored ? "—" : mobileManual} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "check-in log" })} backHref="/hr" />
        ) : (
          <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={20}
          emptyIcon="📍"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
