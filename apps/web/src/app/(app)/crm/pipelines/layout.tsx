import type { ReactNode } from "react";
import { requireAnyRole, CRM_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-CRM-PIPELINES-03: pipeline configuration (create/edit/delete pipelines
 * and per-stage mandatory fields/gates/scope) is a platform-wide admin control,
 * like the sibling CRM config routes (task-escalation, qualification-frameworks,
 * custom-fields, dedup-rules), which all gate on an admin role list. This route
 * previously fell through to the broad CRM layout (any crm_user), so a non-admin
 * could load and operate a fully-wired Save/Delete pipeline editor.
 *
 * Gates on the shared CRM_ADMIN_ROLES constant (the same set every other CRM
 * admin-config route uses), redirecting a plain crm_user to /crm. The server
 * remains the authority on pipeline writes; this is defence-in-depth + UX.
 *
 * NOTE: /crm/pipeline (the read-only Kanban board) is a DIFFERENT route and is
 * unaffected — it has no layout of its own and still uses the broad CRM layout,
 * so a crm_user can still view the board; only the /crm/pipelines editor is
 * admin-gated.
 */
export default function PipelinesLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_ADMIN_ROLES, "/crm");
  return <>{children}</>;
}
