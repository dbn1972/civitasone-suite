/**
 * GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-06: interview scorecards for ONE application (pure assembly).
 *
 * Visibility is exactly the per-interview rule of GET /v1/hrms/interviews/:id/scores and /panel-result
 * (R-RA-0147 blind scoring), applied to every interview of the application:
 *   - the caller must be on that interview's panel or hold an HR role, otherwise the interview is omitted;
 *   - a panel member (even one who also holds an HR role) sees no other interviewer's score, and no
 *     consolidated panel score / recommendation, until they have submitted their own;
 *   - a pure HR reviewer sees everything.
 * Interviewer ids are replaced by names (never a raw id); an unresolved id becomes "Panel member N".
 */
import { visibleScores } from "./interview-scoring.js";

export interface ScorecardInterview {
  id: string; roundNumber: number; roundType: string; scheduledDate: string; status: string;
  panelMembers: unknown; scorecardTemplate: unknown; cutoffScore: number | null; panelScore: number | null;
  recommendation: string | null; consolidatedAt: Date | string | null;
}
export interface ScorecardScore {
  interviewId: string; interviewerId: string; scores: Record<string, number>; overallScore: number | null;
  comments: string | null; submitted: boolean; submittedAt: Date | string | null;
}

/** Panel-member user ids from the loosely typed panel_members jsonb (mirrors interview-scoring-routes). */
export function panelMemberIds(panel: unknown): Set<string> {
  const ids = new Set<string>();
  if (Array.isArray(panel)) {
    for (const m of panel) {
      if (typeof m === "string") ids.add(m);
      else if (m && typeof m === "object") {
        const o = m as Record<string, unknown>;
        for (const k of ["id", "userId", "memberId", "employeeId", "actorId"]) if (typeof o[k] === "string") ids.add(o[k] as string);
      }
    }
  }
  return ids;
}

export interface ScorecardView {
  interviewId: string; roundNumber: number; roundType: string; scheduledDate: string; status: string;
  competencies: unknown[]; cutoffScore: number | null; consolidated: boolean;
  /** null while blinded for this viewer. */
  panelScore: number | null; recommendation: string | null;
  blinded: boolean; submittedCount: number; panelSize: number;
  scores: Array<{ interviewer: string; scores: Record<string, number>; overallScore: number | null; comments: string | null; submittedAt: string | null }>;
}

export function buildScorecards(
  interviews: ScorecardInterview[], allScores: ScorecardScore[],
  viewer: { actorId: string; isHr: boolean }, names: Map<string, string>,
): ScorecardView[] {
  const out: ScorecardView[] = [];
  for (const iv of interviews) {
    const panel = panelMemberIds(iv.panelMembers);
    const isPanel = panel.has(viewer.actorId);
    if (!isPanel && !viewer.isHr) continue;
    const mine = allScores.filter((s) => s.interviewId === iv.id);
    const { scores, blinded } = visibleScores(mine.map((s) => ({ ...s })), viewer.actorId, isPanel);
    // Stable anonymous labels for interviewers whose name cannot be resolved.
    // Numbered over the SORTED ids so the label never depends on row order.
    const label = new Map<string, string>();
    for (const id of [...new Set(mine.map((s) => s.interviewerId))].sort()) {
      label.set(id, names.get(id) ?? `Panel member ${label.size + 1}`);
    }
    out.push({
      interviewId: iv.id, roundNumber: iv.roundNumber, roundType: iv.roundType,
      scheduledDate: iv.scheduledDate, status: iv.status,
      competencies: Array.isArray(iv.scorecardTemplate) ? iv.scorecardTemplate : [],
      cutoffScore: iv.cutoffScore ?? null, consolidated: !!iv.consolidatedAt,
      panelScore: blinded ? null : iv.panelScore ?? null,
      recommendation: blinded ? null : iv.recommendation ?? null,
      blinded, submittedCount: mine.filter((s) => s.submitted).length, panelSize: panel.size,
      scores: scores.filter((s) => s.submitted).map((s) => ({
        interviewer: label.get(s.interviewerId) ?? "Panel member",
        scores: s.scores, overallScore: s.overallScore ?? null, comments: s.comments ?? null,
        submittedAt: s.submittedAt ? new Date(s.submittedAt).toISOString() : null,
      })),
    });
  }
  return out;
}
