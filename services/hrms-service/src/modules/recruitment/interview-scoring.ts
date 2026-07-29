/**
 * Interview panel scoring engine (pure). A competency-weighted scorecard
 * (R-RA-0144), independent per-interviewer scoring, blind visibility until an
 * interviewer submits their own score (R-RA-0147), and weighted panel
 * consolidation with a cut-off (R-RA-0148). No I/O.
 */

export interface Competency {
  competency: string;
  weight: number;   // relative weight; normalised by the sum of weights
  maxScore: number; // per-competency maximum an interviewer may award
}

export interface InterviewerScore {
  interviewerId: string;
  scores: Record<string, number>; // competency -> awarded score
  comments?: string | null;
  submitted?: boolean;
}

export interface PanelResult {
  perCompetency: Record<string, number>; // panel average per competency
  weightedScore: number;                 // 0..100 normalised weighted score
  interviewerCount: number;              // number of submitted scores counted
  passed: boolean | null;                // vs cut-off (null when no cut-off set)
  recommendation: "strong_hire" | "hire" | "maybe" | "no_hire";
}

/** Panel average for a competency across the interviewers who scored it. */
export function competencyAverage(scores: InterviewerScore[], competency: string): number | null {
  const vals = scores.map((s) => s.scores[competency]).filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Map a 0..100 weighted score to a panel recommendation band. */
export function recommendationFromScore(weighted: number): PanelResult["recommendation"] {
  if (weighted >= 85) return "strong_hire";
  if (weighted >= 70) return "hire";
  if (weighted >= 50) return "maybe";
  return "no_hire";
}

/**
 * Consolidate submitted interviewer scores against the weighted scorecard.
 * weightedScore = Σ (panelAvg(c)/maxScore(c) · weight(c)) / Σ weight · 100,
 * over competencies that at least one interviewer scored.
 */
export function computePanelScore(
  template: Competency[], scores: InterviewerScore[], cutoff?: number | null,
): PanelResult {
  const submitted = scores.filter((s) => s.submitted !== false); // treat undefined as submitted for pure use
  const perCompetency: Record<string, number> = {};
  let weightedNumer = 0;
  let weightSum = 0;
  for (const t of template) {
    if (!(t.weight > 0) || !(t.maxScore > 0)) continue;
    const avg = competencyAverage(submitted, t.competency);
    if (avg === null) continue;
    perCompetency[t.competency] = avg;
    weightedNumer += (avg / t.maxScore) * t.weight;
    weightSum += t.weight;
  }
  const weightedScore = weightSum > 0 ? (weightedNumer / weightSum) * 100 : 0;
  const rounded = Math.round(weightedScore * 100) / 100;
  return {
    perCompetency,
    weightedScore: rounded,
    interviewerCount: submitted.length,
    passed: cutoff == null ? null : rounded >= cutoff,
    recommendation: recommendationFromScore(rounded),
  };
}

/**
 * Blind visibility (R-RA-0147): a panel member may not see other interviewers'
 * scores until they have submitted their own. Non-panel viewers (HR admin) and
 * panel members who have already submitted see everything.
 */
export function visibleScores<T extends { interviewerId: string; submitted?: boolean }>(
  scores: T[], viewerId: string, viewerIsPanelMember: boolean,
): { scores: T[]; blinded: boolean } {
  if (!viewerIsPanelMember) return { scores, blinded: false };
  const own = scores.find((s) => s.interviewerId === viewerId);
  if (own && own.submitted) return { scores, blinded: false };
  return { scores: own ? [own] : [], blinded: true };
}
