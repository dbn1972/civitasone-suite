import type { ReactNode } from "react";
import { requireAnyRole, BILLING_GSTN_ROLES } from "@/lib/auth/roleGuard";

/**
 * GAP-BILLING-GSTN-01: GSTN return filing is a statutory, effectively
 * irreversible action. billing-service's gstn routes already require
 * BILLING_GSTN_ROLES server-side (verified in modules/gstn/routes.ts); this
 * mirrors that set as a web gate so an unauthorised user is redirected rather
 * than shown the filing form. The server remains the authority.
 */
export default function GstnLayout({ children }: { children: ReactNode }) {
  requireAnyRole(BILLING_GSTN_ROLES);
  return <>{children}</>;
}
