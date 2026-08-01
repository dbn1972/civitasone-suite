/**
 * collateral/domain.ts — CR-AI-02 pure validation and ordering for collateral links.
 * No IO: ordering must be reproducible so the rep sees the same deck twice.
 */

export type CollateralType = "document" | "video" | "brochure" | "case_study" | "pricing_sheet";

export const COLLATERAL_TYPES: readonly CollateralType[] = [
  "document",
  "video",
  "brochure",
  "case_study",
  "pricing_sheet",
];

export const MAX_REF_LENGTH = 512;
export const MAX_TITLE_LENGTH = 256;

export function isCollateralType(value: string): value is CollateralType {
  return (COLLATERAL_TYPES as readonly string[]).includes(value);
}

export interface CollateralInput {
  collateralType: string;
  collateralRef: string;
  title: string;
  ordinal?: number | undefined;
}

/** Returns null when valid, otherwise a human message for a 422 response. */
export function validateCollateral(input: CollateralInput): string | null {
  if (!isCollateralType(input.collateralType)) {
    return `unknown collateralType: ${String(input.collateralType)}`;
  }

  if (typeof input.collateralRef !== "string" || input.collateralRef.trim().length === 0) {
    return "collateralRef is required";
  }
  if (input.collateralRef.trim().length > MAX_REF_LENGTH) {
    return `collateralRef must not exceed ${MAX_REF_LENGTH} characters`;
  }

  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    return "title is required";
  }
  if (input.title.trim().length > MAX_TITLE_LENGTH) {
    return `title must not exceed ${MAX_TITLE_LENGTH} characters`;
  }

  if (input.ordinal !== undefined) {
    if (!Number.isInteger(input.ordinal) || input.ordinal < 0) {
      return "ordinal must be a non-negative integer";
    }
  }

  return null;
}

/**
 * Next free ordinal for a recommendation: one past the current maximum, so an
 * attach without an explicit ordinal always lands at the end of the deck.
 */
export function nextOrdinal(existing: readonly { ordinal: number }[]): number {
  let max = -1;
  for (const link of existing) {
    if (Number.isFinite(link.ordinal) && link.ordinal > max) max = link.ordinal;
  }
  return max + 1;
}

/**
 * Order a deck: ordinal ascending, then id ascending. The id tie-break keeps the
 * order identical across calls when two links share an ordinal (which is legal
 * — there is no unique constraint on ordinal).
 */
export function sortByOrdinal<T extends { ordinal: number; id: string }>(links: readonly T[]): T[] {
  return [...links].sort((a, b) => {
    const byOrdinal = (Number.isFinite(a.ordinal) ? a.ordinal : 0) - (Number.isFinite(b.ordinal) ? b.ordinal : 0);
    if (byOrdinal !== 0) return byOrdinal;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
