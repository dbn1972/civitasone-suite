/**
 * Approval Matrix — pure domain logic.
 *
 * Implements approval-matrix-by-value resolution for contracts.
 * Up to 5 threshold levels, each defining a minimum contract value (paise) and required role.
 *
 * The resolution function finds the highest level where contractValue >= minValuePaise.
 */

/** Maximum number of approval levels per tenant */
export const MAX_APPROVAL_LEVELS = 5;

export interface ApprovalLevel {
  minValuePaise: bigint;
  requiredRole: string;
}

/**
 * Resolve the appropriate approval level for a given contract value.
 * Finds the level with the highest minValuePaise that is <= contractValue.
 *
 * @param contractValue - Contract value in paise (bigint)
 * @param levels - Array of approval levels (unsorted input accepted)
 * @returns The matching ApprovalLevel, or null if no level matches (contract value below all thresholds)
 */
export function resolveApprovalLevel(contractValue: bigint, levels: ApprovalLevel[]): ApprovalLevel | null {
  if (levels.length === 0) return null;

  // Sort levels by minValuePaise descending to find the highest qualifying level first
  const sorted = [...levels].sort((a, b) => {
    if (a.minValuePaise > b.minValuePaise) return -1;
    if (a.minValuePaise < b.minValuePaise) return 1;
    return 0;
  });

  // Find the first (highest) level where contractValue >= minValuePaise
  for (const level of sorted) {
    if (contractValue >= level.minValuePaise) {
      return level;
    }
  }

  return null;
}

export class ApprovalDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ApprovalDomainError";
  }
}
