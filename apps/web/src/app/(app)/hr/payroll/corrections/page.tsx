import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { CreateCorrectionForm } from "./CreateCorrectionForm";
import { toHumanError } from "@/lib/messages";

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

type DisplayRow = Row & { effective_from_display: string };

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
  const { data: items, source } = await getData();
  const errored = source === "error";

  const columns: {
    key: keyof DisplayRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "status" | "amount";
  }[] = [
    { key: "employee_id", label: t("colEmployee") },
    { key: "component", label: t("colComponent") },
    { key: "effective_from_display", label: t("colEffectiveFrom") },
    { key: "old_value_minor", label: t("colOldValue"), align: "right", cellType: "amount" },
    { key: "new_value_minor", label: t("colNewValue"), align: "right", cellType: "amount" },
    { key: "arrears_minor", label: t("colArrears"), align: "right", cellType: "amount" },
    { key: "affected_periods", label: t("colPeriods"), align: "right" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  // Server-safe: DataTable's `render` prop cannot cross the server/client
  // boundary, so pre-format the display date into a plain string field.
  const rows = items.map((row) => ({ ...row, effective_from_display: formatIndianDate(row.effective_from) }));

  const pendingCount = items.filter((r) => r.status === "pending").length;
  const totalArrearsMinor = items.reduce((sum, r) => sum + Number(r.arrears_minor ?? 0), 0);
  const approvedCount = items.filter((r) => r.status === "approved").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      <StatGrid>
        <StatCard icon="✏️" iconBg="var(--infobg)" label={t("statTotalCorrections")} value={errored ? null : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={errored ? null : pendingCount} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTotalArrears")} value={errored ? null : formatMoney(totalArrearsMinor)} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statApproved")} value={errored ? null : approvedCount} />
      </StatGrid>

      <CreateCorrectionForm />

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
    </main>
  );
}
