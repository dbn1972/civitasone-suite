import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
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
  const { data: invoices, source } = await getSAInvoices();
  const paid = invoices.filter((i) => String(i.status).toLowerCase() === "paid").length;
  const overdue = invoices.filter((i) => String(i.status).toLowerCase() === "overdue").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside InvoicesTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <PageHeader title="Invoices" subtitle="Billing invoices for your signed-in organisation (the invoice API is tenant-scoped; it does not list other tenants)." back="/admin" />
      <StatGrid>
        <StatCard icon="🧾" iconBg="#eef2ff" label="Total Invoices" value={invoices.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Paid" value={paid} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={invoices.length - paid - overdue} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Overdue" value={overdue} />
      </StatGrid>
      <Card title="Invoice Register">
        <InvoicesTable invoices={invoices} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
