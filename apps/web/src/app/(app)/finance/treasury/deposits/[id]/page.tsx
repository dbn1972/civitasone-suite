import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getFinanceDepositById } from "../depositDetail";
import { DepositLedgerTable } from "../DepositLedgerTable";
import { depositStatusVariant, depositTypeLabel } from "../depositStats";

/**
 * Deposit detail (GAP-FINANCE-TREASURY-DEPOSITS-03): the deposit's balances and the ledger of its
 * refund / forfeit / adjustment events. Only a real 404 means "not found"; any other failed
 * load is an outage the user can retry, and a 403 is a permission decision.
 */
export default async function DepositDetailPage({ params }: { params: { id: string } }) {
  const result = await getFinanceDepositById(params.id);
  const { data: deposit, source, status } = result;

  if (source === "error" && status !== 404) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Deposit Detail" back="/finance/treasury/deposits" />
        <LoadErrorState result={result} area="deposit" backHref="/finance/treasury/deposits" />
      </div>
    );
  }
  if (!deposit) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Deposit Detail" back="/finance/treasury/deposits" />
        <EmptyState icon="🏧" title="Deposit not found" message="This deposit may have been removed or the ID is invalid." />
      </div>
    );
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={`Deposit ${deposit.pdNo}`} subtitle={deposit.administrator || undefined} back="/finance/treasury/deposits" />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label="Balance" value={formatMoney(deposit.balanceMinor)} />
        <StatCard icon="↩️" iconBg="#eff6ff" label="Refunded" value={formatMoney(deposit.refundedMinor)} />
        <StatCard icon="⚖️" iconBg="#fce7ee" label="Forfeited" value={formatMoney(deposit.forfeitedMinor)} />
        <StatCard icon="🧾" iconBg="#fffaeb" label="Adjusted against bills" value={formatMoney(deposit.adjustedMinor)} />
      </StatGrid>

      <Card title="Deposit Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Deposit No</span><span className="mono">{deposit.pdNo}</span></div>
          <div className="field"><span className="label">Type</span><span>{depositTypeLabel(deposit.type)}</span></div>
          <div className="field"><span className="label">Administrator</span><span>{deposit.administrator || "—"}</span></div>
          <div className="field"><span className="label">Opened</span><span>{deposit.createdAt ? formatIndianDate(deposit.createdAt) : "—"}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={deposit.status} variant={depositStatusVariant(deposit.status)} /></div>
        </div>
      </Card>

      <Card title="Ledger">
        <DepositLedgerTable events={deposit.events} />
      </Card>
    </div>
  );
}
