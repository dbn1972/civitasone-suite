import { PageHeader, Card, StatGrid, StatCard, EmptyState, DataTable, LoadErrorState } from "../../../../_components/ds";
import { AutoBreadcrumb } from "../../../../_components/AutoBreadcrumb";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoneyIn, formatIndianDateTime, humanizeStatus } from "@/lib/formatters";
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

async function getEInvoiceStatus(id: string): Promise<LoaderResult<EInvoiceStatus | null>> {
  return fetchJson<unknown, EInvoiceStatus | null>(`/api/v1/billing/invoices/${id}/einvoice`, null, {
    telemetryKey: "billing.invoices.einvoice",
    mapResponse: (p) => (p && typeof p === "object" ? (p as EInvoiceStatus) : null),
  });
}

/** Short, title-tooltipped actor id when no name resolver exists yet, else "—".
 *  GAP-BILLING-INVOICES-DETAIL-06: no user-directory resolver exists in apps/web
 *  (grep), and showing a full uuid on a maker-checker trail is unreadable; the
 *  safe, honest fallback is a short id with the full id on hover. */
function actorLabel(id: string | null): string {
  if (!id) return "—";
  return id.replace(/-/g, "").slice(0, 8);
}

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const [
    { data: invoice, source: invoiceSource, status: invoiceStatus, errorMessage: invoiceErrorMessage },
    { data: einvoice, source: einvoiceSource, status: einvoiceStatus },
  ] = await Promise.all([getInvoiceDetail(params.id), getEInvoiceStatus(params.id)]);

  // GAP-BILLING-INVOICES-DETAIL-03: distinguish a true 404 (invoice doesn't
  // exist) from a transient outage. fetchJson maps every non-2xx to
  // source==='error' + status, so a 500/timeout used to read as "Invoice not
  // found" with no retry. Only a genuine 404 (or a clean null) is "not found";
  // every other error gets a retryable, 403-aware LoadErrorState.
  if (invoiceSource === "error" && invoiceStatus !== 404) {
    return (
      <div className="page-main wrap">
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <AutoBreadcrumb />
        </nav>
        <PageHeader title="Invoice" back="/billing/invoices" />
        <LoadErrorState
          result={{ status: invoiceStatus, errorMessage: invoiceErrorMessage }}
          area="invoice"
          backHref="/billing/invoices"
        />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="page-main wrap">
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <AutoBreadcrumb />
        </nav>
        <PageHeader title="Invoice not found" back="/billing/invoices" />
        <EmptyState icon="🧾" title="Invoice not found" message="This invoice may have been removed or the ID is invalid." />
      </div>
    );
  }

  // GAP-BILLING-INVOICES-DETAIL-04: an e-invoice outage (not a 404) means the
  // GSTN status is genuinely UNKNOWN — showing "No e-invoice generated" with
  // Generate enabled risks a duplicate IRN request. A 404 is the real
  // "not generated yet" case. Pass this distinction to InvoiceActions.
  const einvoiceUnknown = einvoiceSource === "error" && einvoiceStatus !== 404;

  const cur = invoice.currency;

  return (
    <div className="page-main wrap">
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <AutoBreadcrumb />
      </nav>

      <PageHeader
        title={`Invoice ${invoice.id.replace(/-/g, "").slice(0, 8)}`}
        subtitle={`Period ${invoice.periodMonth} · ${cur}`}
        back="/billing/invoices"
      />

      <StatGrid>
        <StatCard icon="🧾" label="Status" value={humanizeStatus(invoice.status)} />
        <StatCard icon="💰" label="Total" value={formatMoneyIn(invoice.totalMinor, cur)} />
        <StatCard icon="✅" label="Paid" value={formatMoneyIn(invoice.paidMinor, cur)} />
        <StatCard icon="⚠️" label="Outstanding" value={formatMoneyIn(invoice.outstandingMinor, cur)} />
      </StatGrid>

      <Card title="Invoice details" padding>
        <div className="fields">
          <div className="field"><span className="label">Invoice ID</span><span className="mono" title={invoice.id}>{invoice.id}</span></div>
          <div className="field"><span className="label">Period</span><span>{invoice.periodMonth}</span></div>
          <div className="field"><span className="label">Status</span><span>{humanizeStatus(invoice.status)}</span></div>
          <div className="field"><span className="label">Tax</span><span>{formatMoneyIn(invoice.taxMinor, cur)}</span></div>
          <div className="field"><span className="label">Charges</span><span>{formatMoneyIn(invoice.chargesMinor, cur)}</span></div>
          {invoice.issuedAt && <div className="field"><span className="label">Issued</span><span>{formatIndianDateTime(invoice.issuedAt)}</span></div>}
          {invoice.issuedBy && <div className="field"><span className="label">Issued By</span><span className="mono" title={invoice.issuedBy}>{actorLabel(invoice.issuedBy)}</span></div>}
          {invoice.paidAt && <div className="field"><span className="label">Paid</span><span>{formatIndianDateTime(invoice.paidAt)}</span></div>}
          {invoice.cancelledAt && <div className="field"><span className="label">Cancelled</span><span>{formatIndianDateTime(invoice.cancelledAt)}</span></div>}
          {invoice.cancelledBy && <div className="field"><span className="label">Cancelled By</span><span className="mono" title={invoice.cancelledBy}>{actorLabel(invoice.cancelledBy)}</span></div>}
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
              { key: "amountMinor", label: "Amount", align: "right", cellType: "money", currencyKey: "currency" },
            ]}
            rows={invoice.items.map((it) => ({ ...it, currency: cur }))}
            pageSize={15}
          />
        )}
      </Card>

      {invoice.approvals.length > 0 && (
        <Card title="Approvals" padding>
          <DataTable<InvoiceApprovalRow & { requestedByShort: string; decidedByShort: string; currency: string }>
            columns={[
              { key: "action", label: "Action" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "amountMinor", label: "Amount", align: "right", cellType: "money", currencyKey: "currency" },
              { key: "requestedByShort", label: "Requested By" },
              { key: "decidedByShort", label: "Decided By" },
              { key: "decidedAt", label: "Decided At", cellType: "datetime" },
            ]}
            rows={invoice.approvals.map((a) => ({
              ...a,
              currency: cur,
              requestedByShort: actorLabel(a.requestedBy),
              decidedByShort: actorLabel(a.decidedBy),
            }))}
            pageSize={15}
          />
        </Card>
      )}

      <Card title="GST e-invoice (IRN)" padding>
        <InvoiceActions invoiceId={invoice.id} einvoice={einvoice} einvoiceUnknown={einvoiceUnknown} />
      </Card>
    </div>
  );
}
