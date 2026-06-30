export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const CORRESPONDENCE_DIRECTIONS = ["incoming", "outgoing"] as const;
export type CorrespondenceDirection = (typeof CORRESPONDENCE_DIRECTIONS)[number];

export function assertValidDirection(v: string): asserts v is CorrespondenceDirection {
  if (!(CORRESPONDENCE_DIRECTIONS as readonly string[]).includes(v)) {
    throw new DomainError(
      "INVALID_DIRECTION",
      `direction must be one of: ${CORRESPONDENCE_DIRECTIONS.join(", ")}`,
    );
  }
}

/**
 * CSMOP page numbering — pure, append-only, STABLE.
 *
 * Page numbers on a file run continuously and are assigned at the moment a
 * correspondence is added. They are NEVER recomputed for existing entries when
 * later correspondence is appended: a new entry simply starts one past the
 * current highest page on the file.
 *
 * @param currentMaxPage highest page_to currently on the file (0 if none yet)
 * @param numPages       number of physical pages the new correspondence adds (>= 1)
 */
export function nextPageRange(
  currentMaxPage: number,
  numPages: number,
): { pageFrom: number; pageTo: number } {
  const pages = Math.max(1, Math.floor(numPages));
  const pageFrom = (currentMaxPage > 0 ? currentMaxPage : 0) + 1;
  const pageTo = pageFrom + pages - 1;
  return { pageFrom, pageTo };
}

/** Running correspondence number per file: "C-<count+1>". */
export function nextCorrNo(currentCount: number): string {
  return `C-${currentCount + 1}`;
}
