/**
 * Candidate-facing stage timeline (pure, no I/O).
 *
 * The backend writes applied | shortlisted | selected | offered | hired | rejected
 * (plus withdrawn / not_selected in AVAILABLE_STAGES). The candidate rail is a
 * fixed six-step journey; terminal stages must not render as an all-grey rail.
 * Only fixed, candidate-safe wording is returned here -- never HR remarks.
 */

export type TimelineStatus = "done" | "active" | "future" | "ended";
export type TimelineEntry = { stage: string; label: string; status: TimelineStatus; note: string };
export type PortalOutcome = { kind: "not_selected" | "withdrawn"; message: string };

export type TimelineInput = { stage: string; appliedAt: Date | null };

const STAGES = ["applied", "screening", "shortlisted", "interview", "offered", "hired"] as const;
const LABELS: Record<string, string> = {
  applied: "Application Submitted",
  screening: "Under Review",
  shortlisted: "Shortlisted",
  interview: "Interview Scheduled",
  offered: "Offer Issued",
  hired: "Joined",
};
// HR hire route also writes "selected"; show it as the shortlisted step.
const ALIAS: Record<string, string> = { selected: "shortlisted" };
const NOT_SELECTED = new Set(["rejected", "not_selected"]);

export const NOT_SELECTED_MESSAGE = "Your application was not selected for this post.";
export const WITHDRAWN_MESSAGE = "You withdrew this application.";

export function portalOutcome(stage: string): PortalOutcome | null {
  if (NOT_SELECTED.has(stage)) return { kind: "not_selected", message: NOT_SELECTED_MESSAGE };
  if (stage === "withdrawn") return { kind: "withdrawn", message: WITHDRAWN_MESSAGE };
  return null;
}

export function buildStageTimeline(a: TimelineInput): TimelineEntry[] {
  const appliedNote = a.appliedAt ? a.appliedAt.toISOString() : "";
  const outcome = portalOutcome(a.stage);
  if (outcome) {
    return [
      { stage: "applied", label: LABELS.applied!, status: "done", note: appliedNote },
      {
        stage: outcome.kind === "withdrawn" ? "withdrawn" : "rejected",
        label: outcome.kind === "withdrawn" ? "Withdrawn by you" : "Not selected",
        status: "ended",
        note: "",
      },
    ];
  }
  const currentIdx = STAGES.indexOf((ALIAS[a.stage] ?? a.stage) as (typeof STAGES)[number]);
  return STAGES.map((s, i) => ({
    stage: s,
    label: s === "shortlisted" && a.stage === "selected" ? "Selected" : LABELS[s]!,
    status: (i < currentIdx ? "done" : i === currentIdx ? "active" : "future") as TimelineStatus,
    note: s === "applied" ? appliedNote : "",
  }));
}
