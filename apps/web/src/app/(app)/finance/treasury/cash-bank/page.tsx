import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceCashBook } from "@/app/_data/loaders";
import { CashBankTable } from "./CashBankTable";
import { cashBookCacheKey, parseCashBookQuery, periodLabel } from "./cashBookQuery";
import { formatIndianDate } from "@/lib/formatters";

export default async function CashBankPage({
  searchParams,
}: {
  searchParams?: { type?: string; from?: string; to?: string };
}) {
  // GAP-FINANCE-TREASURY-CASH-BANK-01: account (cash / bank) and date-range
  // filters, applied server-side by finance-service's cash-book route.
  const query = parseCashBookQuery(searchParams);
  const { data: entries, source } = await getFinanceCashBook(query);
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
      <form method="get" className="dt-toolbar" style={{ gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 12 }} aria-label="Cash and bank book filters">
        <label style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
          Account
          <select name="type" defaultValue={query.type ?? ""} className="input">
            <option value="">Cash &amp; bank</option>
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
          From
          <input type="date" name="from" defaultValue={query.from ?? ""} className="input" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
          To
          <input type="date" name="to" defaultValue={query.to ?? ""} className="input" />
        </label>
        <button type="submit" className="btn primary">Apply</button>
        {query.type || query.from || query.to ? <a href="/finance/treasury/cash-bank" className="btn ghost">Clear</a> : null}
      </form>
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
        <CashBankTable
          entries={entries}
          source={source === "error" ? "error" : "api"}
          cacheKey={cashBookCacheKey(query)}
          period={periodLabel(query, formatIndianDate)}
        />
      </Card>
    </div>
  );
}
