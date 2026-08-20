import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceCashBook } from "@/app/_data/loaders";
import { CashBankTable } from "./CashBankTable";

export default async function CashBankPage() {
  const { data: entries, source } = await getFinanceCashBook();
  // gl.finance_cash_book returns raw snake_case columns (no serialize() step
  // on the backend): receipt_minor / payment_minor / entry_date, not the
  // camelCase names this page previously (and incorrectly) read.
  const receipts = entries.filter((e) => Number(e.receipt_minor ?? 0) > 0).length;
  const payments = entries.filter((e) => Number(e.payment_minor ?? 0) > 0).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Cash & Bank Book"
        subtitle="Day book with receipts, payments, and running balance."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📖" iconBg="#e7edfd" label="Total Entries" value={entries.length} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Receipts" value={receipts} />
        <StatCard icon="📤" iconBg="#fce7ee" label="Payments" value={payments} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Today" value={entries.filter((e) => String(e.entry_date) === new Date().toISOString().slice(0, 10)).length} />
      </StatGrid>
      <Card title="Cash & Bank Entries">
        <CashBankTable entries={entries} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
