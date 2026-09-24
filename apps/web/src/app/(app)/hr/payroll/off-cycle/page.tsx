import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, Tabs, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { CreateOffCycleForm } from "./CreateOffCycleForm";
import { OffCycleList, type OffCycleRow } from "./OffCycleList";
import { OffCycleCards } from "./OffCycleCard";
import { toHumanError } from "@/lib/messages";

async function getData(): Promise<LoaderResult<OffCycleRow[]>> {
  return fetchJson<unknown, OffCycleRow[]>("/api/v1/payroll/off-cycle", [], {
    telemetryKey: "payroll.off-cycle",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: OffCycleRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function OffCyclePage() {
  const t = await getTranslations("offCycle");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const draftCount = items.filter((r) => r.status === "draft").length;
  const totalAmountMinor = items.reduce((sum, r) => sum + Number(r.total_amount_minor ?? 0), 0);
  const totalNetMinor = items.reduce((sum, r) => sum + Number(r.total_net_minor ?? 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      <StatGrid>
        <StatCard icon="🗂️" iconBg="var(--infobg)" label={t("statTotalRuns")} value={errored ? null : items.length} />
        <StatCard icon="📝" iconBg="var(--warnbg)" label={t("statDraftPending")} value={errored ? null : draftCount} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTotalAmount")} value={errored ? null : formatMoney(totalAmountMinor)} />
        <StatCard icon="🧾" iconBg="var(--infobg)" label={t("statTotalNetProcessed")} value={errored ? null : formatMoney(totalNetMinor)} />
      </StatGrid>

      <CreateOffCycleForm />

      {/* Card view — primary: shows reason, employees in scope, approval status, process action */}
      <Card title={t("runsCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "off cycle" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <div style={{ padding: "0 4px" }}>
          <OffCycleCards rows={items} />
        </div>
        )}
      </Card>
    </main>
  );
}
