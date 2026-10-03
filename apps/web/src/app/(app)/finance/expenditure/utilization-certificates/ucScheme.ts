/**
 * GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-05: a utilization certificate stores the scheme
 * it was raised against as free text (the scheme NAME chosen on the New UC form, saved as the
 * UC's grant reference and grantee). The scheme detail page links to the UC register filtered by
 * that name; these helpers build the link and apply the filter.
 */
export const UC_REGISTER_PATH = "/finance/expenditure/utilization-certificates";

export function ucRegisterHref(schemeName: string): string {
  return `${UC_REGISTER_PATH}?scheme=${encodeURIComponent(schemeName)}`;
}

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

/** True when the UC belongs to the scheme (case-insensitive match on its grant reference or grantee). */
export function ucMatchesScheme(uc: { grantRef?: string | null; grantee?: string | null }, scheme: string | undefined): boolean {
  const s = norm(scheme);
  if (!s) return true;
  return norm(uc.grantRef) === s || norm(uc.grantee) === s;
}
