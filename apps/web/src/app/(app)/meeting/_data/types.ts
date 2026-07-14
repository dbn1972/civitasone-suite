/**
 * meeting feature — shared TypeScript types.
 *
 * Mirrors the meeting-service HTTP contracts (services/meeting-service):
 *   meeting-core/schema.ts (meetings), agenda/schema.ts (agenda_items),
 *   attendance/repo.ts (LiveAttendanceDashboard), voting/repo.ts +
 *   voting/domain.ts (VoteTally / results / active), minutes/schema.ts
 *   (minutes), config-registry/schema.ts (config entries).
 *
 * These are display-facing shapes assembled from the gateway responses; the
 * gateway maps /api/v1/meeting/* → the service's internal /v1/meetings/*.
 */

export type MeetingStatus =
  | "draft"
  | "scheduled"
  | "agenda_locked"
  | "in_progress"
  | "adjourned"
  | "minutes_pending"
  | "minutes_approved"
  | "closed"
  | "archived"
  | "cancelled";

export type MeetingType =
  | "committee"
  | "board"
  | "departmental"
  | "ad_hoc"
  | "statutory";

export interface Meeting {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: MeetingStatus;
  committeeId: string | null;
  chairpersonId: string | null;
  secretaryId: string | null;
  scheduledAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  durationMinutes: number;
  venue: string | null;
  vcEnabled: boolean;
  vcLink: string | null;
  confidentialityLevel: string;
  quorumEstablished: boolean;
  quorumEstablishedAt: string | null;
  meetingNumber: string | null;
  financialYear: string | null;
  version: number;
}

/** One item on a meeting's agenda (agenda/schema.ts agenda_items). */
export interface AgendaItem {
  id: string;
  meetingId: string;
  sequence: number;
  title: string;
  description: string | null;
  outcomeType: string;
  durationMinutes: number;
  presenterId: string | null;
  status: string;
  category: string | null;
  linkedDecisionId: string | null;
  version: number;
}

/** Live attendance counts (attendance/repo.ts LiveAttendanceDashboard.counts). */
export interface AttendanceCounts {
  present: number;
  absent: number;
  joinedLate: number;
  leftEarly: number;
  attendingViaVc: number;
  total: number;
}

export interface AttendanceParticipant {
  participantId: string;
  employeeId: string;
  role: string;
  isMandatory: boolean;
  status: string;
  mode: string | null;
  method: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
}

export interface LiveAttendance {
  meetingId: string;
  generatedAt: string;
  counts: AttendanceCounts;
  participants: AttendanceParticipant[];
}

/** Running tally for a resolution (voting/domain.ts VoteTally). */
export interface VoteTally {
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  total: number;
}

/** A resolution currently open for voting (voting/repo.ts ActiveVoteView). */
export interface ActiveVote {
  resolutionId: string;
  meetingId: string;
  resolutionNumber: string;
  text: string;
  voteType: string;
  majorityRule: string;
  status: string;
  isCirculation: boolean;
  tally: VoteTally;
  circulationDeadline: string | null;
  createdAt: string;
}

/** Full results view for a resolution (voting/repo.ts VoteResultsView + positions). */
export interface VoteResults {
  resolutionId: string;
  meetingId: string;
  resolutionNumber: string;
  status: string;
  voteType: string;
  majorityRule: string;
  isCirculation: boolean;
  tally: VoteTally;
  result: string;
  projectedResult: string;
  approvalPercentage: number;
  effectiveDate: string | null;
  responseRate: number | null;
  concluded: boolean;
  dscSignerName: string | null;
  hashCurrent: string | null;
  secret: boolean;
  positions: VoterPosition[];
}

export interface VoterPosition {
  memberId?: string;
  memberName?: string;
  position?: string;
  reason?: string | null;
}

/**
 * A recorded resolution / vote record (decision/schema.ts resolutions).
 * Returned by GET /v1/meetings/:meetingId/resolutions — the meeting's full
 * vote register (open + concluded).
 */
export interface Resolution {
  id: string;
  meetingId: string;
  resolutionNumber: string;
  text: string;
  voteType: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  majorityRule: string;
  result: string;
  status: string;
  effectiveDate: string | null;
  isCirculation: boolean;
}

/** Minutes record (minutes/schema.ts minutes). */
export type MinutesStatus = "draft" | "submitted" | "approved" | "signed" | "circulated";

export interface Minutes {
  id: string;
  meetingId: string;
  templateType: string;
  content: string;
  status: MinutesStatus;
  currentVersion: number;
  approvedBy: string | null;
  approvedAt: string | null;
  dscSignerName: string | null;
  dscSignedAt: string | null;
  hashCurrent: string | null;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
  version: number;
}

/** A tenant config entry (config-registry/schema.ts config). */
export interface ConfigEntry {
  id: string;
  namespace: string;
  configKey: string;
  value: unknown;
  label: string | null;
  description: string | null;
  active: boolean;
  sortOrder: number;
  version: number;
}

/** Vertical onboarding presets (config-registry/presets.ts VERTICAL_PRESETS keys). */
export const PRESET_NAMES = [
  "board-of-directors",
  "statutory-committee",
  "municipal-council",
] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export const VOTE_POSITIONS = ["for", "against", "abstain"] as const;
export type VotePosition = (typeof VOTE_POSITIONS)[number];

export const VOTE_TYPES = [
  "show_of_hands",
  "roll_call",
  "secret_ballot",
  "electronic_poll",
  "circulation_resolution",
] as const;
export type VoteType = (typeof VOTE_TYPES)[number];

export const MAJORITY_RULES = [
  "simple_majority",
  "two_thirds",
  "three_fourths",
  "unanimous",
] as const;
export type MajorityRule = (typeof MAJORITY_RULES)[number];
