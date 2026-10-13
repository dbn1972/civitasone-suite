import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { WORKFLOW_TASK_ROLES } from "@/lib/auth/workRoles";

/**
 * SF-20: /approvals is the workflow task inbox. Its only data call is GET /v1/workflow/tasks,
 * which workflow-service restricts to WORKFLOW_TASK_ROLES (a mirror of its own `ROLES`). A role
 * outside it can never see a task, so it is redirected instead of shown a page of 403s.
 */
export default function ApprovalsLayout({ children }: { children: ReactNode }) {
  requireAnyRole([...WORKFLOW_TASK_ROLES]);
  return <ModuleGate moduleKey="workflow">{children}</ModuleGate>;
}
