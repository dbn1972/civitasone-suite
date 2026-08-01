import { PageHeader, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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
}

async function getInvoices(): Promise<LoaderResult<InvoiceRow[]>> {
  return fetchJson<unknown, InvoiceRow[]>("/api/v1/billing/invoices", [], {
    telemetryKey: "billing.invoices.list",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: InvoiceRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function BillingInvoicesPage() {
  const { data: invoices, source } = await getInvoices();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Billing — Invoices"
        subtitle="Tenant invoices from the Billing service. Open an invoice to generate or cancel its GST e-invoice (IRN)."
        back="/billing"
      />
      {source === "error" && <DataSourceBadge source="error" />}

      <DataTable<InvoiceRow>
        columns={[
          { key: "id", label: "Invoice ID" },
          { key: "periodMonth", label: "Period" },
          { key: "status", label: "Status", cellType: "status" },
          { key: "totalMinor", label: "Total", align: "right", cellType: "amount" },
          { key: "paidMinor", label: "Paid", align: "right", cellType: "amount" },
          { key: "outstandingMinor", label: "Outstanding", align: "right", cellType: "amount" },
          { key: "issuedAt", label: "Issued" },
        ]}
        rows={invoices}
        rowLinkKey="id"
        rowLinkPrefix="/billing/invoices/"
        sortable
        filterable
        filterPlaceholder="Filter by invoice ID, period, or status…"
        pageSize={15}
        emptyIcon="🧾"
        emptyTitle="No invoices yet"
        emptyMessage="No invoices have been generated for this tenant."
      />
    </main>
  );
}
