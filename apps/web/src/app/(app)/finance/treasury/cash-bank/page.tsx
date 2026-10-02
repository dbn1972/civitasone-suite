import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceCashBook } from "@/app/_data/loaders";
import { CashBankTable } from "./CashBankTable";
import { cashBookCacheKey, parseCashBookQuery, periodLabel } from "./cashBookQuery";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { cashBookTotals, countToday, openingClosing } from "@/lib/finance/cashBook";

// finance-service cash-book route default page size (cashbook/routes.ts `limit` default).
const CASH_BOOK_PAGE = 100;

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
  // GAP-FINANCE-TREASURY-CASH-BANK-04: money totals summed in BigInt paise (counts kept as hints).
  const totals = cashBookTotals(entries);
  // GAP-FINANCE-TREASURY-CASH-BANK-02: the route returns at most CASH_BOOK_PAGE rows. Opening/closing
  // are only shown for ONE account type and a window the limit did not truncate.
  const balances = query.type ? openingClosing(entries, entries.length < CASH_BOOK_PAGE) : null;

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
        <StatCard icon="📥" iconBg="#ecfdf3" label={`Receipts (${totals.receiptCount} entries)`} value={formatMoney(totals.receiptTotal)} />
        <StatCard icon="📤" iconBg="#fce7ee" label={`Payments (${totals.paymentCount} entries)`} value={formatMoney(totals.paymentTotal)} />
        {/* IST, not UTC: an entry genuinely dated "today" in India would be
            excluded from 00:00-05:30 IST every day if compared against
            new Date().toISOString(), which is always UTC. */}
        <StatCard icon="📊" iconBg="#fffaeb" label="Today" value={countToday(entries)} />
        {balances ? <StatCard icon="🔓" iconBg="#eff6ff" label="Opening balance" value={formatMoney(balances.opening)} /> : null}
        {balances ? <StatCard icon="🔒" iconBg="#eff6ff" label="Closing balance" value={formatMoney(balances.closing)} /> : null}
      </StatGrid>
      {/* UX-012: the data-source badge now lives inside CashBankTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
        Balance is a running ledger balance and reads correctly in date order only (newest first).
        {balances ? "" : " Choose Cash or Bank above to see opening and closing balances."}
      </p>
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
