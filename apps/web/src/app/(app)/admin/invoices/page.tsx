import { PageHeader } from "@/app/_components/ds";
import { getSAInvoices } from "@/app/_data/loaders";
import { InvoicesTable } from "./InvoicesTable";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { BILLING_INVOICE_READER_ROLES } from "@/lib/auth/adminRoles";

export default async function InvoicesPage() {
  // GAP-ADMIN-INVOICES-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(BILLING_INVOICE_READER_ROLES)) {
    return <AdminAccessDenied title="Invoices" area="billing invoices" roles={BILLING_INVOICE_READER_ROLES} />;
  }
  const { data: invoices, source, status, errorMessage } = await getSAInvoices();

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* GAP-ADMIN-INVOICES-03/-04: the stat cards, data-source badge and failure state
          live inside InvoicesTable, driven by the one useSeededResource call that
          produces its rows (UX-002's pattern). GAP-ADMIN-INVOICES-06: this is a
          read-only register -- there is no invoice detail, PDF, mark-paid or reminder
          action, and the subtitle says so rather than implying payment handling. */}
      <PageHeader title="Invoices" subtitle="Read-only register of billing invoices for your signed-in organisation (the invoice API is tenant-scoped; it does not list other tenants)." back="/admin" />
      <InvoicesTable invoices={invoices} source={source === "error" ? "error" : "api"} errorStatus={status} errorMessage={errorMessage} />
    </div>
  );
}
