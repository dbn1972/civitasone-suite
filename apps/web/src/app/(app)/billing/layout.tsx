import type { ReactNode } from "react";
import { ModuleGate } from "../ModuleGate";
import { requireAnyRole, BILLING_MODULE_ROLES } from "@/lib/auth/roleGuard";

export default function BillingLayout({ children }: { children: ReactNode }) {
  // GAP-BILLING-HOME-01: the billing segment had no role gate, so every tenant
  // user saw links to Invoices (IRN cancel) and the GSTN Console (return
  // filing). billing-service enforces roles server-side on every route
  // (verified), but the web layer offered the controls regardless. This mirrors
  // the server's union set (BILLING_MODULE_ROLES) so an unauthorised user is
  // redirected to /dashboard instead of being shown doomed links; the server
  // stays the real authority. Narrower per-area gates live on child layouts
  // (see gstn/layout.tsx).
  requireAnyRole(BILLING_MODULE_ROLES);
  return <ModuleGate moduleKey="billing">{children}</ModuleGate>;
}
