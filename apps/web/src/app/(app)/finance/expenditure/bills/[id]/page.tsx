import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState } from "../../../../../_components/ds";
import { getFinanceBillById } from "../../../../../_data/loaders";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { BillPassPayActions } from "../../../_components/FinanceActions";
import { BillLineItemsTable } from "./BillLineItemsTable";

export default async function BillDetailPage({ params }: { params: { id: string } }) {
  const { data: bill, source } = await getFinanceBillById(params.id);

  if (!bill) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <a href="/finance/expenditure/bills">Bills</a> <span aria-hidden="true">›</span> Not found
        </nav>
        <PageHeader title="Bill Detail" back="/finance/expenditure/bills" />
        <EmptyState icon="🧮" title="Bill not found" message="This bill may have been removed or the ID is invalid." />
      </>
    );
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <a href="/finance">Finance</a> <span aria-hidden="true">›</span>{" "}
        <a href="/finance/expenditure/bills">Bills</a> <span aria-hidden="true">›</span>{" "}
        <span aria-current="page">{bill.billNo}</span>
      </nav>

      <PageHeader
        title={bill.billNo}
        subtitle={bill.vendor}
        back="/finance/expenditure/bills"
        actions={
          <>
            <StatusPill status={bill.status} label={bill.status.replace("_", " ")} />
            <BillPassPayActions id={params.id} status={bill.status} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf5" label="Amount" value={formatMoney(bill.amount)} />
        <StatCard icon="📋" iconBg="#eff6ff" label="Status" value={bill.status.replace(/_/g, " ")} />
        <StatCard icon="🏢" iconBg="#faf5ff" label="Vendor" value={bill.vendor} />
        <StatCard icon="📅" iconBg="#fff7ed" label="Date" value={formatIndianDate(bill.submittedDate)} />
      </StatGrid>

      <Card title="Bill details" padding>
        <div className="fields">
          <div className="field"><span className="label">Bill No</span><span className="mono">{bill.billNo}</span></div>
          <div className="field"><span className="label">Vendor</span><span>{bill.vendor}</span></div>
          <div className="field"><span className="label">Amount</span><span>{formatMoney(bill.amount)}</span></div>
          <div className="field"><span className="label">PO Reference</span><span>{bill.poRef ?? "—"}</span></div>
          <div className="field"><span className="label">GRN Reference</span><span>{bill.grnRef ?? "—"}</span></div>
          <div className="field"><span className="label">Invoice No</span><span>{bill.invoiceNo ?? "—"}</span></div>
          <div className="field"><span className="label">Submitted</span><span>{formatIndianDate(bill.submittedDate)}</span></div>
          <div className="field"><span className="label">Due Date</span><span>{bill.dueDate ? formatIndianDate(bill.dueDate) : "—"}</span></div>
          <div className="field"><span className="label">3-Way Match</span><StatusPill status={bill.threeWayMatch} label={bill.threeWayMatch.replace("_", " ")} /></div>
          <div className="field"><span className="label">Payment Ref</span><span>{bill.paymentRef ?? "—"}</span></div>
        </div>
      </Card>

      {bill.lineItems.length > 0 && (
        <Card title="Line items">
          <BillLineItemsTable
            rows={bill.lineItems as ({ description: string; quantity: number; unitPrice: number; amount: number; taxCode?: string } & Record<string, unknown>)[]}
          />
        </Card>
      )}
    </>
  );
}
