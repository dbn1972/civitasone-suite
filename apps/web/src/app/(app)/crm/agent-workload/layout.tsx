import type { ReactNode } from "react";
import { requireAnyRole, CRM_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * Agent Workload is a platform-wide routing control: it sets each agent's lead
 * capacity and availability (PATCH v1/crm/teams/agents/:id/capacity). Sibling
 * admin-config routes (assignment-rules, assignment-directory, custom-fields,
 * dedup-rules …) all gate this way, but this route previously had no layout and
 * fell through to the broad CRM layout (any crm_user), so a non-admin reaching
 * the URL got a fully-wired capacity editor (GAP-CRM-AGENT-WORKLOAD-01). The
 * server remains the authority; this is defence-in-depth + UX.
 */
export default function AgentWorkloadLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_ADMIN_ROLES, "/crm");
  return <>{children}</>;
}
