/**
 * GAP-FINANCE-AUDIT-PARAS-05: the per-row "Respond" action of the audit-para register. It is a link
 * to the para's detail page (where the reply is recorded: GAP-FINANCE-AUDIT-PARAS-DETAIL-04), never
 * an inline mutation. Offered only where finance-service accepts a reply -- from "open" or
 * "escalated" (the respond transition's source states) -- and only to roles that may record one.
 */
export const AUDIT_PARA_RESPOND_ROLES = ["finance_officer", "finance_admin", "super_admin"] as const;

export function respondHref(id: string, status: string | null | undefined, canRespond: boolean): string | null {
  const s = (status ?? "").trim().toLowerCase();
  if (!canRespond || !id || (s !== "open" && s !== "escalated")) return null;
  return `/finance/audit-paras/${encodeURIComponent(id)}`;
}
