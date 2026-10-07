import { PageHeader } from "../../../_components/ds";
import { EstabApprovalsPanel } from "./EstabApprovalsPanel";
import { requireAnyRole, ESTAB_APPROVER_ROLES } from "@/lib/auth/roleGuard";
import { APPROVED_SUBTITLE } from "../_shared/signatureCopy";

/**
 * GAP-ESTAB-APPROVALS-04: the page said "Deputy Secretary and above" but had no
 * gate — every establishment user saw Approve/Reject. requireAnyRole redirects
 * a non-approver away. The workflow-service task-complete endpoint remains the
 * authority on the specific task role; this is defence-in-depth + UX.
 *
 * GAP-ESTAB-APPROVALS-02: subtitle no longer claims "e-Signed" — approving
 * records an approval, it does not apply a DSC digital signature (see
 * _shared/signatureCopy.ts).
 */
export default function EstabApprovalsPage() {
  requireAnyRole(ESTAB_APPROVER_ROLES);
  return (
    <>
      <PageHeader
        title="eOffice Approvals"
        subtitle={`Deputy Secretary and above — ${APPROVED_SUBTITLE}`}
        back="/estab/list"
      />
      <EstabApprovalsPanel />
    </>
  );
}
