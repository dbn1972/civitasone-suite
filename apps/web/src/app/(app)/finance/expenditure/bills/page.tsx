import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../../_components/ds";
import { getFinanceBills } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { billStats } from "@/lib/finance/expenditureStats";
import { BillsTable } from "./BillsTable";
import Link from "next/link";

export default async function BillsPage() {
  const t = await getTranslations("expenditureBills");
  const result = await getFinanceBills();
  const { data: bills, source } = result;

  // Failed load with nothing to show must not read as zero bills / ₹0.00.
  const failed = result.source === "error" && bills.length === 0;
  const stats = billStats(bills);

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <>
            {/* /finance/config sets up FYs/banks, not pre-audit rules — there is no
                dedicated pre-audit-rules screen yet, so this points to the closest
                real destination rather than promising content that doesn't exist. */}
            <Link href="/finance/config" className="btn ghost">{t("financeConfigLink")}</Link>
            <Link href="/finance/expenditure/bills/new" className="btn primary">{t("newBillLink")}</Link>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🧮" iconBg="#e7edfd" label={t("statInProcess")} value={failed ? null : stats.inProcess} />
        <StatCard icon="⏱" iconBg="#fffaeb" label={t("statTotal")} value={failed ? null : bills.length} />
        <StatCard icon="💸" iconBg="#eff6ff" label={t("statValueInPipeline")} value={failed ? null : formatMoney(stats.pipelineValue)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label={t("statPaidAllTime")} value={failed ? null : formatMoney(stats.paidAllTime)} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside BillsTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      {failed ? (
        <LoadErrorState result={result} area={t("areaBills")} backHref="/finance" />
      ) : (
        <Card title={t("cardTitle")}>
          <BillsTable bills={bills} source={source} />
        </Card>
      )}
    </>
  );
}
