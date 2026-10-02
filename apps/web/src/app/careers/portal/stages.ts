/**
 * Candidate-facing application stage map, shared by the portal list (and kept
 * in step with the backend's candidate-portal-timeline.ts, which feeds the
 * detail page). GAP-RECRUITMENT-CAREERS-PORTAL-02.
 *
 * The backend writes applied | shortlisted | selected | offered | hired | rejected
 * (plus withdrawn / not_selected). Anything else must NEVER be printed raw.
 */
export type StageTone = { bg: string; color: string };

export type StageInfo = {
  label: string;
  tone: StageTone;
  /** "rail": render the progress rail at `railIndex`; "terminal": ended, show a message; "unknown": neutral. */
  kind: "rail" | "terminal" | "unknown";
  railIndex: number;
  /** Fixed, candidate-safe sentence for terminal stages (never HR remarks). */
  message?: string;
};

export const RAIL_STEPS = ["Applied", "Review", "Shortlisted", "Interview", "Offer", "Joined"] as const;

const RAIL: Record<string, { label: string; tone: StageTone; railIndex: number }> = {
  applied:     { label: "Applied",       tone: { bg: "#f1f5f9", color: "#475569" }, railIndex: 0 },
  screening:   { label: "Under Review",  tone: { bg: "#dbeafe", color: "#1e40af" }, railIndex: 1 },
  shortlisted: { label: "Shortlisted",   tone: { bg: "#cffafe", color: "#0e7490" }, railIndex: 2 },
  // The HR hire route also writes "selected"; it sits on the shortlisted step (same as the backend timeline).
  selected:    { label: "Selected",      tone: { bg: "#cffafe", color: "#0e7490" }, railIndex: 2 },
  interview:   { label: "Interview",     tone: { bg: "#fef3c7", color: "#92400e" }, railIndex: 3 },
  offered:     { label: "Offer Issued",  tone: { bg: "#ede9fe", color: "#6d28d9" }, railIndex: 4 },
  hired:       { label: "Joined",        tone: { bg: "#d1fae5", color: "#065f46" }, railIndex: 5 },
};

const NOT_SELECTED_MESSAGE = "Your application was not selected for this post.";
const WITHDRAWN_MESSAGE = "You withdrew this application.";

export function stageInfo(stage: string): StageInfo {
  const r = RAIL[stage];
  if (r) return { ...r, kind: "rail" };
  if (stage === "rejected" || stage === "not_selected") {
    return { label: "Not selected", tone: { bg: "#fee2e2", color: "#991b1b" }, kind: "terminal", railIndex: -1, message: NOT_SELECTED_MESSAGE };
  }
  if (stage === "withdrawn") {
    return { label: "Withdrawn", tone: { bg: "#f1f5f9", color: "#475569" }, kind: "terminal", railIndex: -1, message: WITHDRAWN_MESSAGE };
  }
  return { label: "In progress", tone: { bg: "#f1f5f9", color: "#475569" }, kind: "unknown", railIndex: -1 };
}
