import { getTranslations } from "next-intl/server";
import { PageHeader, Card, DataTable, StatGrid, StatCard, LoadErrorState } from "../../../../_components/ds";
import { formatMoney } from "@/lib/formatters";
import { currentFinancialYear, isValidFinancialYearLabel } from "@/lib/fiscalYear";
import { FyFilter } from "../../_components/FyFilter";
import { PrintExportButton } from "../../_components/PrintExportButton";
import { PrintHeader } from "../../_components/PrintHeader";
import { getBalanceSheet, getIncomeExpenditure, getReceiptsPayments, type StatementLine } from "./statementSet";

/** Paise string -> "₹1,234.00"; an unreadable figure is "—", never a fabricated zero. */
function money(v: string | null): string {
  return v === null ? "—" : formatMoney(BigInt(v));
}

type Row = { id: string; head: string; amount: string };
const toRows = (ls: StatementLine[]): Row[] =>
  ls.map((l) => ({ id: l.code || l.name, head: [l.code, l.name].filter(Boolean).join(" · "), amount: l.balanceMinor ?? "" }));

export default async function StatementSetPage(props: { searchParams?: Promise<{ fy?: string }> }) {
  const sp = await props.searchParams;
  const raw = (sp?.fy ?? "").trim();
  const fy = isValidFinancialYearLabel(raw) ? raw : currentFinancialYear();
  const t = await getTranslations("financeStatementSet");

  const [rp, ie, bs] = await Promise.all([getReceiptsPayments(fy), getIncomeExpenditure(fy), getBalanceSheet(fy)]);

  const section = (key: string, ls: StatementLine[], total: string | null, totalLabel: string) => (
    <div key={key}>
      <DataTable<Row>
        caption={t(key)}
        columns={[
          { key: "head", label: t(key) },
          { key: "amount", label: t("colAmount"), align: "right", cellType: "amount" },
        ]}
        rows={toRows(ls)}
        sortable={false}
        pageSize={100}
        emptyIcon="📒"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage", { fy })}
      />
      <p className="pad" style={{ margin: 0, fontWeight: 600 }}>{totalLabel}: {money(total)}</p>
    </div>
  );

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle", { fy })}
        actions={
          <>
            <FyFilter />
            <PrintExportButton label={t("print")} documentTitle={t("title")} />
          </>
        }
      />
      <PrintHeader title={t("title")} scope={t("scope", { fy })} />

      <section aria-labelledby="ss-rp">
        <h2 id="ss-rp" style={{ fontSize: 16, margin: "16px 0 8px" }}>{t("rpTitle")}</h2>
        {rp.source === "error" || !rp.data ? (
          <LoadErrorState result={rp} area={t("rpArea")} backHref="/finance" />
        ) : (
          <Card title={t("rpCard", { fy })}>
            <DataTable<{ id: string; account: string; receipts: string; payments: string; closing: string }>
              caption={t("rpTitle")}
              columns={[
                { key: "account", label: t("colAccount") },
                { key: "receipts", label: t("colReceipts"), align: "right", cellType: "amount" },
                { key: "payments", label: t("colPayments"), align: "right", cellType: "amount" },
                { key: "closing", label: t("colNet"), align: "right", cellType: "amount" },
              ]}
              rows={rp.data.rows.map((r) => ({
                id: r.account || "-",
                account: r.account === "bank" ? t("bank") : r.account === "cash" ? t("cash") : r.account || "—",
                receipts: r.totalReceiptsMinor ?? "",
                payments: r.totalPaymentsMinor ?? "",
                closing: r.closingBalanceMinor ?? "",
              }))}
              sortable={false}
              emptyIcon="📒"
              emptyTitle={t("emptyTitle")}
              emptyMessage={t("emptyMessage", { fy })}
            />
          </Card>
        )}
      </section>

      <section aria-labelledby="ss-ie">
        <h2 id="ss-ie" style={{ fontSize: 16, margin: "24px 0 8px" }}>{t("ieTitle")}</h2>
        {ie.source === "error" || !ie.data ? (
          <LoadErrorState result={ie} area={t("ieArea")} backHref="/finance" />
        ) : (
          <>
            <StatGrid>
              <StatCard icon="📥" tone="good" label={t("totalIncome")} value={money(ie.data.totalIncomeMinor)} />
              <StatCard icon="📤" tone="bad" label={t("totalExpenditure")} value={money(ie.data.totalExpenditureMinor)} />
              <StatCard
                icon="💰"
                tone="info"
                label={ie.data.result === "deficit" ? t("deficit") : t("surplus")}
                value={
                  ie.data.surplusDeficitMinor === null
                    ? "—"
                    : formatMoney(BigInt(ie.data.surplusDeficitMinor) < 0n ? -BigInt(ie.data.surplusDeficitMinor) : BigInt(ie.data.surplusDeficitMinor))
                }
              />
            </StatGrid>
            <Card title={t("ieCard", { fy, start: ie.data.periodStart, end: ie.data.periodEnd })}>
              {section("ieIncome", ie.data.income, ie.data.totalIncomeMinor, t("totalIncome"))}
              {section("ieExpenditure", ie.data.expenditure, ie.data.totalExpenditureMinor, t("totalExpenditure"))}
            </Card>
          </>
        )}
      </section>

      <section aria-labelledby="ss-bs">
        <h2 id="ss-bs" style={{ fontSize: 16, margin: "24px 0 8px" }}>{t("bsTitle")}</h2>
        {bs.source === "error" || !bs.data ? (
          <LoadErrorState result={bs} area={t("bsArea")} backHref="/finance" />
        ) : (
          <>
            <StatGrid>
              <StatCard icon="🏛️" tone="info" label={t("totalAssets")} value={money(bs.data.totalAssetsMinor)} />
              <StatCard icon="📑" tone="bad" label={t("totalLiabEquity")} value={money(bs.data.totalLiabilitiesAndEquityMinor)} />
              <StatCard
                icon="⚖️"
                tone={bs.data.balanced === true ? "good" : "bad"}
                label={t("balanceCheck")}
                value={bs.data.balanced === null ? t("cannotVerify") : bs.data.balanced ? t("balanced") : t("unbalanced")}
                {...(bs.data.balanced === false ? { delta: t("difference", { amount: money(bs.data.differenceMinor) }), up: false } : {})}
              />
            </StatGrid>
            <Card title={t("bsCard", { asOf: bs.data.asOf })}>
              {section("bsAssets", bs.data.assets, bs.data.totalAssetsMinor, t("totalAssets"))}
              {section("bsLiabilities", bs.data.liabilities, bs.data.totalLiabilitiesMinor, t("totalLiabilities"))}
              {section("bsEquity", bs.data.equity, bs.data.accumulatedFundsMinor, t("accumulatedFunds"))}
            </Card>
          </>
        )}
      </section>
    </>
  );
}
