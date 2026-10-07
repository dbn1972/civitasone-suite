import { PageHeader } from "../../../_components/ds";
import { ApprovalMatrixPanel } from "./ApprovalMatrixPanel";
import { requireAnyRole, ESTAB_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-ESTAB-APPROVAL-MATRIX-02: creating/toggling approval rules decides who
 * signs sanctions, payments and disciplinary actions. estab-service already
 * enforces this server-side — POST/PATCH /v1/estab/approval-rules requireRole
 * ADMIN_ROLES (["estab_admin","super_admin","tenant_admin"]) and 403s a plain
 * clerk (see modules/approval-rules/routes.ts) — but the page previously had
 * no gate, so a non-admin reached the create/toggle UI and only discovered the
 * block on submit. requireAnyRole redirects a non-admin away before render.
 * The server stays the authority; this is defence-in-depth + UX.
 */
export default function ApprovalMatrixPage() {
  requireAnyRole(ESTAB_ADMIN_ROLES);
  return (
    <>
      <PageHeader
        title="Approval Matrix"
        subtitle="Define who must approve which module action by amount band. Modules raising an eFile are routed automatically."
        back="/estab/list"
      />
      <ApprovalMatrixPanel />
    </>
  );
}
