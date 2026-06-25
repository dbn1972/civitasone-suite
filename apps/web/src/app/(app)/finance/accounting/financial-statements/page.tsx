import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinancialStatements } from "../../../../_data/loaders";
import { StatementsTable } from "./StatementsTable";
import { formatMoney } from "@/lib/formatters";

export default async function FinancialStatementsPage() {
  const { data: statements, source } = await getFinancialStatements();

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
            <button className="btn ghost">Export PDF</button>
            <button className="btn ghost">FY 2026-27 ▾</button>
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

      <Card title="Financial Statements · FY 2026-27">
        <StatementsTable statements={statements} source={source} />
      </Card>
    </>
  );
}
