import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

/**
 * Agent Workload is a platform-wide routing control: it sets each agent's lead
 * capacity and availability (PATCH v1/crm/teams/agents/:id/capacity). Sibling
 * admin-config routes (assignment-rules, assignment-directory, custom-fields,
 * dedup-rules …) all gate this way, but this route previously had no layout and
 * fell through to the broad CRM layout (any crm_user), so a non-admin reaching
 * the URL got a fully-wired capacity editor (GAP-CRM-AGENT-WORKLOAD-01). The
 * server remains the authority; this is defence-in-depth + UX.
 *
 * GAP2-CRM-AGENT-WORKLOAD-05: the gate now matches the teams-route server lists
 * exactly. The crm-service teams routes accept [crm_user, crm_admin, super_admin,
 * tenant_admin] for the agent GET and [crm_admin, super_admin, tenant_admin] for
 * the capacity PATCH (teams/routes.ts). The shared CRM_ADMIN_ROLES set also
 * admitted `admin` and `platform_admin`, which NO teams route accepts — those
 * roles got a fully-wired editor that could neither load nor save. Use the
 * route-accurate admin set instead so the gate and the server agree (parity).
 */
const AGENT_WORKLOAD_ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

export default function AgentWorkloadLayout({ children }: { children: ReactNode }) {
  requireAnyRole(AGENT_WORKLOAD_ADMIN_ROLES, "/crm");
  return <>{children}</>;
}
