import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getFinanceChallanById } from "@/app/_data/loaders";
import { formatIndianDate, formatMoney } from "@/lib/formatters";

/**
 * Challan detail. Previously 100% hardcoded fake data with `params.id` never
 * read — now wired to the real GET /v1/finance/challans/:id loader (same one
 * the challan register list already uses for its row links). That backend
 * route does not exist yet (see FinanceChallanSummary's "no live GET route"
 * note in packages/types), so today this honestly falls into the empty state
 * below; once finance-service ships the route, real data flows through
 * automatically with no further frontend change.
 */
export default async function ChallanDetailPage({ params }: { params: { id: string } }) {
  const { data: challan, source } = await getFinanceChallanById(params.id);

  if (!challan) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Challan Detail" back="/finance/revenue/challans" />
        <EmptyState
          icon="🧾"
          title="Challan detail not available"
          message="This challan may not exist, or challan detail lookup isn't available yet. Check the challan register for the current list."
        />
      </main>
    );
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Challan ${challan.challanNo}`}
        subtitle={challan.depositor}
        back="/finance/revenue/challans"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label="Amount" value={formatMoney(challan.amountMinor)} />
        <StatCard icon="🧾" iconBg="#e7edfd" label="GRN No" value={challan.grnNo ?? "—"} />
        <StatCard icon="📅" iconBg="#fffaeb" label="Created" value={formatIndianDate(challan.createdAt)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Status" value={challan.status} />
      </StatGrid>

      <Card title="Challan Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Challan No</span><span className="mono">{challan.challanNo}</span></div>
          <div className="field"><span className="label">Depositor</span><span>{challan.depositor}</span></div>
          <div className="field"><span className="label">Amount</span><span>{formatMoney(challan.amountMinor)}</span></div>
          <div className="field"><span className="label">Currency</span><span>{challan.currency}</span></div>
          <div className="field"><span className="label">GRN No</span><span className="mono">{challan.grnNo ?? "—"}</span></div>
          <div className="field"><span className="label">Receipt Head</span><span className="mono">{challan.receiptHeadId}</span></div>
          <div className="field"><span className="label">Created</span><span>{formatIndianDate(challan.createdAt)}</span></div>
          <div className="field"><span className="label">Last Updated</span><span>{formatIndianDate(challan.updatedAt)}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={challan.status} /></div>
        </div>
      </Card>
    </main>
  );
}
