/**
 * Admit card (hall ticket) -- pure builder (GAP-RECRUITMENT-DETAIL-14).
 *
 * The roll number is DERIVED, not stored: `<schedule-id first 4>-<attempt-id first 6>`
 * upper-cased. It is stable for the life of the attempt, unique per attempt (the attempt id
 * is a UUID) and needs no migration. A tenant that wants its own numbering scheme replaces
 * this one function. The default instructions are the common Government written-test rules
 * and are meant to be tailored per recruitment.
 */
export const DEFAULT_ADMIT_CARD_INSTRUCTIONS: readonly string[] = [
  "Carry this admit card and one original photo identity proof (Aadhaar, Passport, Voter ID, Driving Licence or PAN).",
  "Report to the venue at least 30 minutes before the reporting time; no entry after the test has begun.",
  "Electronic devices (mobile phones, smart watches, calculators) are not permitted in the examination hall.",
  "Candidates must follow the instructions of the invigilator; use of unfair means leads to disqualification.",
];

export function rollNumber(scheduleId: string, attemptId: string): string {
  return `${scheduleId.replace(/-/g, "").slice(0, 4)}-${attemptId.replace(/-/g, "").slice(0, 6)}`.toUpperCase();
}

export interface AdmitCardInput {
  attemptId: string;
  scheduleId: string;
  attemptStatus: string;
  candidateName: string;
  applicationNo: string | null;
  scheduleTitle: string;
  mode: string;
  windowStart: Date;
  windowEnd: Date;
  slotLabel: string | null;
  identityVerified: boolean;
  scheduleStatus: string;
}

export function buildAdmitCard(i: AdmitCardInput) {
  return {
    attemptId: i.attemptId,
    rollNumber: rollNumber(i.scheduleId, i.attemptId),
    candidateName: i.candidateName,
    applicationNo: i.applicationNo,
    examination: i.scheduleTitle,
    mode: i.mode,
    windowStart: i.windowStart.toISOString(),
    windowEnd: i.windowEnd.toISOString(),
    slotLabel: i.slotLabel,
    identityVerified: i.identityVerified,
    instructions: [...DEFAULT_ADMIT_CARD_INSTRUCTIONS],
  };
}

/** A cancelled sitting or withdrawn/superseded attempt must not yield a valid admit card. */
export function admitCardBlockedReason(scheduleStatus: string, attemptStatus: string): string | null {
  if (scheduleStatus === "cancelled") return "this assessment sitting was cancelled";
  if (["withdrawn", "superseded", "disqualified"].includes(attemptStatus)) return `the attempt is ${attemptStatus}`;
  return null;
}
