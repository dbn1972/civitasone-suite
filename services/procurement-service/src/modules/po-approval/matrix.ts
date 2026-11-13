/**
 * M10: the local PO approval threshold matrix, for a tenant without the Finance
 * module (no sanction to cite, no finance-service call).
 *
 * A matrix is an ordered list of value bands. Each band says which roles may
 * approve a purchase order whose total is at or below the band's upper limit
 * (inclusive, in paise); the last band has no limit. A PO falls in the FIRST band
 * that contains its total. super_admin may always approve, like everywhere else
 * on the platform. Pure: no I/O.
 *
 * The maker-checker rule is separate and unconditional (the approver is never
 * the PO's creator): po/domain.ts assertDistinctMakerChecker.
 */

/** Roles a band may name: the procurement approvers. */
export const APPROVER_ROLES = ["procurement_officer", "procurement_admin", "super_admin"] as const;
export const MAX_BANDS = 10;

export interface MatrixBand {
  /** Inclusive upper limit in paise; null = no limit (the last band only). */
  upToMinor: bigint | null;
  approverRoles: string[];
}

/** Used until a tenant configures its own: up to Rs 50,000 an officer or admin, up to Rs 10 lakh an admin, above that a super admin. */
export const DEFAULT_MATRIX: readonly MatrixBand[] = [
  { upToMinor: 5_000_000n, approverRoles: ["procurement_officer", "procurement_admin"] },
  { upToMinor: 100_000_000n, approverRoles: ["procurement_admin"] },
  { upToMinor: null, approverRoles: ["super_admin"] },
];

/** Human-readable problems with a matrix; an empty list means valid. */
export function validateMatrix(bands: readonly MatrixBand[]): string[] {
  const errors: string[] = [];
  if (bands.length === 0) return ["the matrix needs at least one band"];
  if (bands.length > MAX_BANDS) errors.push(`at most ${MAX_BANDS} bands`);
  let prev = 0n;
  bands.forEach((b, i) => {
    const n = i + 1;
    const last = i === bands.length - 1;
    if (last) {
      if (b.upToMinor !== null) errors.push(`band ${n} (the last) must have no upper limit, so every purchase order falls in a band`);
    } else if (b.upToMinor === null) {
      errors.push(`band ${n}: only the last band may have no upper limit`);
    } else if (b.upToMinor <= prev) {
      errors.push(`band ${n}: the limit must be above the previous band's limit`);
    }
    if (b.upToMinor !== null) prev = b.upToMinor;
    if (b.approverRoles.length === 0) errors.push(`band ${n}: name at least one approver role`);
    for (const r of b.approverRoles) if (!(APPROVER_ROLES as readonly string[]).includes(r)) errors.push(`band ${n}: "${r}" is not a procurement approver role`);
    if (new Set(b.approverRoles).size !== b.approverRoles.length) errors.push(`band ${n}: a role is listed twice`);
  });
  return errors;
}

/** The band a PO total falls in (the first whose limit it does not exceed). */
export function bandFor(totalMinor: bigint, bands: readonly MatrixBand[]): MatrixBand {
  return bands.find((b) => b.upToMinor === null || totalMinor <= b.upToMinor) ?? bands[bands.length - 1]!;
}

export interface ApprovalDecision {
  ok: boolean;
  band: MatrixBand;
  /** The roles that may approve this PO (super_admin is always implied). */
  requiredRoles: string[];
}

export function approvalDecision(totalMinor: bigint, approverRoles: readonly string[], bands: readonly MatrixBand[]): ApprovalDecision {
  const band = bandFor(totalMinor, bands);
  const ok = approverRoles.includes("super_admin") || band.approverRoles.some((r) => approverRoles.includes(r));
  return { ok, band, requiredRoles: band.approverRoles.includes("super_admin") ? band.approverRoles : [...band.approverRoles, "super_admin"] };
}

/** Wire form: limits as paise digit strings. */
export const wireBands = (bands: readonly MatrixBand[]): Array<{ upToMinor: string | null; approverRoles: string[] }> =>
  bands.map((b) => ({ upToMinor: b.upToMinor === null ? null : b.upToMinor.toString(), approverRoles: [...b.approverRoles] }));
