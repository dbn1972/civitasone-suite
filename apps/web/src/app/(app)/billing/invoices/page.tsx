import { PageHeader, DataTable, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

export interface InvoiceRow extends Record<string, unknown> {
  id: string;
  periodMonth: string;
  status: string;
  totalMinor: string;
  paidMinor: string;
  outstandingMinor: string;
  currency: string;
  issuedAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  /** GAP-BILLING-INVOICES-02 (interim): a readable, searchable reference derived
   *  from period + short id. NOT a GST-statutory sequential invoice number (those
   *  must be minted gaplessly server-side; see the decision note on the GAP). */
  reference: string;
}

function deriveReference(id: string, periodMonth: string): string {
  // "INV-2026-07-ab12cd34" — human-quotable and filterable without inventing a
  // statutory number. The uuid still lives in the row and the URL.
  const shortId = id.replace(/-/g, "").slice(0, 8);
  return `INV-${periodMonth}-${shortId}`;
}

async function getInvoices(): Promise<LoaderResult<InvoiceRow[]>> {
  return fetchJson<unknown, InvoiceRow[]>("/api/v1/billing/invoices", [], {
    telemetryKey: "billing.invoices.list",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: InvoiceRow[] })?.data;
      if (!Array.isArray(arr)) return null;
      return arr.map((r) => ({ ...r, reference: deriveReference(r.id, r.periodMonth) }));
    },
  });
}

export default async function BillingInvoicesPage() {
  const { data: invoices, source, status, errorMessage } = await getInvoices();

  // GAP-BILLING-INVOICES-01: on a failed fetch the old page rendered an amber
  // "Couldn't load — showing nothing" badge AND an empty DataTable whose
  // EmptyState read "No invoices yet — No invoices have been generated for this
  // tenant." — a transient outage read as a genuinely empty ledger, with no
  // retry. Now a failure returns a retryable LoadErrorState (403-aware) and the
  // empty-ledger state is only ever shown for a real source==="api" + [] read.
  if (source === "error") {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title="Billing — Invoices"
          subtitle="Tenant invoices from the Billing service."
          back="/billing"
        />
        <LoadErrorState result={{ status, errorMessage }} area="invoices" backHref="/billing" />
      </div>
    );
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Billing — Invoices"
        subtitle="Tenant invoices from the Billing service. Open an invoice to generate or cancel its GST e-invoice (IRN)."
        back="/billing"
      />

      <DataTable<InvoiceRow>
        columns={[
          { key: "reference", label: "Invoice" },
          { key: "periodMonth", label: "Period", cellType: "period" },
          { key: "status", label: "Status", cellType: "status" },
          { key: "totalMinor", label: "Total", align: "right", cellType: "money", currencyKey: "currency" },
          { key: "paidMinor", label: "Paid", align: "right", cellType: "money", currencyKey: "currency" },
          { key: "outstandingMinor", label: "Outstanding", align: "right", cellType: "money", currencyKey: "currency" },
          { key: "issuedAt", label: "Issued", cellType: "datetime" },
        ]}
        rows={invoices}
        rowLinkKey="id"
        rowLinkPrefix="/billing/invoices/"
        identifyingColumnKey="reference"
        sortable
        filterable
        filterPlaceholder="Filter by invoice reference, period, or status…"
        pageSize={15}
        emptyIcon="🧾"
        emptyTitle="No invoices yet"
        emptyMessage="No invoices have been generated for this tenant."
      />
    </div>
  );
}
