import { getAdminInvoiceDetail, getInvoiceOpsData } from "@/app/_data/loaders";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { BILLING_INVOICE_OPERATOR_ROLES, BILLING_INVOICE_READER_ROLES } from "@/lib/auth/adminRoles";
import { InvoiceDetail } from "./InvoiceDetail";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GAP-ADMIN-INVOICES-06: opens one invoice from the register (line items, approval history, print).
// Offline payment (maker-checker) and reminders live in InvoiceOpsPanel; the page itself stays read-only.
export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  if (!sessionHasAnyRole(BILLING_INVOICE_READER_ROLES)) {
    return <AdminAccessDenied title="Invoice" area="billing invoices" roles={BILLING_INVOICE_READER_ROLES} />;
  }
  // A malformed id is "not found" without a request: it can never be an invoice.
  if (!UUID.test(params.id)) return <InvoiceDetail state={{ kind: "not-found" }} />;
  const res = await getAdminInvoiceDetail(params.id);
  if (res.status === 404) return <InvoiceDetail state={{ kind: "not-found" }} />;
  if (res.source === "error" || !res.data) return <InvoiceDetail state={{ kind: "error", status: res.status }} />;
  const canOperate = sessionHasAnyRole(BILLING_INVOICE_OPERATOR_ROLES);
  const ops = await getInvoiceOpsData(params.id, canOperate);
  return <InvoiceDetail state={{ kind: "ready", invoice: res.data, ops: { ...ops, canOperate } }} />;
}
