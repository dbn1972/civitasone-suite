/**
 * Contractor domain rules.
 * Pure functions — no I/O, no framework dependencies.
 */

export const RATING_MIN = 1;
export const RATING_MAX = 5;

export function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= RATING_MIN && rating <= RATING_MAX;
}

export function ratingBand(rating: number): string {
  if (rating >= 4.5) return 'excellent';
  if (rating >= 3.5) return 'good';
  if (rating >= 2.5) return 'average';
  if (rating >= 1.5) return 'below_average';
  return 'poor';
}

export function isEligibleForWork(
  performanceRating: number | null,
  minRatingForCategory = 2,
): boolean {
  if (performanceRating === null) return true;
  return performanceRating >= minRatingForCategory;
}
