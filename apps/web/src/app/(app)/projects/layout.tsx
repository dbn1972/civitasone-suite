import type { ReactNode } from "react";
import { requireAnyRole, PROJECT_VIEW_ROLES } from "@/lib/auth/roleGuard";
import { ModuleGate } from "../ModuleGate";

/**
 * GAP2-PROJECTS-LAYOUT-AUTHZ-01: the projects tree previously had NO role gate
 * — only ModuleGate (tenant enablement) — so every signed-in user in a tenant
 * with the projects module enabled could load every projects screen (list,
 * detail, schemes, fund-releases, delay-analysis, escalations, ...). This
 * mirrors grants/layout.tsx's requireAnyRole(GRANTS_VIEW_ROLES): a session with
 * no projects role is redirected to /dashboard. project-service already
 * enforces the same role sets on every route (requireRole), so this is
 * defence-in-depth + UX consistency, not the security boundary.
 */
export default function ProjectsLayout({ children }: { children: ReactNode }) {
  requireAnyRole(PROJECT_VIEW_ROLES, "/dashboard");
  return <ModuleGate moduleKey="projects">{children}</ModuleGate>;
}
