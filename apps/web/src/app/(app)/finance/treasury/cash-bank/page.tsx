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
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Cash & Bank Book"
        subtitle="Day book with receipts, payments, and running balance."
        back="/finance"
      />
      <StatGrid>
        <StatCard icon="📖" iconBg="#e7edfd" label="Total Entries" value={entries.length} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Receipts" value={receipts} />
        <StatCard icon="📤" iconBg="#fce7ee" label="Payments" value={payments} />
        {/* IST, not UTC: an entry genuinely dated "today" in India would be
            excluded from 00:00-05:30 IST every day if compared against
            new Date().toISOString(), which is always UTC. */}
        <StatCard icon="📊" iconBg="#fffaeb" label="Today" value={entries.filter((e) => String(e.entry_date) === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })).length} />
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside CashBankTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <Card title="Cash & Bank Entries">
        <CashBankTable entries={entries} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
