/**
 * PC-001 — governed product version state machine + maker-checker rule. PURE.
 *
 * Status values are taken verbatim from the CHECK constraint in migration 0004:
 *   CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected'))
 */

export const PRODUCT_VERSION_STATUSES = ["draft", "pending_approval", "approved", "rejected"] as const;
export type ProductVersionStatus = (typeof PRODUCT_VERSION_STATUSES)[number];

const VERSION_TRANSITIONS: Record<ProductVersionStatus, readonly ProductVersionStatus[]> = {
  // A draft is submitted for approval.
  draft: ["pending_approval"],
  // A checker either approves or rejects.
  pending_approval: ["approved", "rejected"],
  // Approved is terminal — corrections happen by opening a new version.
  approved: [],
  // A rejected version may be reworked and resubmitted.
  rejected: ["pending_approval"],
};

/** Minimum characters required in a rejection reason (audit quality floor). */
export const MIN_REJECTION_REASON_LENGTH = 10;

export function isProductVersionStatus(s: string): s is ProductVersionStatus {
  return (PRODUCT_VERSION_STATUSES as readonly string[]).includes(s);
}

export interface VersionTransitionCheck {
  valid: boolean;
  reason?: string;
}

export function validateVersionTransition(from: string, to: string): VersionTransitionCheck {
  if (!isProductVersionStatus(from)) return { valid: false, reason: `Unknown current version status: ${from}` };
  if (!isProductVersionStatus(to)) return { valid: false, reason: `Unknown target version status: ${to}` };
  if (from === to) return { valid: false, reason: `Version is already '${to}'` };
  if (!VERSION_TRANSITIONS[from].includes(to)) {
    return { valid: false, reason: `Cannot transition version from '${from}' to '${to}'` };
  }
  return { valid: true };
}

/**
 * Maker-checker (separation of duties, GFR 2017 / repo steering).
 *
 * The actor who created a version may never be the actor who approves or rejects
 * it. Returns a failure the route maps to 422 — not 403, because the caller does
 * hold the role; the business rule is what forbids the action.
 */
export function checkMakerChecker(makerId: string, checkerId: string): VersionTransitionCheck {
  if (makerId === checkerId) {
    return { valid: false, reason: "Maker-checker violation: the version's creator cannot approve or reject it" };
  }
  return { valid: true };
}

/** Next version number for a product given its existing version numbers. */
export function nextVersionNumber(existing: readonly number[]): number {
  return existing.reduce((max, n) => (n > max ? n : max), 0) + 1;
}
