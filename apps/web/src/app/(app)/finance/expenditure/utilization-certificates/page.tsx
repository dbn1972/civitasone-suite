import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../../_components/ds";
import { getFinanceUCs } from "../../../../_data/loaders";
import { UCsTable } from "./UCsTable";
import { formatMoney } from "@/lib/formatters";
import { ucStats } from "@/lib/finance/expenditureStats";

export default async function UCsPage() {
  const t = await getTranslations("expenditureUtilizationCertificates");
  const result = await getFinanceUCs();
  const { data: ucs, source } = result;

  // Failed load with nothing to show must not read as zero UCs / ₹0.00
  // (GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-02).
  const failed = result.source === "error" && ucs.length === 0;
  const stats = ucStats(ucs);

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {/* A "Download Format" action used to link here too, identical to
                "+ New UC" — there's no UC template file to download, so the
                dead duplicate button was removed rather than left misleading. */}
            <a href="/finance/expenditure/utilization-certificates/new" className="btn primary">{t("newUcLink")}</a>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label={t("statTotal")} value={failed ? null : stats.total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("statSubmittedVerified")} value={failed ? null : stats.submittedVerified} />
        <StatCard icon="⏳" iconBg="#fffaeb" label={t("statPendingSubmission")} value={failed ? null : stats.pending} />
        <StatCard icon="↩️" iconBg="#fef3f2" label={t("statRejected")} value={failed ? null : stats.rejected} />
        <StatCard icon="💰" iconBg="#eff6ff" label={t("statCoveredAmount")} value={failed ? null : formatMoney(stats.covered)} />
        <StatCard icon="🕒" iconBg="#fffaeb" label={t("statPendingAmount")} value={failed ? null : formatMoney(stats.pendingAmount)} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside UCsTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      {failed ? (
        <LoadErrorState result={result} area={t("areaUcs")} backHref="/finance" />
      ) : (
        <Card title={t("cardTitle")}>
          <UCsTable ucs={ucs} source={source} />
        </Card>
      )}
    </>
  );
}
