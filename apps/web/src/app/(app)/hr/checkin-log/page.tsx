import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";

type Row = {
  id: string;
  employee: string;
  department: string;
  date: string;
  checkIn: string;
  checkOut: string;
  checkinSource: string;
  totalHours: string;
} & Record<string, unknown>;

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
  const { data: items, source } = await getData();

  const errored = source === "error";
  const biometric = items.filter((i) => {
    const s = String(i.checkinSource ?? "").toLowerCase();
    return s === "biometric" || s === "bio" || s === "hardware";
  }).length;
  const missingCheckout = items.filter((i) => !i.checkOut || i.checkOut === "—" || i.checkOut === "").length;

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "date", label: t("colDate") },
    { key: "checkIn", label: t("colCheckIn") },
    { key: "checkOut", label: t("colCheckOut") },
    { key: "totalHours", label: t("colTotalHours") },
    { key: "checkinSource", label: t("colSource") },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
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
        <StatCard icon="📱" iconBg="var(--bg, #f5f5f5)" label={t("statMobileManualLabel")} value={errored ? "—" : items.length - biometric} />
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
    </main>
  );
}
