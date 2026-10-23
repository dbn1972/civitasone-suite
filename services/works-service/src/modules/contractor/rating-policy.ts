/**
 * GAP-WORKS-CONTRACTORS-DETAIL-04: the cooling-off period between two ratings of the same contractor by the same
 * officer. The length is a POLICY value that is not in the repository, so it is configuration, not code:
 * WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS (whole days). Unset, empty, zero, negative or not a whole number means "no
 * cooldown": nothing is blocked and the web shows no warning until an owner sets a value.
 */
const MAX_COOLDOWN_DAYS = 3650;

export function ratingCooldownDays(env: Record<string, string | undefined> = process.env): number {
  const raw = env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const days = Number(raw);
  return days > 0 && days <= MAX_COOLDOWN_DAYS ? days : 0;
}

/** True when `lastRatedAt` is less than `days` days before `now` (days <= 0 never blocks). */
export function isWithinRatingCooldown(lastRatedAt: Date | string, now: Date, days: number): boolean {
  if (days <= 0) return false;
  const last = new Date(lastRatedAt).getTime();
  if (Number.isNaN(last)) return false;
  return now.getTime() - last < days * 24 * 60 * 60 * 1000;
}
