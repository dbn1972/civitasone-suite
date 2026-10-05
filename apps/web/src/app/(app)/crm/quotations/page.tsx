import { PageHeader } from "../../../_components/ds";
import { QuotationBuilder } from "../../../_components/crm/QuotationBuilder";
import { getSessionRoles, getSessionUserId, CRM_QUOTATION_APPROVE_ROLES } from "@/lib/auth/roleGuard";

/** QP-003/004/005 — quotation builder, approvals, versions, convert to order. */
export default function Page() {
  // Maker-checker gating comes from the verified session JWT, never the client.
  // The server (quotation-approval-routes.ts decide) remains authoritative; this
  // only avoids offering an Approve/Reject that is guaranteed to 403.
  const roles = getSessionRoles();
  const canApprove = CRM_QUOTATION_APPROVE_ROLES.some((r) => roles.includes(r));
  const currentUserId = getSessionUserId();
  return (
    <>
      <PageHeader
        title="Quotations"
        subtitle="Build quotations from the catalogue with price-book pricing and tax, request discount/deviation approvals, track versions, accept/reject and convert to an order."
        back="/crm"
        backLabel="CRM"
      />
      <QuotationBuilder canApprove={canApprove} currentUserId={currentUserId} />
    </>
  );
}
