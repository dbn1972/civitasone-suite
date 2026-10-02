import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "../../../../_components/ds";
import { getFinanceBills } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { billStats } from "@/lib/finance/expenditureStats";
import { BillsTable } from "./BillsTable";
import Link from "next/link";
import { canWrite, BILL_CREATE_ROLES } from "@/lib/finance/writeRoles";
import { getSessionRoles } from "@/lib/auth/roleGuard";

export default async function BillsPage() {
  const t = await getTranslations("expenditureBills");
  const result = await getFinanceBills();
  const { data: bills, source } = result;

  // Failed load with nothing to show must not read as zero bills / ₹0.00.
  const failed = result.source === "error" && bills.length === 0;
  const stats = billStats(bills);
  // GAP-FINANCE-EXPENDITURE-BILLS-05: lodging a bill is FINANCE_ROLES-only on the
  // server; read-only finance readers are not offered the link.
  const mayCreate = canWrite(getSessionRoles(), BILL_CREATE_ROLES);

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          // GAP-FINANCE-EXPENDITURE-BILLS-04: the "Finance Configuration" ghost link
          // is gone -- /finance/config sets up FYs/banks, there is no pre-audit
          // rules screen, and the primary action should stand alone.
          mayCreate ? <Link href="/finance/expenditure/bills/new" className="btn primary">{t("newBillLink")}</Link> : null
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
