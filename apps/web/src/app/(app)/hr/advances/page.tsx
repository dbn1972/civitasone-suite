import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { RequestAdvanceForm } from "./RequestAdvanceForm";
import { mapAdvances, type ApiAdvance, type Row } from "./mapAdvances";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

import { getTranslations } from "next-intl/server";

async function getData(): Promise<LoaderResult<Row[]>> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/salary-advances", [], {
    telemetryKey: "hr.advances",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiAdvance[] })?.data;
      return Array.isArray(arr) ? mapAdvances(arr as ApiAdvance[]) : null;
    },
  });
  return r;
}

export default async function AdvancesPage() {
  const t = await getTranslations("advances");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; render?: (r: Row) => string }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "amount", label: t("colAmount"), render: (r) => formatMoney(r.amount) },
    { key: "purpose", label: t("colPurpose") },
    { key: "recoveryMonths", label: t("colRecovery") },
    { key: "recovered", label: t("colRecovered"), render: (r) => formatMoney(r.recovered) },
    { key: "requestDate", label: t("colDate") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
<StatCard icon="💰" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApproved")} value={errored ? null : approved} />
        <StatCard icon="❌" iconBg="var(--badbg, #fdecea)" label={t("statRejected")} value={errored ? null : rejected} />
      </StatGrid>

      <RequestAdvanceForm />

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "advances" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="💰"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </main>
  );
}
