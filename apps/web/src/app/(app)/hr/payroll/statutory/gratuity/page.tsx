import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { GratuityCalculator } from "./GratuityCalculator";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

type GratuityRow = {
  id: string;
  employeeId: string;
  yearsOfService: number | string;
  gratuityMinor: number;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<GratuityRow[]>> {
  return fetchJson<unknown, GratuityRow[]>("/api/v1/payroll/statutory/gratuity", [], {
    telemetryKey: "payroll.statutory.gratuity",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: GratuityRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function GratuityPage() {
  const t = await getTranslations("gratuity");
  const result = await getData();
  const { data: rows } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";
  const totalGratuityMinor = rows.reduce((s, r) => s + Number(r.gratuityMinor ?? 0), 0);
  const settledRecords = errored ? null : rows.filter((r) => r.status === "settled" || r.status === "paid").length;
  const avgYears =
    rows.length > 0
      ? (rows.reduce((s, r) => s + Number(r.yearsOfService || 0), 0) / rows.length).toFixed(1)
      : "0";

  const columns: {
    key: keyof GratuityRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "amount" | "status";
  }[] = [
    { key: "employeeId", label: t("colEmployee") },
    { key: "yearsOfService", label: t("colYearsOfService"), align: "right" },
    { key: "gratuityMinor", label: t("colGratuityAmount"), align: "right", cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory" backLabel="Back to Statutory"
      />

      <StatGrid>
        <StatCard icon="🎖️" iconBg="var(--infobg)" label={t("statGratuityRecords")} value={errored ? "—" : rows.length} />
        <StatCard icon="💰" iconBg="var(--warnbg)" label={t("statTotalGratuityComputed")} value={errored ? "—" : formatMoney(totalGratuityMinor)} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statSettledPaid")} value={settledRecords ?? "—"} />
        <StatCard icon="📅" iconBg="var(--panel)" label={t("statAvgYearsOfService")} value={errored ? "—" : avgYears} />
      </StatGrid>

      <GratuityCalculator />

      <Card title={t("registerCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "gratuity records" })} backHref="/hr/payroll/statutory" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🎖️"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <DataTable<GratuityRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="🎖️"
            emptyTitle={t("emptyTitleFiltered")}
            emptyMessage={t("emptyMessageFiltered")}
          />
        )}
      </Card>
    </div>
  );
}
