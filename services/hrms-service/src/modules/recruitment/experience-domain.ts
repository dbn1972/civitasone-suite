/**
 * Experience-validation domain (pure) — total/relevant duration, overlaps and gaps
 * against a job's requirement (R-RA-0108). All dates are ISO 'YYYY-MM-DD'; an open
 * (current) job passes `to: null` and is measured to `nowMs`. No I/O.
 */

const MS_PER_YEAR = 365.25 * 86_400_000;
const MS_PER_MONTH = MS_PER_YEAR / 12;

export interface Employment {
  employer: string;
  role?: string;
  from: string;              // ISO date
  to?: string | null;        // ISO date or null = current
  relevant?: boolean;        // counts toward relevant experience
}

interface Interval { fromMs: number; toMs: number; employer: string; relevant: boolean }

function toIntervals(history: readonly Employment[], nowMs: number): { intervals: Interval[]; invalid: string[] } {
  const intervals: Interval[] = [];
  const invalid: string[] = [];
  for (const e of history) {
    const fromMs = Date.parse(e.from);
    const toMs = e.to ? Date.parse(e.to) : nowMs;
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) { invalid.push(`${e.employer}: invalid dates`); continue; }
    if (toMs < fromMs) { invalid.push(`${e.employer}: end date precedes start date`); continue; }
    intervals.push({ fromMs, toMs, employer: e.employer, relevant: e.relevant === true });
  }
  return { intervals, invalid };
}

interface MergedSegment { fromMs: number; toMs: number; startEmployer: string; endEmployer: string }

/**
 * Merge overlapping/adjacent intervals so overlapping employment isn't double
 * counted, tracking the employer that forms each segment's start and end boundary
 * (so gap labelling is exact even when two employments share a boundary date).
 */
function mergeIntervals(ranges: readonly Interval[]): MergedSegment[] {
  const sorted = [...ranges].sort((a, b) => a.fromMs - b.fromMs);
  const out: MergedSegment[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.fromMs <= last.toMs) {
      if (r.toMs > last.toMs) { last.toMs = r.toMs; last.endEmployer = r.employer; }
    } else {
      out.push({ fromMs: r.fromMs, toMs: r.toMs, startEmployer: r.employer, endEmployer: r.employer });
    }
  }
  return out;
}

/** Total covered milliseconds across merged segments (raw, for exact comparison). */
function sumMs(segments: readonly MergedSegment[]): number {
  return segments.reduce((a, s) => a + (s.toMs - s.fromMs), 0);
}
const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface OverlapPair { a: string; b: string }
export interface Gap { afterEmployer: string; beforeEmployer: string; months: number }

export interface ExperienceRequirement {
  minTotalYears?: number;
  minRelevantYears?: number;
  maxGapMonths?: number;     // flag gaps longer than this
}

export interface ExperienceResult {
  totalYears: number;
  relevantYears: number;
  overlaps: OverlapPair[];
  gaps: Gap[];
  invalid: string[];
  meetsTotal: boolean;
  meetsRelevant: boolean;
  gapsWithinLimit: boolean;
  eligible: boolean;
}

/**
 * Validate an employment history against an experience requirement:
 *  - total experience = union of all periods (overlaps merged, not double-counted);
 *  - relevant experience = union of the periods flagged relevant;
 *  - overlaps = pairs of employments whose periods intersect (reported for scrutiny);
 *  - gaps = unemployed stretches between consecutive (merged) periods.
 */
export function validateExperience(history: readonly Employment[], req: ExperienceRequirement, nowMs: number): ExperienceResult {
  const { intervals, invalid } = toIntervals(history, nowMs);

  // Compare against RAW milliseconds; round only for the display payload — else a
  // candidate ~18 days short of a 5-year minimum would round to 5.0 and pass.
  const totalMs = sumMs(mergeIntervals(intervals));
  const relevantMs = sumMs(mergeIntervals(intervals.filter((i) => i.relevant)));
  const totalYears = round1(totalMs / MS_PER_YEAR);
  const relevantYears = round1(relevantMs / MS_PER_YEAR);

  // overlap pairs (on the original, un-merged intervals)
  const overlaps: OverlapPair[] = [];
  const byStart = [...intervals].sort((a, b) => a.fromMs - b.fromMs);
  for (let i = 0; i < byStart.length; i++) {
    for (let j = i + 1; j < byStart.length; j++) {
      if (byStart[j]!.fromMs < byStart[i]!.toMs) overlaps.push({ a: byStart[i]!.employer, b: byStart[j]!.employer });
      else break; // sorted by start; no later interval can overlap this one's start-ordered scan
    }
  }

  // gaps between merged periods (labels come straight from the merge)
  const merged = mergeIntervals(intervals);
  const maxGap = req.maxGapMonths ?? Infinity;
  const gaps: Gap[] = [];
  let gapsWithinLimit = true;
  for (let i = 1; i < merged.length; i++) {
    const rawMonths = (merged[i]!.fromMs - merged[i - 1]!.toMs) / MS_PER_MONTH;
    if (rawMonths > 0.5) {
      gaps.push({ afterEmployer: merged[i - 1]!.endEmployer, beforeEmployer: merged[i]!.startEmployer, months: round1(rawMonths) });
      if (rawMonths > maxGap) gapsWithinLimit = false;   // raw comparison, not the rounded display value
    }
  }

  const meetsTotal = req.minTotalYears == null || totalMs >= req.minTotalYears * MS_PER_YEAR;
  const meetsRelevant = req.minRelevantYears == null || relevantMs >= req.minRelevantYears * MS_PER_YEAR;

  return {
    totalYears, relevantYears, overlaps, gaps, invalid,
    meetsTotal, meetsRelevant, gapsWithinLimit,
    eligible: invalid.length === 0 && meetsTotal && meetsRelevant && gapsWithinLimit,
  };
}
