/**
 * steward/quality-domain.ts — CDP-010 data-quality scoring (PURE).
 *
 * A golden profile is only as useful as the attributes it can be reached and segmented
 * on, so quality is scored against what the profile is FOR rather than against a field
 * count. Weights reflect reachability: without a phone or a name the profile cannot be
 * contacted or addressed, and no amount of secondary detail compensates.
 *
 * Weights sum to 100 so the score is directly readable as a percentage.
 */

export interface AttributeWeight {
  field: string;
  weight: number;
}

export const REQUIRED_ATTRIBUTES: readonly AttributeWeight[] = [
  { field: "name", weight: 25 },
  { field: "phone", weight: 25 },
  { field: "email", weight: 20 },
  { field: "city", weight: 15 },
  { field: "language", weight: 10 },
  { field: "preferredChannel", weight: 5 },
];

/**
 * A verified attribute older than this is treated as stale. Six months matches the
 * cadence at which citizens change phone numbers and addresses in practice; a stale
 * value is not absent, so it still earns partial credit.
 */
export const STALE_AFTER_DAYS = 180;
const STALE_CREDIT = 0.5;
const MS_PER_DAY = 86_400_000;

export interface ProfileQuality {
  score: number;
  missingFields: string[];
  staleFields: string[];
}

/** A value counts as present only when it carries information — "" and "   " do not. */
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Verification stamps are read from `<field>VerifiedAt`, falling back to a
 * profile-wide `verifiedAt`. An unparseable or absent stamp is NOT treated as stale:
 * "we never recorded when this was checked" is a metadata gap, and penalising it would
 * make every legacy profile look wrong.
 */
function verifiedAt(attributes: Record<string, unknown>, field: string): Date | null {
  const candidates = [attributes[`${field}VerifiedAt`], attributes.verifiedAt];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export function isStale(stamp: Date, now: Date): boolean {
  return now.getTime() - stamp.getTime() > STALE_AFTER_DAYS * MS_PER_DAY;
}

/**
 * Score a profile's attribute bag out of 100 and report which required attributes are
 * missing or overdue re-verification.
 */
export function computeProfileQuality(
  attributes: Record<string, unknown>,
  now: Date = new Date(),
): ProfileQuality {
  const missingFields: string[] = [];
  const staleFields: string[] = [];
  let earned = 0;

  for (const { field, weight } of REQUIRED_ATTRIBUTES) {
    if (!isPresent(attributes[field])) {
      missingFields.push(field);
      continue;
    }

    const stamp = verifiedAt(attributes, field);
    if (stamp !== null && isStale(stamp, now)) {
      staleFields.push(field);
      earned += weight * STALE_CREDIT;
      continue;
    }

    earned += weight;
  }

  return { score: Math.round(earned), missingFields, staleFields };
}

export const QUALITY_BUCKETS = ["0-25", "26-50", "51-75", "76-100"] as const;
export type QualityBucket = (typeof QUALITY_BUCKETS)[number];

/** Map a 0..100 score onto the reporting bands. Out-of-range input is clamped. */
export function bucketOf(score: number): QualityBucket {
  const clamped = Math.min(100, Math.max(0, score));
  if (clamped <= 25) return "0-25";
  if (clamped <= 50) return "26-50";
  if (clamped <= 75) return "51-75";
  return "76-100";
}

export interface QualitySummary {
  total: number;
  buckets: Record<QualityBucket, number>;
  averageScore: number;
  topMissingFields: Array<{ field: string; count: number }>;
}

/**
 * Aggregate per-profile quality into tenant-level bands.
 * `topMissingFields` is what makes the summary actionable: it names the remediation a
 * steward should run rather than just how bad things are.
 */
export function summarizeQuality(profiles: Array<Record<string, unknown>>, now: Date = new Date()): QualitySummary {
  const buckets: Record<QualityBucket, number> = { "0-25": 0, "26-50": 0, "51-75": 0, "76-100": 0 };
  const missingCounts = new Map<string, number>();
  let scoreTotal = 0;

  for (const attributes of profiles) {
    const quality = computeProfileQuality(attributes, now);
    buckets[bucketOf(quality.score)]++;
    scoreTotal += quality.score;
    for (const field of quality.missingFields) {
      missingCounts.set(field, (missingCounts.get(field) ?? 0) + 1);
    }
  }

  const topMissingFields = [...missingCounts.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => (b.count - a.count) || a.field.localeCompare(b.field));

  return {
    total: profiles.length,
    buckets,
    averageScore: profiles.length === 0 ? 0 : Math.round(scoreTotal / profiles.length),
    topMissingFields,
  };
}
