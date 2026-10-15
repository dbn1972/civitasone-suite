import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { TS_CREATE_ROLES } from "@/lib/auth/workRoles";

/**
 * GAP-WORKS-APPROVALS-05: the works-service only accepts a TS create from TS_CREATE_ROLES, but the form was reachable
 * by direct URL for anyone. This server-component layout redirects everyone else back to the register instead of
 * showing a doomed form (the server stays the authority; this is defence-in-depth + honest UX).
 */
export default function NewTsLayout({ children }: { children: ReactNode }) {
  requireAnyRole(TS_CREATE_ROLES, "/works/approvals");
  return <>{children}</>;
}
