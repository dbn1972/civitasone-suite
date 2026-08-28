import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinancialStatements } from "../../../../_data/loaders";
import { StatementsTable } from "./StatementsTable";
import { PrintExportButton } from "../../_components/PrintExportButton";
import { FyFilter } from "../../_components/FyFilter";
import { formatMoney } from "@/lib/formatters";
import { currentFinancialYear } from "@/lib/fiscalYear";

export default async function FinancialStatementsPage({ searchParams }: { searchParams?: { fy?: string } }) {
  const fy = searchParams?.fy && /^\d{4}-\d{2}$/.test(searchParams.fy) ? searchParams.fy : currentFinancialYear();
  const { data: statements, source } = await getFinancialStatements(fy);

  const totalReceipts = statements.reduce((s, st) => s + st.receipts, 0);
  const totalPayments = statements.reduce((s, st) => s + st.payments, 0);
  const totalOpening = statements.reduce((s, st) => s + st.openingBalance, 0);
  const totalClosing = statements.reduce((s, st) => s + st.closingBalance, 0);

  return (
    <>
      <PageHeader
        title="Financial Statements"
        subtitle="Receipts &amp; Payments, Income &amp; Expenditure, Balance Sheet."
        actions={
          <>
            <PrintExportButton label="Export PDF" documentTitle="Financial Statements" />
            <FyFilter />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📊" iconBg="#e7edfd" label="Opening Balance" value={formatMoney(totalOpening)} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Total Receipts" value={formatMoney(totalReceipts)} delta="Income" up={true} />
        <StatCard icon="📤" iconBg="#fef3f2" label="Total Payments" value={formatMoney(totalPayments)} delta="Expenditure" up={false} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Closing Balance" value={formatMoney(totalClosing)} />
      </StatGrid>

      <Card title={`Financial Statements · FY ${fy}`}>
        <StatementsTable statements={statements} source={source} fy={fy} />
      </Card>
    </>
  );
}
