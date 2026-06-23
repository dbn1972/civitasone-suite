import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState } from "../../../../../_components/ds";
import { getFinanceBillById } from "../../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

export default async function BillDetailPage({ params }: { params: { id: string } }) {
  const { data: bill, source } = await getFinanceBillById(params.id);

  if (!bill) {
    return (
      <>
        <PageHeader title="Bill Detail" back="/finance/expenditure/bills" />
        <EmptyState icon="🧮" title="Bill not found" message="This bill may have been removed or the ID is invalid." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={bill.billNo}
        subtitle={bill.vendor}
        back="/finance/expenditure/bills"
        actions={
          <>
            <StatusPill status={bill.status} label={bill.status.replace("_", " ")} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard
          icon="₹"
          iconBg="#ecfdf5"
          label="Amount"
          value={"₹" + (bill.amount / 100).toLocaleString("en-IN")}
        />
        <StatCard
          icon="📋"
          iconBg="#eff6ff"
          label="Status"
          value={bill.status.replace(/_/g, " ")}
        />
        <StatCard
          icon="🏢"
          iconBg="#faf5ff"
          label="Vendor"
          value={bill.vendor}
        />
        <StatCard
          icon="📅"
          iconBg="#fff7ed"
          label="Date"
          value={formatIndianDate(bill.submittedDate)}
        />
      </StatGrid>

      <Card title="Bill details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">Bill No</span>
            <span className="mono">{bill.billNo}</span>
          </div>
          <div className="field">
            <span className="label">Vendor</span>
            <span>{bill.vendor}</span>
          </div>
          <div className="field">
            <span className="label">Amount</span>
            <span>₹{(bill.amount / 100).toLocaleString("en-IN")}</span>
          </div>
          <div className="field">
            <span className="label">PO Reference</span>
            <span>{bill.poRef ?? "—"}</span>
          </div>
          <div className="field">
            <span className="label">GRN Reference</span>
            <span>{bill.grnRef ?? "—"}</span>
          </div>
          <div className="field">
            <span className="label">Invoice No</span>
            <span>{bill.invoiceNo ?? "—"}</span>
          </div>
          <div className="field">
            <span className="label">Submitted</span>
            <span>{formatIndianDate(bill.submittedDate)}</span>
          </div>
          <div className="field">
            <span className="label">Due Date</span>
            <span>{bill.dueDate ?? "—"}</span>
          </div>
          <div className="field">
            <span className="label">3-Way Match</span>
            <StatusPill status={bill.threeWayMatch} label={bill.threeWayMatch.replace("_", " ")} />
          </div>
          <div className="field">
            <span className="label">Payment Ref</span>
            <span>{bill.paymentRef ?? "—"}</span>
          </div>
        </div>
      </Card>

      {bill.lineItems.length > 0 && (
        <Card title="Line items">
          <table className="tbl">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Qty</th>
                <th className="num">Unit Price</th>
                <th className="num">Amount</th>
                <th>Tax Code</th>
              </tr>
            </thead>
            <tbody>
              {bill.lineItems.map((item: { description: string; quantity: number; unitPrice: number; amount: number; taxCode?: string }, i: number) => (
                <tr key={i}>
                  <td>{item.description}</td>
                  <td className="num">{item.quantity}</td>
                  <td className="num">₹{(item.unitPrice / 100).toLocaleString("en-IN")}</td>
                  <td className="num">₹{(item.amount / 100).toLocaleString("en-IN")}</td>
                  <td>{item.taxCode ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
