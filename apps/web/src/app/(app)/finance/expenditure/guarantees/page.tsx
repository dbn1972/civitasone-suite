import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, LoadErrorState } from "@/app/_components/ds";
import { guaranteeStats, GUARANTEE_EXPIRY_WINDOW_DAYS } from "@/lib/finance/expenditureStats";
import { getFinanceGuarantees } from "@/app/_data/loaders";
import { GuaranteesTable } from "./GuaranteesTable";

export default async function GuaranteesPage() {
  const t = await getTranslations("expenditureGuarantees");
  const result = await getFinanceGuarantees();
  const { data: guarantees, source } = result;
  const failed = result.source === "error" && guarantees.length === 0;
  const stats = guaranteeStats(guarantees);

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/finance"
        actions={
          // GAP-FINANCE-EXPENDITURE-GUARANTEES-04: this register is read-only (no
          // create/release/invoke endpoint exists); EMD / bank-guarantee
          // instruments are lodged and managed under Procurement, so point there.
          <Link href="/procurement/emd-bg" className="btn ghost">{t("manageInProcurementLink")}</Link>
        }
      />
      <StatGrid>
        <StatCard icon="🛡️" iconBg="#e7edfd" label={t("statTotal")} value={failed ? null : stats.total} />
        <StatCard icon="📈" iconBg="#ecfdf3" label={t("statActive")} value={failed ? null : stats.active} />
        <StatCard icon="✅" iconBg="#fffaeb" label={t("statReleased")} value={failed ? null : stats.released} />
        <StatCard icon="⏳" iconBg="#fffaeb" label={t("statExpiringSoon", { days: GUARANTEE_EXPIRY_WINDOW_DAYS })} value={failed ? null : stats.expiringSoon} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label={t("statLapsed")} value={failed ? null : stats.lapsed} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside GuaranteesTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      {failed ? (
        <LoadErrorState result={result} area={t("areaGuarantees")} backHref="/finance" />
      ) : (
        <Card title={t("cardTitle")}>
          <GuaranteesTable guarantees={guarantees} source={source === "error" ? "error" : "api"} />
        </Card>
      )}
    </div>
  );
}
