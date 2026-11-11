/**
 * S8 G7 - project costing, pure domain (no I/O).
 *
 * Money is paise (bigint); percentages are integer hundredths of a percent
 * ("bps": 100.00% = 10_000), never floats. A slip's cost is spread over an
 * employee's allocation lines by calendar-day weights for the month, and every
 * amount is apportioned by largest remainder so the lines add up to the slip
 * to the paisa. Whatever share is not allocated lands on an explicit
 * `unallocated` line (target_type 'unallocated'), so reports always equal the
 * slips and the unallocated share is a visible exception list.
 */

export const FULL_BPS = 10_000;

export type TargetType = "project" | "cost_center";

export interface AllocationLine {
  id: string;
  targetType: TargetType;
  projectId: string | null;
  costCenterId: string | null;
  /** split_pct in hundredths of a percent (0 < bps <= 10_000). */
  bps: number;
  /** YYYY-MM-DD inclusive. */
  from: string;
  /** YYYY-MM-DD inclusive; null = open ended. */
  to: string | null;
}

export const COST_COMPONENTS = ["gross", "employerPf", "employerEsi", "employerNps", "otherEmployer"] as const;
export type CostComponent = (typeof COST_COMPONENTS)[number];
export type CostAmounts = Record<CostComponent, bigint>;

export const zeroAmounts = (): CostAmounts => ({ gross: 0n, employerPf: 0n, employerEsi: 0n, employerNps: 0n, otherEmployer: 0n });
export const totalOf = (a: CostAmounts): bigint => a.gross + a.employerPf + a.employerEsi + a.employerNps + a.otherEmployer;
export const addAmounts = (a: CostAmounts, b: CostAmounts): CostAmounts => ({
  gross: a.gross + b.gross, employerPf: a.employerPf + b.employerPf, employerEsi: a.employerEsi + b.employerEsi,
  employerNps: a.employerNps + b.employerNps, otherEmployer: a.otherEmployer + b.otherEmployer,
});
export const subAmounts = (a: CostAmounts, b: CostAmounts): CostAmounts => ({
  gross: a.gross - b.gross, employerPf: a.employerPf - b.employerPf, employerEsi: a.employerEsi - b.employerEsi,
  employerNps: a.employerNps - b.employerNps, otherEmployer: a.otherEmployer - b.otherEmployer,
});
export const isZero = (a: CostAmounts): boolean => COST_COMPONENTS.every((c) => a[c] === 0n);

/** NUMERIC(5,2) percentage -> integer hundredths. */
export function pctToBps(splitPct: number | string): number {
  return Math.round(Number(splitPct) * 100);
}

/** True when `splitPct` is within (0, 100] with at most 2 decimals. */
export function isValidSplitPct(splitPct: number): boolean {
  if (!Number.isFinite(splitPct) || splitPct <= 0 || splitPct > 100) return false;
  return Math.abs(splitPct * 100 - Math.round(splitPct * 100)) < 1e-6;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export const monthStart = (month: string): string => `${month}-01`;
export const monthEnd = (month: string): string => `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Closed ranges [aFrom,aTo] and [bFrom,bTo] (null to = open) overlap. */
export function rangesOverlap(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean {
  return (aTo === null || aTo >= bFrom) && (bTo === null || bTo >= aFrom);
}

/**
 * The highest total (in bps) that an employee's lines reach on any single day
 * of [from, to]. The total only changes on a line's start date, so it is enough
 * to evaluate the range start and every line start inside the range.
 */
export function peakAllocationBps(lines: Array<Pick<AllocationLine, "bps" | "from" | "to">>, from: string, to: string | null): number {
  const probes = new Set<string>([from]);
  for (const l of lines) if (l.from > from && (to === null || l.from <= to)) probes.add(l.from);
  let peak = 0;
  for (const d of probes) {
    let sum = 0;
    for (const l of lines) if (l.from <= d && (l.to === null || l.to >= d)) sum += l.bps;
    if (sum > peak) peak = sum;
  }
  return peak;
}

/**
 * Largest-remainder apportionment of `total` (>= 0) over `weights` out of
 * `denominator`. Returns one share per weight and the shares ALWAYS add up to
 * `total` when the weights add up to `denominator`; the caller appends the
 * unallocated remainder as the last weight. Ties go to the earlier index.
 */
export function apportion(total: bigint, weights: number[], denominator: number): bigint[] {
  if (total < 0n) throw new RangeError("apportion: total must be >= 0");
  if (denominator <= 0) throw new RangeError("apportion: denominator must be > 0");
  const d = BigInt(denominator);
  const shares = weights.map((w) => (total * BigInt(w)) / d);
  const rems = weights.map((w) => (total * BigInt(w)) % d);
  let left = total - shares.reduce((s, x) => s + x, 0n);
  const order = weights.map((_, i) => i).sort((a, b) => (rems[a]! === rems[b]! ? a - b : rems[a]! > rems[b]! ? -1 : 1));
  for (let k = 0; left > 0n && order.length > 0; k = (k + 1) % order.length, left -= 1n) shares[order[k]!]! += 1n;
  return shares;
}

export interface CostLine extends CostAmounts {
  lineKey: string;
  allocationId: string | null;
  targetType: TargetType | "unallocated";
  projectId: string | null;
  costCenterId: string | null;
  /** Effective day-weighted share of the month, in bps. */
  splitBps: number;
}

export const UNALLOCATED_KEY = "unallocated";

export function targetKey(l: { targetType: string; projectId: string | null; costCenterId: string | null }): string {
  return l.targetType === "unallocated" ? UNALLOCATED_KEY : `${l.targetType}:${l.projectId ?? "-"}:${l.costCenterId ?? "-"}`;
}

/**
 * Spread one slip's cost over the employee's allocation lines for `month`.
 * Lines are day-weighted (a line that covers 10 of 30 days at 50% weighs
 * 50% x 10/30), then merged by target so one project/cost-centre gets one line
 * per slip; the unallocated remainder is always the last line (omitted when 0).
 * Output is deterministic: lines sorted by (targetKey).
 */
export function splitSlipCost(amounts: CostAmounts, allocations: AllocationLine[], month: string): CostLine[] {
  const days = daysInMonth(month);
  const denominator = FULL_BPS * days;
  const perTarget = new Map<string, { line: Omit<CostLine, keyof CostAmounts | "splitBps" | "lineKey">; weight: number; firstId: string }>();

  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    for (const a of allocations) {
      if (a.from > date || (a.to !== null && a.to < date)) continue;
      const key = targetKey(a);
      const cur = perTarget.get(key);
      if (cur) { cur.weight += a.bps; if (a.id < cur.firstId) cur.firstId = a.id; }
      else perTarget.set(key, { line: { allocationId: a.id, targetType: a.targetType, projectId: a.projectId, costCenterId: a.costCenterId }, weight: a.bps, firstId: a.id });
    }
  }

  const targets = [...perTarget.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const allocatedWeight = targets.reduce((s, [, t]) => s + t.weight, 0);
  if (allocatedWeight > denominator) throw new RangeError("allocation lines exceed 100% on at least one day of the month");
  const weights = [...targets.map(([, t]) => t.weight), denominator - allocatedWeight];

  const parts = Object.fromEntries(COST_COMPONENTS.map((c) => [c, apportion(amounts[c], weights, denominator)])) as Record<CostComponent, bigint[]>;
  const out: CostLine[] = [];
  weights.forEach((w, i) => {
    if (w === 0) return;
    const isUnalloc = i === targets.length;
    const t = isUnalloc ? null : targets[i]![1];
    const line: CostLine = {
      lineKey: isUnalloc ? UNALLOCATED_KEY : targets[i]![0],
      allocationId: t ? t.firstId : null,
      targetType: isUnalloc ? "unallocated" : t!.line.targetType,
      projectId: t ? t.line.projectId : null,
      costCenterId: t ? t.line.costCenterId : null,
      splitBps: Math.round((w * FULL_BPS) / denominator),
      gross: parts.gross[i]!, employerPf: parts.employerPf[i]!, employerEsi: parts.employerEsi[i]!,
      employerNps: parts.employerNps[i]!, otherEmployer: parts.otherEmployer[i]!,
    };
    out.push(line);
  });
  return out;
}

export interface TargetIdentity {
  allocationId: string | null;
  targetType: TargetType | "unallocated";
  projectId: string | null;
  costCenterId: string | null;
}

/**
 * Back-dated reclassification: the difference between the split the CURRENT
 * allocations give for an already-costed slip and what is already booked
 * (run lines plus earlier reclass deltas), per target. The deltas of one slip
 * add up to zero per component. Returns only non-zero deltas, sorted by key.
 */
export function reclassDeltas(
  booked: Map<string, { identity: TargetIdentity; amounts: CostAmounts }>,
  expected: CostLine[],
): Array<{ lineKey: string; identity: TargetIdentity; delta: CostAmounts }> {
  const out: Array<{ lineKey: string; identity: TargetIdentity; delta: CostAmounts }> = [];
  const want = new Map(expected.map((l) => [l.lineKey, l]));
  const keys = [...new Set<string>([...booked.keys(), ...want.keys()])].sort();
  for (const k of keys) {
    const e = want.get(k);
    const b = booked.get(k);
    const delta = subAmounts(e ?? zeroAmounts(), b?.amounts ?? zeroAmounts());
    if (isZero(delta)) continue;
    const identity: TargetIdentity = e
      ? { allocationId: e.allocationId, targetType: e.targetType, projectId: e.projectId, costCenterId: e.costCenterId }
      : b!.identity;
    out.push({ lineKey: k, identity, delta });
  }
  return out;
}
