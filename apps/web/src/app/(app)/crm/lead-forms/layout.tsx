import type { ReactNode } from "react";
import { requireAnyRole, CRM_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-CRM-LEAD-FORMS-02: a lead-capture form key mints an UNAUTHENTICATED
 * public submit endpoint and the registry controls origin allow-lists and
 * rate limits — all of which decide who can post leads into the tenant. That
 * is an administrative control, so the whole screen is restricted to CRM
 * administrators rather than every crm_user that the parent /crm layout
 * admits. The server remains the authority on the mutations; this stops a
 * plain crm_user from reaching the registry (and its CSV export) at all.
 *
 * DECISION (recorded in the fixer report): the form key is treated as a public
 * embed value (it appears in landing-page source by design), so it is not
 * masked — the control that matters is who can see/manage the registry and
 * export it, not hiding a value that is public anyway.
 */
export default function LeadFormsLayout({ children }: { children: ReactNode }) {
  requireAnyRole(CRM_ADMIN_ROLES, "/crm");
  return <>{children}</>;
}
