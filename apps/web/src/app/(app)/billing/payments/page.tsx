import { PageHeader, DataTable, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

// GAP-BILLING-PAYMENTS-01/02: the billing-service payment read model
// (services/billing-service/src/modules/payments/queries.ts `summarize`) returns
// { id, invoiceId, amountMinor (string paise), currency, method, status,
//   receiptNo, reference, receivedAt } — a payment carries NO name/title/code,
// so the generic mapModuleRows() (which requires a name-like label) dropped
// EVERY payment row and the page always read "No records". This page uses a
// bespoke, typed loader instead so each payment surfaces its amount, mode,
// paid date and a link to the invoice it settled.
export interface PaymentRow extends Record<string, unknown> {
  id: string;
  invoiceId: string | null;
  amountMinor: string;
  currency: string;
  method: string | null;
  status: string;
  receiptNo: string | null;
  reference: string | null;
  receivedAt: string | null;
  /** GAP-BILLING-PAYMENTS-03: a single human reference for the first column so
   *  the receipt/reference is never printed twice and no raw uuid is shown.
   *  Prefers the receipt number, then the gateway reference, then a short id. */
  displayRef: string;
}

function deriveRef(id: string, receiptNo: string | null, reference: string | null): string {
  if (receiptNo && receiptNo.trim()) return receiptNo.trim();
  if (reference && reference.trim()) return reference.trim();
  // Fall back to a short, quotable id prefix — the full uuid still lives in the row.
  return `PMT-${id.replace(/-/g, "").slice(0, 8)}`;
}

async function getPayments(): Promise<LoaderResult<PaymentRow[]>> {
  return fetchJson<unknown, PaymentRow[]>("/api/v1/billing/payments", [], {
    telemetryKey: "billing.payments.list",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: unknown[] })?.data;
      if (!Array.isArray(arr)) return null;
      const rows: PaymentRow[] = [];
      for (const r of arr) {
        if (!r || typeof r !== "object") continue;
        const rec = r as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id : null;
        // GAP-BILLING-PAYMENTS-02: require id only — a payment with no name must
        // still appear (reconciliation safety). amountMinor is a decimal string
        // of paise; keep it as a string (money is bigint paise end to end).
        const amountMinor =
          typeof rec.amountMinor === "string"
            ? rec.amountMinor
            : typeof rec.amountMinor === "number"
              ? String(rec.amountMinor)
              : null;
        if (!id || amountMinor === null || !/^-?\d+$/.test(amountMinor)) continue;
        const receiptNo = typeof rec.receiptNo === "string" ? rec.receiptNo : null;
        const reference = typeof rec.reference === "string" ? rec.reference : null;
        rows.push({
          id,
          invoiceId: typeof rec.invoiceId === "string" ? rec.invoiceId : null,
          amountMinor,
          currency: typeof rec.currency === "string" ? rec.currency : "INR",
          method: typeof rec.method === "string" ? rec.method : null,
          status: typeof rec.status === "string" ? rec.status : "unknown",
          receiptNo,
          reference,
          receivedAt: typeof rec.receivedAt === "string" ? rec.receivedAt : null,
          displayRef: deriveRef(id, receiptNo, reference),
        });
      }
      return rows;
    },
  });
}

export default async function BillingPaymentsPage() {
  const { data: payments, source, status, errorMessage } = await getPayments();

  // GAP-BILLING-PAYMENTS-01: a failed fetch must show a retryable, 403-aware
  // error state — not an empty table that reads like a tenant with zero
  // payments (reconciliation hazard). Only a real source==="api" empty read
  // shows the empty-ledger state.
  if (source === "error") {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title="Billing — Payments"
          subtitle="Payment receipts from the Billing service."
          back="/billing"
        />
        <LoadErrorState result={{ status, errorMessage }} area="payments" backHref="/billing" />
      </div>
    );
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Billing — Payments"
        subtitle="Payment receipts from the Billing service."
        back="/billing"
      />

      {/* GAP-BILLING-PAYMENTS-01/03/04: the whole row links to the invoice it
          settled (rowLinkKey="invoiceId"); a payment with no invoice simply has
          no link. No raw uuid column is rendered — the human reference is the
          first column and the receipt/reference is never duplicated. Sortable,
          filterable (isolate failed/pending), paginated at 15. */}
      <DataTable<PaymentRow>
        columns={[
          { key: "displayRef", label: "Reference" },
          { key: "method", label: "Mode" },
          { key: "amountMinor", label: "Amount", align: "right", cellType: "money", currencyKey: "currency" },
          { key: "status", label: "Status", cellType: "status" },
          { key: "receivedAt", label: "Paid on", cellType: "date" },
        ]}
        rows={payments}
        rowLinkKey="invoiceId"
        rowLinkPrefix="/billing/invoices/"
        identifyingColumnKey="displayRef"
        sortable
        filterable
        filterPlaceholder="Filter by reference, mode, or status…"
        pageSize={15}
        emptyIcon="🧾"
        emptyTitle="No payments yet"
        emptyMessage="No payment receipts have been recorded for this tenant."
      />
    </div>
  );
}
