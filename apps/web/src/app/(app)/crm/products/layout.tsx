import type { ReactNode } from "react";
import { requireAnyRole } from "@/lib/auth/roleGuard";

/**
 * GAP-CRM-PRODUCTS-01: the product catalogue drives quotation prices and tax
 * rates straight into quotations, so any CRM user being able to edit a price
 * or tax rate is a pricing-integrity hole. Sibling admin-config routes
 * (custom-fields, dedup-rules, lead-scoring) already gate this way; this route
 * fell through to the broad CRM layout only (any crm_user), so a plain
 * crm_user could load and interact with a fully-wired Save/Delete price/tax
 * editor. Gate it to admins; the server stays the authority.
 */
const ALLOWED_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

export default function ProductsLayout({ children }: { children: ReactNode }) {
  requireAnyRole(ALLOWED_ROLES, "/crm");
  return <>{children}</>;
}
