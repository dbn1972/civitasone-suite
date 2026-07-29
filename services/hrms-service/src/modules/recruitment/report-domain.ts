/**
 * Assessment reporting domain (pure) — attendance, score distribution, cut-off
 * outcomes and item analysis (R-RA-0136). No I/O.
 */

export interface AttemptStat {
  status: string;          // assigned | in_progress | submitted | evaluated | expired | void
  result: string;          // pending | qualified | not_qualified | withheld
  disposition?: string;    // none | malpractice | ...
  totalScore?: number | null;
  maxScore?: number | null;
}

export interface Attendance {
  total: number; assigned: number; inProgress: number; evaluated: number;
  absent: number; voided: number;
}

/** Attendance breakdown across a schedule's attempts. */
export function attendanceStats(attempts: readonly AttemptStat[]): Attendance {
  const a: Attendance = { total: attempts.length, assigned: 0, inProgress: 0, evaluated: 0, absent: 0, voided: 0 };
  for (const t of attempts) {
    if (t.status === "void") { a.voided++; continue; }
    if (t.status === "assigned") { a.assigned++; a.absent++; }        // assigned but never started = absent
    else if (t.status === "in_progress") a.inProgress++;
    else if (t.status === "expired") a.absent++;
    else if (t.status === "submitted" || t.status === "evaluated") a.evaluated++;
  }
  return a;
}

export interface CutoffStats { qualified: number; notQualified: number; withheld: number; pending: number }

/** Qualified / not-qualified / withheld counts over non-void attempts. */
export function cutoffStats(attempts: readonly AttemptStat[]): CutoffStats {
  const c: CutoffStats = { qualified: 0, notQualified: 0, withheld: 0, pending: 0 };
  for (const t of attempts) {
    if (t.status === "void") continue;
    if (t.result === "qualified") c.qualified++;
    else if (t.result === "not_qualified") c.notQualified++;
    else if (t.result === "withheld") c.withheld++;
    else c.pending++;
  }
  return c;
}

export interface Bucket { label: string; min: number; max: number; count: number }

/**
 * Percentage-score histogram over evaluated, non-void attempts. `bucketPct`
 * (default 20) sets the band width; the top band is inclusive of 100.
 */
export function scoreDistribution(attempts: readonly AttemptStat[], bucketPct = 20): Bucket[] {
  const width = bucketPct > 0 && bucketPct <= 100 ? bucketPct : 20;
  const buckets: Bucket[] = [];
  for (let lo = 0; lo < 100; lo += width) {
    const hi = Math.min(100, lo + width);
    buckets.push({ label: `${lo}-${hi}%`, min: lo, max: hi, count: 0 });
  }
  for (const t of attempts) {
    if (t.status === "void") continue;
    if (t.totalScore == null || t.maxScore == null) continue; // not yet scored — Number(null) would be a misleading 0
    const max = Number(t.maxScore);
    const total = Number(t.totalScore);
    if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(total)) continue;
    const pct = Math.max(0, Math.min(100, (total / max) * 100));
    const idx = pct >= 100 ? buckets.length - 1 : Math.floor(pct / width);
    const b = buckets[Math.min(idx, buckets.length - 1)];
    if (b) b.count++;
  }
  return buckets;
}

export interface QuestionResponse { questionId: string; isCorrect: boolean | null; score: number | null }
export interface ItemStat {
  questionId: string; section: string; marks: number; qtype: string;
  attempted: number; correct: number; difficultyIndex: number | null; avgScore: number | null;
}

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * Per-question item analysis (R-RA-0136). `difficultyIndex` is the classic
 * p-value (fraction correct) for objective questions where correctness is known;
 * null for manual questions. `avgScore` is the mean awarded score.
 */
export function itemAnalysis(
  paper: ReadonlyArray<{ questionId: string; section: string; marks: number; qtype: string }>,
  responsesByQuestion: ReadonlyMap<string, readonly QuestionResponse[]>,
): ItemStat[] {
  return paper.map((q) => {
    const rs = responsesByQuestion.get(q.questionId) ?? [];
    const attempted = rs.length;
    const known = rs.filter((r) => r.isCorrect !== null);
    const correct = known.filter((r) => r.isCorrect === true).length;
    const scores = rs.map((r) => Number(r.score)).filter((n) => Number.isFinite(n));
    return {
      questionId: q.questionId, section: q.section, marks: q.marks, qtype: q.qtype,
      attempted, correct,
      difficultyIndex: known.length > 0 ? round2(correct / known.length) : null,
      avgScore: scores.length > 0 ? round2(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    };
  });
}
