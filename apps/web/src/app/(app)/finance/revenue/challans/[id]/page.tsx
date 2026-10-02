import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { getFinanceChallanById } from "@/app/_data/loaders";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { formatReceiptHead } from "@/lib/finance/challanRegister";

/**
 * Challan detail, wired to GET /v1/finance/challans/:id (finance-service
 * treasury/routes.ts -- tenant-scoped, 404 for an unknown id). Previously this
 * page was 100% hardcoded fake data with `params.id` never read.
 *
 * GAP-FINANCE-REVENUE-CHALLANS-DETAIL-02: only a real 404 (or an ok response
 * with no record) means "not found". Any other failed load is an outage the
 * user can retry, and a 403 is a permission decision -- not "may not exist".
 */
export default async function ChallanDetailPage({ params }: { params: { id: string } }) {
  const result = await getFinanceChallanById(params.id);
  const { data: challan, source, status } = result;

  if (source === "error" && status !== 404) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Challan Detail" back="/finance/revenue/challans" />
        <LoadErrorState result={result} area="challan" backHref="/finance/revenue/challans" />
      </div>
    );
  }

  if (!challan) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Challan Detail" back="/finance/revenue/challans" />
        <EmptyState
          icon="🧾"
          title="Challan detail not available"
          message="This challan may not exist. Check the challan register for the current list."
        />
      </div>
    );
  }

  const receiptHead = formatReceiptHead(challan.receiptHeadCode, challan.receiptHeadName);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Challan ${challan.challanNo}`}
        subtitle={challan.depositor}
        back="/finance/revenue/challans"
      />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label="Amount" value={formatMoney(challan.amountMinor)} />
        <StatCard icon="🧾" iconBg="#e7edfd" label="GRN No" value={challan.grnNo ?? "—"} />
        <StatCard icon="📅" iconBg="#fffaeb" label="Created" value={formatIndianDate(challan.createdAt)} />
        {/* GAP-FINANCE-REVENUE-CHALLANS-DETAIL-05: status is shown once, as the pill in the field
            grid below; this card carries the receipt head instead of repeating it raw. */}
        <StatCard icon="🏛️" iconBg="#ecfdf3" label="Receipt Head" value={receiptHead} />
      </StatGrid>

      <Card title="Challan Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Challan No</span><span className="mono">{challan.challanNo}</span></div>
          <div className="field"><span className="label">Depositor</span><span>{challan.depositor}</span></div>
          <div className="field"><span className="label">Amount</span><span>{formatMoney(challan.amountMinor)}</span></div>
          <div className="field"><span className="label">Currency</span><span>{challan.currency}</span></div>
          <div className="field"><span className="label">GRN No</span><span className="mono">{challan.grnNo ?? "—"}</span></div>
          <div className="field"><span className="label">Receipt Head</span><span className="mono">{receiptHead}</span></div>
          <div className="field"><span className="label">Created</span><span>{formatIndianDate(challan.createdAt)}</span></div>
          <div className="field"><span className="label">Last Updated</span><span>{formatIndianDate(challan.updatedAt)}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={challan.status} /></div>
        </div>
      </Card>
    </div>
  );
}
