/**
 * GAP-CRM-RTI-NEW-04 (owner decision C7, 2026-11-26): the RTI public-authority list is
 *   the distinct departmentRef values already in the tenant's RTI register
 *   + the 7 built-in central bodies
 * with NO new table. A state department therefore appears the first time a request names it.
 * Pure merge logic lives here (unit-testable); the register read is in rti-repo.ts.
 */

/** The built-in central bodies (mirrors RTI_PUBLIC_AUTHORITIES in the web's rtiAuthorities.ts). */
export const BUILT_IN_RTI_AUTHORITIES: readonly string[] = [
  "Ministry of Finance",
  "Department of Revenue",
  "Ministry of Home Affairs",
  "Ministry of Health & Family Welfare",
  "Ministry of Education",
  "Department of Posts",
  "UIDAI",
];

export interface RtiAuthority {
  name: string;
  source: "built_in" | "register";
}

/** Trim + collapse inner whitespace so equivalent spellings fold to one entry. */
export function normaliseAuthorityName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Merge built-ins with the register's distinct departments. De-duplicated case-insensitively;
 * a register value that equals a built-in (any casing) is shown ONCE under the built-in's
 * canonical spelling. Blank values are dropped. Order: built-ins first (fixed order), then
 * register departments alphabetically.
 */
export function mergeAuthorities(registerDepartments: readonly string[]): RtiAuthority[] {
  const out: RtiAuthority[] = BUILT_IN_RTI_AUTHORITIES.map((name) => ({ name, source: "built_in" as const }));
  const seen = new Set(out.map((a) => a.name.toLowerCase()));
  const extra: string[] = [];
  for (const raw of registerDepartments) {
    const name = normaliseAuthorityName(raw);
    if (name === "" || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    extra.push(name);
  }
  extra.sort((a, b) => a.localeCompare(b));
  return [...out, ...extra.map((name) => ({ name, source: "register" as const }))];
}
