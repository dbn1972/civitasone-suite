import Link from "next/link";
import { PageHeader } from "@/app/_components/ds";
import { getFinanceDebt } from "@/app/_data/loaders";
import { getTranslations } from "next-intl/server";
import { DebtTable, type DebtLabels } from "./DebtTable";

export default async function DebtPage() {
  const result = await getFinanceDebt();
  const t = await getTranslations("financeDebt");
  // GAP-FINANCE-DEBT-01: lender, interest rate, outstanding principal and the EMI
  // schedule are recorded per loan (migrations/0082); older rows without a
  // repayment position show "—" rather than a zero.
  const labels: DebtLabels = {
    totalLoans: t("totalLoans"),
    active: t("active"),
    closed: t("closed"),
    totalPrincipal: t("totalPrincipal"),
    mixedCurrency: t("mixedCurrency"),
    portfolio: t("portfolio"),
    instrument: t("colInstrument"),
    source: t("colSource"),
    principal: t("colPrincipal"),
    lender: t("colLender"),
    rate: t("colRate"),
    outstanding: t("colOutstanding"),
    totalOutstanding: t("totalOutstanding"),
    maturity: t("colMaturity"),
    status: t("colStatus"),
    search: t("search"),
    emptyTitle: t("emptyTitle"),
    emptyMessage: t("emptyMessage"),
    loadArea: t("loadArea"),
    sources: { rbi: t("sourceRbi"), market: t("sourceMarket"), central_govt: t("sourceCentralGovt") },
  };

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/finance"
        actions={<Link href="/finance/debt/new" className="btn primary">{t("newLoan")}</Link>}
      />
      {/* UX-012 / DEBT-03: stat cards and the data-source badge both live inside
          DebtTable, driven by the one useSeededResource call that produces its rows. */}
      <DebtTable
        loans={result.data}
        source={result.source === "error" ? "error" : "api"}
        errorStatus={result.status}
        errorMessage={result.errorMessage}
        labels={labels}
      />
    </div>
  );
}
