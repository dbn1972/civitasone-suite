import { getTranslations } from "next-intl/server";
import { Card, EmptyState, PageHeader } from "@/app/_components/ds";
import { AdminAccessDenied, sessionHasAnyRole } from "../../_components/AdminAccessGate";
import { BILLING_INVOICE_OPERATOR_ROLES } from "@/lib/auth/adminRoles";
import { getSessionTenantId } from "@/lib/auth/roleGuard";
import { NewInvoiceForm } from "./NewInvoiceForm";

/** UAT P2 (J8, D5): create a draft invoice. Writes are platform-operator only (billing-service requireSuperAdmin). */
export default async function NewInvoicePage() {
  const t = await getTranslations("adminInvoiceNew");
  if (!sessionHasAnyRole(BILLING_INVOICE_OPERATOR_ROLES)) {
    return <AdminAccessDenied title={t("title")} area="billing invoices" roles={BILLING_INVOICE_OPERATOR_ROLES} />;
  }
  const tenantId = getSessionTenantId();
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/admin/invoices" />
      {tenantId ? (
        <NewInvoiceForm tenantId={tenantId} />
      ) : (
        <Card><EmptyState icon="🔒" title={t("noTenantTitle")} message={t("noTenantMessage")} /></Card>
      )}
    </div>
  );
}
