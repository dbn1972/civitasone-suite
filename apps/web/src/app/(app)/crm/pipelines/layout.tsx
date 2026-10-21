import type { ReactNode } from "react";
import { requireAnyRole, CRM_PIPELINE_WRITE_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-CRM-PIPELINES-03: pipeline configuration (create/edit/delete pipelines
 * and per-stage mandatory fields/gates/scope) is a platform-wide admin control,
 * like the sibling CRM config routes (task-escalation, qualification-frameworks,
 * custom-fields, dedup-rules), which all gate on an admin role list. This route
 * previously fell through to the broad CRM layout (any crm_user), so a non-admin
 * could load and operate a fully-wired Save/Delete pipeline editor.
 *
 * Gates on CRM_PIPELINE_WRITE_ROLES (crm_admin, super_admin), redirecting anyone
 * else to /crm. The server remains the authority on pipeline writes; this is
 * defence-in-depth + UX.
 *
 * W2 rescan: crm-service now enforces the same boundary — POST/PATCH/DELETE
 * /v1/crm/pipelines require crm_admin or super_admin (a crm_user gets 403 even
 * when calling the API directly); GETs stay open to every CRM role because the
 * board and the quotation builder read pipelines. The gate used to be the wider
 * CRM_ADMIN_ROLES, which also let tenant_admin in to a wired editor whose every
 * call answered 403 (tenant_admin is not in the pipelines API's read set either);
 * admin / platform_admin never clear the parent CRM layout. Narrowing the web
 * gate to the server's own set changes nobody's real access; WIDENING it (letting
 * tenant_admin configure pipelines) would be an access-control change that needs
 * the backend lists changed first and security sign-off, so it was NOT done.
 *
 * NOTE: /crm/pipeline (the read-only Kanban board) is a DIFFERENT route and is
 * unaffected — it has no layout of its own and still uses the broad CRM layout,
 * so a crm_user can still view the board; only the /crm/pipelines editor is
 * admin-gated.
 */
export default function PipelinesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_PIPELINE_WRITE_ROLES, "/crm");
  return <>{children}</>;
}
