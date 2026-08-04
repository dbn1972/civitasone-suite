/**
 * Data-quality domain logic (DQ-004) — pure functions.
 *
 * Generalizes completeness scoring to contacts, leads and accounts, buckets the
 * scores into a distribution, and classifies each record by whether it has
 * missing-required, invalid-format or stale attributes. No DB / I/O.
 */
import {
  collectFormatViolations,
  CONTACT_FORMAT_SPECS,
  ACCOUNT_FORMAT_SPECS,
  type FormatFieldSpec,
} from "../contacts/format-validators.js";

export type DataQualityEntity = "contacts" | "leads" | "accounts";
export type DataQualityFilter = "missing" | "invalid" | "stale";

export interface FieldWeight {
  field: string;
  weight: number;
}

/** Weighted required fields per entity (weights sum to 100). */
export const COMPLETENESS_PROFILES: Record<DataQualityEntity, readonly FieldWeight[]> = {
  contacts: [
    { field: "name", weight: 20 },
    { field: "email", weight: 20 },
    { field: "phone", weight: 15 },
    { field: "company", weight: 15 },
    { field: "designation", weight: 10 },
    { field: "city", weight: 10 },
    { field: "leadSource", weight: 10 },
  ],
  leads: [
    { field: "name", weight: 20 },
    { field: "email", weight: 20 },
    { field: "phone", weight: 15 },
    { field: "company", weight: 15 },
    { field: "designation", weight: 10 },
    { field: "city", weight: 10 },
    { field: "leadSource", weight: 10 },
  ],
  accounts: [
    { field: "name", weight: 30 },
    { field: "industry", weight: 20 },
    { field: "website", weight: 20 },
    { field: "gstin", weight: 15 },
    { field: "pan", weight: 15 },
  ],
};

/** Format specs applied for "invalid" classification per entity. */
export const FORMAT_SPECS: Record<DataQualityEntity, readonly FormatFieldSpec[]> = {
  contacts: CONTACT_FORMAT_SPECS,
  leads: CONTACT_FORMAT_SPECS,
  accounts: ACCOUNT_FORMAT_SPECS,
};

export interface CompletenessResult {
  score: number;
  missingFields: string[];
  filledFields: string[];
  totalFields: number;
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

/** Weighted completeness for one record against a profile. */
export function computeCompletenessWith(
  attributes: Record<string, unknown>,
  weights: readonly FieldWeight[],
): CompletenessResult {
  const missingFields: string[] = [];
  const filledFields: string[] = [];
  let score = 0;
  for (const { field, weight } of weights) {
    if (present(attributes[field])) {
      filledFields.push(field);
      score += weight;
    } else {
      missingFields.push(field);
    }
  }
  return { score: Math.min(score, 100), missingFields, filledFields, totalFields: weights.length };
}

/** Distribution buckets over 0-100. */
export const BUCKETS = [
  { label: "0-20", min: 0, max: 20 },
  { label: "21-40", min: 21, max: 40 },
  { label: "41-60", min: 41, max: 60 },
  { label: "61-80", min: 61, max: 80 },
  { label: "81-100", min: 81, max: 100 },
] as const;

export function bucketFor(score: number): string {
  for (const b of BUCKETS) {
    if (score >= b.min && score <= b.max) return b.label;
  }
  return BUCKETS[BUCKETS.length - 1]!.label;
}

export function emptyDistribution(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of BUCKETS) out[b.label] = 0;
  return out;
}

/** Is a record stale — its last activity older than `staleDays`? */
export function isStale(
  lastActivityAt: Date | string | null | undefined,
  staleDays: number,
  now: Date = new Date(),
): boolean {
  if (!lastActivityAt) return true; // never touched → stale
  const ts = typeof lastActivityAt === "string" ? new Date(lastActivityAt) : lastActivityAt;
  if (Number.isNaN(ts.getTime())) return true;
  const ageMs = now.getTime() - ts.getTime();
  return ageMs > staleDays * 24 * 60 * 60 * 1000;
}

export interface RecordInput {
  id: string;
  attributes: Record<string, unknown>;
  lastActivityAt: Date | string | null | undefined;
}

export interface RecordClassification {
  id: string;
  score: number;
  hasMissing: boolean;
  hasInvalid: boolean;
  isStale: boolean;
}

/** Classify one record for the dashboard. */
export function classifyRecord(
  record: RecordInput,
  entity: DataQualityEntity,
  staleDays: number,
  now: Date = new Date(),
): RecordClassification {
  const completeness = computeCompletenessWith(record.attributes, COMPLETENESS_PROFILES[entity]);
  const violations = collectFormatViolations(record.attributes, FORMAT_SPECS[entity]);
  return {
    id: record.id,
    score: completeness.score,
    hasMissing: completeness.missingFields.length > 0,
    hasInvalid: violations.length > 0,
    isStale: isStale(record.lastActivityAt, staleDays, now),
  };
}

export interface DataQualityReport {
  entity: DataQualityEntity;
  total: number;
  distribution: Record<string, number>;
  counts: { missing: number; invalid: number; stale: number };
  filter: DataQualityFilter | null;
  filteredIds: string[];
}

/**
 * Build the full data-quality report over a set of records, optionally
 * returning the ids matching a `missing|invalid|stale` filter.
 */
export function buildReport(
  records: readonly RecordInput[],
  entity: DataQualityEntity,
  opts: { staleDays: number; filter?: DataQualityFilter | null; now?: Date; idLimit?: number },
): DataQualityReport {
  const now = opts.now ?? new Date();
  const distribution = emptyDistribution();
  const counts = { missing: 0, invalid: 0, stale: 0 };
  const filteredIds: string[] = [];
  const idLimit = opts.idLimit ?? 500;

  for (const rec of records) {
    const c = classifyRecord(rec, entity, opts.staleDays, now);
    distribution[bucketFor(c.score)] = (distribution[bucketFor(c.score)] ?? 0) + 1;
    if (c.hasMissing) counts.missing++;
    if (c.hasInvalid) counts.invalid++;
    if (c.isStale) counts.stale++;

    if (opts.filter && filteredIds.length < idLimit) {
      const match =
        (opts.filter === "missing" && c.hasMissing) ||
        (opts.filter === "invalid" && c.hasInvalid) ||
        (opts.filter === "stale" && c.isStale);
      if (match) filteredIds.push(c.id);
    }
  }

  return {
    entity,
    total: records.length,
    distribution,
    counts,
    filter: opts.filter ?? null,
    filteredIds,
  };
}
