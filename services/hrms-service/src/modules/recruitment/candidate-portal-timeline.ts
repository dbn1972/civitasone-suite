/**
 * Candidate-facing stage timeline (pure, no I/O).
 *
 * The backend writes applied | shortlisted | selected | offered | hired | rejected
 * (plus withdrawn / not_selected in AVAILABLE_STAGES). The candidate rail is a
 * fixed six-step journey; terminal stages must not render as an all-grey rail.
 * Only fixed, candidate-safe wording is returned here -- never HR remarks.
 */

export type TimelineStatus = "done" | "active" | "future" | "ended";
/** Candidate-safe interview slot: only a confirmed (status scheduled) slot is ever published. */
export type TimelineInterview = {
  /** ISO instant (the stored date + time are UTC, see interview-routes.ts). */
  at: string;
  mode: string;
  durationMinutes: number;
  venue: string | null;
  /** https link only; anything else is dropped. */
  meetingLink: string | null;
};
export type TimelineEntry = { stage: string; label: string; status: TimelineStatus; note: string; interview?: TimelineInterview };
export type PortalOutcome = { kind: "not_selected" | "withdrawn"; message: string };

export type InterviewSlotInput = {
  scheduledDate: string; scheduledTime: string; durationMinutes: number; mode: string;
  location: string | null; meetingLink: string | null; status: string;
};
export type TimelineInput = {
  stage: string;
  appliedAt: Date | null;
  /** When the screening decision "shortlisted" was recorded (screened_at); ignored otherwise. */
  shortlistedAt?: Date | null;
  /** The candidate's next confirmed interview slot, if any. */
  interview?: InterviewSlotInput | null;
};

/**
 * Pure projection of an interview row to the candidate-safe slot, or null when it must not
 * be shown (not confirmed/scheduled, or unparsable date/time). A wrong interview detail shown
 * to a candidate is costly, so anything that is not exactly a scheduled slot is dropped.
 */
export function toTimelineInterview(i: InterviewSlotInput | null | undefined): TimelineInterview | null {
  if (!i || i.status !== "scheduled") return null;
  const at = new Date(`${i.scheduledDate}T${i.scheduledTime}:00.000Z`);
  if (Number.isNaN(at.getTime())) return null;
  const link = i.meetingLink && /^https:\/\//i.test(i.meetingLink) ? i.meetingLink : null;
  return { at: at.toISOString(), mode: i.mode, durationMinutes: i.durationMinutes, venue: i.location?.trim() || null, meetingLink: link };
}

const STAGES = ["applied", "screening", "shortlisted", "interview", "offered", "hired"] as const;
const LABELS: Record<string, string> = {
  applied: "Application Submitted",
  screening: "Under Review",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offered: "Offer Issued",
  hired: "Joined",
};
// HR hire route also writes "selected"; show it as the shortlisted step.
const ALIAS: Record<string, string> = { selected: "shortlisted", interviewing: "interview" };
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
  const slot = toTimelineInterview(a.interview);
  let currentIdx = STAGES.indexOf((ALIAS[a.stage] ?? a.stage) as (typeof STAGES)[number]);
  // A confirmed slot while the application is shortlisted means the candidate is now at the interview step.
  if (slot && a.stage === "shortlisted") currentIdx = STAGES.indexOf("interview");
  const shortlistedNote = a.shortlistedAt && !Number.isNaN(a.shortlistedAt.getTime()) ? a.shortlistedAt.toISOString() : "";
  return STAGES.map((s, i) => {
    const entry: TimelineEntry = {
      stage: s,
      label: s === "shortlisted" && a.stage === "selected" ? "Selected"
        : s === "interview" && slot ? "Interview Scheduled" : LABELS[s]!,
      status: (i < currentIdx ? "done" : i === currentIdx ? "active" : "future") as TimelineStatus,
      note: s === "applied" ? appliedNote
        : s === "shortlisted" && i <= currentIdx ? shortlistedNote
        : s === "interview" && slot ? slot.at : "",
    };
    if (s === "interview" && slot) entry.interview = slot;
    return entry;
  });
}
