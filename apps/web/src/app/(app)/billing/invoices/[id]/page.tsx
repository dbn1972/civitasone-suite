import { PageHeader, Card, StatGrid, StatCard, EmptyState, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { InvoiceActions } from "./InvoiceActions";

export interface InvoiceItemRow extends Record<string, unknown> {
  id: string;
  description: string;
  kind: string;
  quantity: string;
  amountMinor: string;
}

export interface InvoiceApprovalRow extends Record<string, unknown> {
  id: string;
  action: string;
  status: string;
  amountMinor: string;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
}

export interface InvoiceDetail {
  id: string;
  periodMonth: string;
  status: string;
  totalMinor: string;
  paidMinor: string;
  outstandingMinor: string;
  taxMinor: string;
  chargesMinor: string;
  currency: string;
  issuedAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  issuedBy: string | null;
  cancelledBy: string | null;
  items: InvoiceItemRow[];
  approvals: InvoiceApprovalRow[];
}

export interface EInvoiceStatus {
  id: string;
  invoiceId: string;
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  signedQrCode: string | null;
  status: string;
  errorMessage: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

async function getInvoiceDetail(id: string): Promise<LoaderResult<InvoiceDetail | null>> {
  return fetchJson<unknown, InvoiceDetail | null>(`/api/v1/billing/invoices/${id}`, null, {
    telemetryKey: "billing.invoices.detail",
    mapResponse: (p) => (p && typeof p === "object" ? (p as InvoiceDetail) : null),
  });
}

/**
 * fetchJson maps ANY non-2xx (including a routine 404 "no e-invoice generated yet",
 * which is the common case for a fresh invoice) to source:"error" with data:null — it
 * cannot distinguish "not generated" from a genuine outage. We deliberately do NOT surface
 * the DataSourceBadge for this specific sub-resource: showing "Showing saved information"
 * on every not-yet-generated invoice would be misleading. The list/detail invoice fetch
 * above still gates its badge on source==="error" per house rule.
 */
async function getEInvoiceStatus(id: string): Promise<LoaderResult<EInvoiceStatus | null>> {
  return fetchJson<unknown, EInvoiceStatus | null>(`/api/v1/billing/invoices/${id}/einvoice`, null, {
    telemetryKey: "billing.invoices.einvoice",
    mapResponse: (p) => (p && typeof p === "object" ? (p as EInvoiceStatus) : null),
  });
}

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const [{ data: invoice, source: invoiceSource }, { data: einvoice, source: einvoiceSource }] = await Promise.all([
    getInvoiceDetail(params.id),
    getEInvoiceStatus(params.id),
  ]);

  if (!invoice) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Invoice not found" back="/billing/invoices" />
        {invoiceSource === "error" ? (
          <DataSourceBadge source="error" />
        ) : (
          <EmptyState icon="🧾" title="Invoice not found" message="This invoice may have been removed or the ID is invalid." />
        )}
      </main>
    );
  }

  void einvoiceSource; // intentionally unused for badging — see getEInvoiceStatus comment above.

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <a href="/billing">Billing</a> <span aria-hidden="true">›</span>{" "}
        <a href="/billing/invoices">Invoices</a> <span aria-hidden="true">›</span>{" "}
        <span aria-current="page">{invoice.id}</span>
      </nav>

      <PageHeader
        title={`Invoice ${invoice.id}`}
        subtitle={`Period ${invoice.periodMonth} · ${invoice.currency}`}
        back="/billing/invoices"
      />

      {invoiceSource === "error" && <DataSourceBadge source="error" />}

      <StatGrid>
        <StatCard icon="🧾" label="Status" value={invoice.status} />
        <StatCard icon="💰" label="Total" value={formatMoney(invoice.totalMinor)} />
        <StatCard icon="✅" label="Paid" value={formatMoney(invoice.paidMinor)} />
        <StatCard icon="⚠️" label="Outstanding" value={formatMoney(invoice.outstandingMinor)} />
      </StatGrid>

      <Card title="Invoice details" padding>
        <div className="fields">
          <div className="field"><span className="label">Invoice ID</span><span className="mono">{invoice.id}</span></div>
          <div className="field"><span className="label">Period</span><span>{invoice.periodMonth}</span></div>
          <div className="field"><span className="label">Status</span><span>{invoice.status}</span></div>
          <div className="field"><span className="label">Tax</span><span>{formatMoney(invoice.taxMinor)}</span></div>
          <div className="field"><span className="label">Charges</span><span>{formatMoney(invoice.chargesMinor)}</span></div>
          {invoice.issuedAt && <div className="field"><span className="label">Issued</span><span>{invoice.issuedAt}</span></div>}
          {invoice.issuedBy && <div className="field"><span className="label">Issued By</span><span>{invoice.issuedBy}</span></div>}
          {invoice.paidAt && <div className="field"><span className="label">Paid</span><span>{invoice.paidAt}</span></div>}
          {invoice.cancelledAt && <div className="field"><span className="label">Cancelled</span><span>{invoice.cancelledAt}</span></div>}
          {invoice.cancelledBy && <div className="field"><span className="label">Cancelled By</span><span>{invoice.cancelledBy}</span></div>}
          {invoice.cancelReason && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Cancel Reason</span><span>{invoice.cancelReason}</span>
            </div>
          )}
        </div>
      </Card>

      <Card title="Line items" padding>
        {invoice.items.length === 0 ? (
          <EmptyState icon="📄" title="No line items" message="This invoice has no recorded line items." />
        ) : (
          <DataTable<InvoiceItemRow>
            columns={[
              { key: "description", label: "Description" },
              { key: "kind", label: "Kind", cellType: "status" },
              { key: "quantity", label: "Qty", align: "right" },
              { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
            ]}
            rows={invoice.items}
            pageSize={15}
          />
        )}
      </Card>

      {invoice.approvals.length > 0 && (
        <Card title="Approvals" padding>
          <DataTable<InvoiceApprovalRow>
            columns={[
              { key: "action", label: "Action" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
              { key: "requestedBy", label: "Requested By" },
              { key: "decidedBy", label: "Decided By" },
              { key: "decidedAt", label: "Decided At" },
            ]}
            rows={invoice.approvals}
            pageSize={15}
          />
        </Card>
      )}

      <Card title="GST e-invoice (IRN)" padding>
        <InvoiceActions invoiceId={invoice.id} einvoice={einvoice} />
      </Card>
    </main>
  );
}
