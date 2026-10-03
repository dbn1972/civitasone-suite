import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { getFinanceDebtById } from "@/app/_data/loaders";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { DebtSchedule } from "./DebtSchedule";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

/** One loan: terms, repayment position and its EMI schedule (GAP-FINANCE-DEBT-01). */
export default async function DebtDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("financeDebtDetail");
  const result = await getFinanceDebtById(params.id);
  const { data: debt, source, status } = result;
  const canRecordPayment = getSessionRoles().some((r) => FINANCE_ROLES.includes(r));

  // Only a real 404 is "not found"; a failed load is its own retry / permission state.
  if (!debt && source === "error" && status !== 404) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("title")} back="/finance/debt" />
        <LoadErrorState result={result} area={t("area")} backHref="/finance/debt" />
      </div>
    );
  }
  if (!debt) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("title")} back="/finance/debt" />
        <EmptyState icon="🏦" title={t("notFoundTitle")} message={t("notFoundMessage")} />
      </div>
    );
  }
  const inr = debt.currency === "INR";
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={debt.instrument} subtitle={debt.lender ?? undefined} back="/finance/debt" />
      <StatGrid>
        <StatCard icon="💰" iconBg="var(--line2)" label={t("principal")} value={inr ? formatMoney(debt.principalMinor) : `${debt.currency} ${debt.principalMinor}`} />
        <StatCard icon="📉" iconBg="var(--warnbg)" label={t("outstanding")} value={debt.outstandingMinor == null ? "—" : inr ? formatMoney(debt.outstandingMinor) : `${debt.currency} ${debt.outstandingMinor}`} />
        <StatCard icon="%" iconBg="var(--infobg)" label={t("rate")} value={debt.interestRateBps == null ? "—" : `${(debt.interestRateBps / 100).toFixed(2)}%`} />
        <StatCard icon="🗓️" iconBg="var(--goodbg)" label={t("maturity")} value={debt.maturity ? formatIndianDate(debt.maturity) : "—"} />
      </StatGrid>
      {debt.receiptGlStatus ? (
        <p role="status" style={{ margin: "0 0 12px", fontSize: 13 }}>
          {debt.receiptGlStatus === "posted" ? t("receiptPosted") : t("receiptPending")}
        </p>
      ) : null}
      <Card title={t("schedule")}>
        <DebtSchedule debtId={debt.id} schedule={debt.schedule} canRecordPayment={canRecordPayment} />
      </Card>
    </div>
  );
}
