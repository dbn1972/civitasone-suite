/**
 * A utilization certificate is raised against a scheme chosen from Scheme Tracking (GAP-FINANCE-EXPENDITURE-
 * UTILIZATION-CERTIFICATES-NEW-03), and the certificate stores that scheme's CODE -- unique per office, unlike a name.
 * The scheme detail page links to the UC register filtered by that code (GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-
 * DETAIL-05); these helpers build the link and apply the filter.
 *
 * Certificates raised before the code was stored carry the scheme only as free text (the scheme NAME, saved as the grant
 * reference and grantee), so for those the filter keeps matching on the name.
 */
export const UC_REGISTER_PATH = "/finance/expenditure/utilization-certificates";

/** The scheme a register view is narrowed to: its code, plus its name when known (for older, name-only certificates). */
export type UcSchemeRef = { code: string; name?: string | null };

/** Link to the UC register narrowed to one scheme. Pass the scheme's CODE. */
export function ucRegisterHref(schemeCode: string): string {
  return `${UC_REGISTER_PATH}?scheme=${encodeURIComponent(schemeCode)}`;
}

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

/**
 * Turn the `?scheme=` value into a scheme reference using the office's schemes: a code matches by code (case-insensitive),
 * otherwise a name that picks out exactly one scheme matches by name (an older link or bookmark carried the name). Anything
 * else -- or schemes that could not be loaded -- is used as given, as both code and name, so the filter never silently
 * widens to every certificate.
 */
export function resolveSchemeRef(param: string, schemes: ReadonlyArray<{ code: string; name: string }> | null): UcSchemeRef {
  const p = norm(param);
  const byCode = schemes?.find((s) => norm(s.code) === p);
  if (byCode) return { code: byCode.code, name: byCode.name };
  const byName = schemes?.filter((s) => norm(s.name) === p) ?? [];
  if (byName.length === 1) return { code: byName[0]!.code, name: byName[0]!.name };
  return { code: param, name: param };
}

/**
 * True when the UC belongs to the scheme. A certificate that stores a scheme code belongs to exactly that scheme.
 * One that does not (raised before the code was stored) is matched, case-insensitively, on its grant reference or
 * grantee against the scheme's name or code.
 */
export function ucMatchesScheme(
  uc: { schemeCode?: string | null; grantRef?: string | null; grantee?: string | null },
  scheme: string | UcSchemeRef | undefined,
): boolean {
  const ref: UcSchemeRef | undefined = typeof scheme === "string" ? { code: scheme, name: scheme } : scheme;
  const code = norm(ref?.code);
  if (!code) return true;
  if (norm(uc.schemeCode)) return norm(uc.schemeCode) === code;
  const names = [code, norm(ref?.name)].filter(Boolean);
  return names.includes(norm(uc.grantRef)) || names.includes(norm(uc.grantee));
}
