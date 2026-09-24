/**
 * Probation Confirmation page — Sprint 14 / Lifecycle Phase 2
 * Card grid via ProbationConfirmationList (replaces plain DataTable).
 */
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import {
  ProbationConfirmationList,
  type ConfirmationRow,
} from "./_components/ProbationConfirmationCard";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

async function getData(): Promise<LoaderResult<ConfirmationRow[]>> {
  return fetchJson<unknown, ConfirmationRow[]>("/api/v1/hrms/confirmations", [], {
    telemetryKey: "hr.confirmations",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ConfirmationRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function ConfirmationPage() {
  const t = await getTranslations("confirmation");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const today    = new Date().toISOString().slice(0, 10);
  const overdue  = items.filter((r) => r.dueDate && r.dueDate < today).length;
  const dueSoon  = items.filter((r) => {
    if (!r.dueDate || r.dueDate < today) return false;
    const diff = Math.ceil(
      (new Date(r.dueDate).getTime() - Date.now()) / 86_400_000,
    );
    return diff <= 30;
  }).length;
  const timely   = Math.max(0, items.length - overdue - dueSoon);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      <StatGrid>
<StatCard icon="📋" iconBg="var(--infobg, #e6f0ff)" label={t("statOnProbation")}   value={errored ? null : items.length} />
        <StatCard icon="⏰" iconBg="var(--badbg, #fff1f0)" label={t("statOverdue")}         value={errored ? null : overdue} />
        <StatCard icon="📅" iconBg="var(--warnbg, #fffbe6)" label={t("statDueSoon")} value={errored ? null : dueSoon} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statTimely")}          value={errored ? null : timely} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "confirmations" })} backHref="/hr" />
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <ProbationConfirmationList rows={items} />
          </div>
        )}
      </Card>
    </main>
  );
}
