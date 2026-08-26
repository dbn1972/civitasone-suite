/**
 * Attendance module — pure domain logic (no I/O, no side effects, fully unit/property testable).
 *
 * Responsibilities (Req 6.1–6.7):
 *   - Check-in verification: a participant may only check in if they are an invited member (Req 6.2).
 *   - Quorum verification: quorum is established once present + joined_late attendees meet the
 *     committee's quorum threshold. This reuses the committee module's quorum evaluator so the
 *     two modules stay in lock-step on what "counts" toward quorum (Req 6.4).
 *   - Geo-fence validation: a mobile geolocation check-in must fall within the configured radius
 *     of the meeting venue (Req 6.1).
 *   - QR code generation: an opaque, tamper-evident, expiring token displayed on the room screen
 *     and scanned by participants (Req 6.1, 6.2).
 *   - Joined-late detection: a check-in after `meeting.actual_start_at` is recorded as joined_late (Req 6.5).
 *
 * Domain-rule violations are raised as the service's typed `HttpError` (via `httpError`) so the
 * standard error envelope + HTTP status contract is preserved end-to-end. Callers inject `now`
 * (and the QR secret) so every function is deterministic given its inputs.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { httpError } from "../../shared/context.js";
import {
  evaluateQuorum,
  countQuorumEligible,
  type QuorumRule,
  type QuorumAttendee,
  type QuorumEvaluation,
} from "../committee/domain.js";

// Re-export the committee quorum contract so attendance callers have a single import surface
// and the two modules cannot drift on the quorum vocabulary.
export { evaluateQuorum, countQuorumEligible };
export type { QuorumRule, QuorumAttendee, QuorumEvaluation };

// ─── Domain vocabularies (mirror the migration's VARCHAR value sets) ─────────

/** Attendance capture channel (Req 6.1). Matches the COMMANDS.attendanceCheckIn payload contract. */
export const ATTENDANCE_METHODS = ["qr", "biometric", "geo", "vc", "manual"] as const;
export type AttendanceMethod = (typeof ATTENDANCE_METHODS)[number];

/** Physical vs video-conference presence. */
export const ATTENDANCE_MODES = ["in_person", "vc"] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

/** Attendance status shown on the real-time dashboard (Req 6.3). */
export const ATTENDANCE_STATUSES = ["present", "absent", "joined_late", "left_early", "attending_via_vc"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Invitation statuses that make a participant eligible to check in (i.e. not withdrawn/declined). */
const CHECKIN_ELIGIBLE_INVITATION_STATUSES = new Set(["pending", "accepted", "tentative"]);

// ─── Check-in verification (Req 6.2) ─────────────────────────────────────────

/** The subset of a participant row needed to authorise a check-in. */
export interface InvitedParticipant {
  id: string;
  meetingId: string;
  /** Invitation lifecycle: pending | accepted | tentative | declined (see participant module). */
  invitationStatus: string;
  /** The participant's real-world identity (participants.employee_id) — compared against the
   * caller's actorId so a check-in can be verified as self-service or secretariat-authorized. */
  employeeId: string;
}

/**
 * The authenticated caller attempting a check-in/manual-mark, and who else (besides the
 * participant being marked) is authorized to act on their behalf (Req 6.2).
 */
export interface CheckInAuthorization {
  /** The caller's identity (ctx.actorId / msg.actorId). */
  actorId: string;
  /**
   * Identities authorized to check in/mark ANY invited participant of this meeting on their
   * behalf — e.g. the meeting's own secretary, chairperson, or the actor who created/administers
   * it (a secretary conducting roll call is the canonical case). `null`/`undefined` entries are
   * ignored so callers can pass optional meeting fields (e.g. `meeting.secretaryId`) directly
   * without pre-filtering.
   */
  authorizedAgentIds?: ReadonlyArray<string | null | undefined>;
}

/**
 * Assert a participant is an invited member of the meeting and so may check in (Req 6.2), AND
 * that the caller is authorized to record it: either the participant themselves, or an
 * authorized agent of the meeting (its secretary/chairperson/creator — see `CheckInAuthorization`).
 *
 * `participant` is the row resolved by the consumer/route for `(meetingId, participantId)`.
 * A missing participant, a participant belonging to a different meeting, or one whose invitation
 * was declined/withdrawn is rejected with `PARTICIPANT_NOT_MEMBER` (422). Being invited — not the
 * RSVP answer — is what gates check-in: a `pending`/`tentative` invitee who shows up is still valid.
 *
 * The identity check is deliberately NOT a strict "must be yourself" rule: a real roll-call flow
 * has the secretary (or chairperson) marking attendance for the whole room, so an unrelated actor
 * (never the participant, never staffing this meeting) is who this actually rejects — mapped to
 * `MEETING_UNAUTHORIZED_ACCESS` (404), matching this codebase's convention of not leaking a
 * resource's existence/state to a caller who was never authorized to act on it.
 */
export function assertParticipantInvited(
  participant: InvitedParticipant | null | undefined,
  meetingId: string,
  actor: CheckInAuthorization,
): asserts participant is InvitedParticipant {
  if (!participant) {
    throw httpError("PARTICIPANT_NOT_MEMBER", "participant is not an invited member of this meeting", { meetingId });
  }
  if (participant.meetingId !== meetingId) {
    throw httpError("PARTICIPANT_NOT_MEMBER", "participant does not belong to this meeting", {
      meetingId,
      participantId: participant.id,
    });
  }
  if (!CHECKIN_ELIGIBLE_INVITATION_STATUSES.has(participant.invitationStatus)) {
    throw httpError("PARTICIPANT_NOT_MEMBER", "participant's invitation is not active", {
      meetingId,
      participantId: participant.id,
      invitationStatus: participant.invitationStatus,
    });
  }
  const isSelf = actor.actorId === participant.employeeId;
  const isAuthorizedAgent = (actor.authorizedAgentIds ?? []).some((id) => id != null && id === actor.actorId);
  if (!isSelf && !isAuthorizedAgent) {
    throw httpError("MEETING_UNAUTHORIZED_ACCESS", "caller is not authorized to check in this participant", {
      meetingId,
      participantId: participant.id,
    });
  }
}

// ─── Joined-late detection (Req 6.5) ─────────────────────────────────────────

/**
 * True when a check-in at `checkInAt` occurs strictly after the meeting actually started.
 * A meeting with no recorded `actualStartAt` (not yet in progress) is never "late".
 */
export function isJoinedLate(checkInAt: Date, actualStartAt: Date | null | undefined): boolean {
  if (!actualStartAt) return false;
  return checkInAt.getTime() > actualStartAt.getTime();
}

/**
 * Resolve the attendance status to persist for a check-in (Req 6.3, 6.5).
 *
 * VC-mode presence is recorded as `attending_via_vc` regardless of timing (Req 6.7); otherwise an
 * arrival after the meeting start is `joined_late` (Req 6.5) and an on-time arrival is `present`.
 * Manual marking that supplies an explicit status bypasses this derivation (handled by the caller).
 */
export function resolveCheckInStatus(
  checkInAt: Date,
  actualStartAt: Date | null | undefined,
  mode: AttendanceMode,
): AttendanceStatus {
  if (mode === "vc") return "attending_via_vc";
  return isJoinedLate(checkInAt, actualStartAt) ? "joined_late" : "present";
}

// ─── Quorum verification (Req 6.4) ───────────────────────────────────────────

/** Attendance statuses that count as "in the room" for quorum (present + joined_late, Req 6.4). */
export const QUORUM_PRESENT_STATUSES = ["present", "joined_late"] as const;

/**
 * Verify whether quorum is established for a live attendance set (Req 6.4).
 *
 * Thin, attendance-facing wrapper over the committee module's `evaluateQuorum` so both modules
 * agree on what counts toward quorum (present/joined_late statuses, VC-inclusion honouring
 * `rule.vcCountsForQuorum`, and any role composition). `totalActiveMembers` resolves a
 * percentage-based rule to an absolute threshold.
 */
export function verifyQuorum(
  attendees: readonly QuorumAttendee[],
  rule: QuorumRule,
  totalActiveMembers: number,
): QuorumEvaluation {
  return evaluateQuorum(attendees, rule, totalActiveMembers);
}

// ─── Geo-fence validation (Req 6.1) ──────────────────────────────────────────

/** A geographic point in decimal degrees. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** The venue geo-fence a mobile check-in must fall inside. */
export interface GeoFence {
  center: GeoPoint;
  /** Allowed radius from the venue centre, in metres. */
  radiusMeters: number;
}

const EARTH_RADIUS_METERS = 6_371_008.8; // IUGG mean Earth radius
const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/** True when a coordinate pair is a finite, in-range latitude/longitude. */
export function isValidGeoPoint(point: GeoPoint): boolean {
  const { latitude, longitude } = point;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Great-circle distance in metres between two points (Haversine). Deterministic and pure;
 * accurate to well within the geo-fence tolerances used for meeting check-in.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when `point` lies within (inclusive of) the geo-fence radius. */
export function isWithinGeoFence(point: GeoPoint, fence: GeoFence): boolean {
  if (!isValidGeoPoint(point) || !isValidGeoPoint(fence.center)) return false;
  return haversineMeters(point, fence.center) <= fence.radiusMeters;
}

/**
 * Assert a mobile geolocation check-in falls within the configured venue radius (Req 6.1).
 * Throws `VALIDATION_FAILED` (400) with the measured distance when the point is out of range
 * or the coordinates are malformed.
 */
export function assertWithinGeoFence(point: GeoPoint, fence: GeoFence): void {
  if (!isValidGeoPoint(point)) {
    throw httpError("VALIDATION_FAILED", "check-in coordinates are invalid", { point });
  }
  if (!isWithinGeoFence(point, fence)) {
    throw httpError("VALIDATION_FAILED", "check-in location is outside the meeting geo-fence", {
      distanceMeters: Math.round(haversineMeters(point, fence.center)),
      radiusMeters: fence.radiusMeters,
    });
  }
}

// ─── QR code generation (Req 6.1, 6.2) ───────────────────────────────────────

/** Default validity window for a meeting QR token (minutes). */
export const DEFAULT_QR_TTL_MINUTES = 240;

/** Decoded meeting QR token payload (the data encoded into the on-screen QR image). */
export interface MeetingQrPayload {
  meetingId: string;
  /** Unix epoch milliseconds the token was issued at. */
  issuedAt: number;
  /** Unix epoch milliseconds after which the token is no longer valid. */
  expiresAt: number;
  /** Random opaque value making each token unique (replay diversification). */
  nonce: string;
}

const base64url = (buf: Buffer): string => buf.toString("base64url");

function sign(payloadPart: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(payloadPart).digest());
}

/**
 * Generate a tamper-evident, expiring meeting QR token (Req 6.1, 6.2).
 *
 * The returned string is `base64url(payloadJson).base64url(hmacSha256(payloadJson, secret))`.
 * It encodes the meeting id, issue/expiry timestamps and a random nonce, and is HMAC-signed with
 * the tenant/meeting `secret` so a scanned token can be verified as genuine and unexpired before a
 * check-in is accepted. Pure given `opts` (caller injects `now`, `nonce`, and `secret`).
 */
export function generateMeetingQrToken(opts: {
  meetingId: string;
  secret: string;
  now: Date;
  nonce: string;
  ttlMinutes?: number;
}): string {
  const ttl = opts.ttlMinutes !== undefined && opts.ttlMinutes > 0 ? opts.ttlMinutes : DEFAULT_QR_TTL_MINUTES;
  const issuedAt = opts.now.getTime();
  const payload: MeetingQrPayload = {
    meetingId: opts.meetingId,
    issuedAt,
    expiresAt: issuedAt + ttl * 60_000,
    nonce: opts.nonce,
  };
  const payloadPart = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${payloadPart}.${sign(payloadPart, opts.secret)}`;
}

/** Parsed + verified QR token, or a typed failure reason. */
export type QrVerification =
  | { valid: true; payload: MeetingQrPayload }
  | { valid: false; reason: "malformed" | "bad_signature" | "expired" | "meeting_mismatch" };

/**
 * Verify a scanned meeting QR token against its `secret` and the expected meeting (Req 6.2).
 *
 * Checks structural integrity, the HMAC signature (constant-time comparison), expiry against
 * `now`, and — when `expectedMeetingId` is supplied — that the token was issued for this meeting.
 * Returns a discriminated result rather than throwing so callers can map to their own error.
 */
export function verifyMeetingQrToken(
  token: string,
  opts: { secret: string; now: Date; expectedMeetingId?: string },
): QrVerification {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { valid: false, reason: "malformed" };

  const payloadPart = token.slice(0, dot);
  const signaturePart = token.slice(dot + 1);

  const expected = sign(payloadPart, opts.secret);
  const a = Buffer.from(signaturePart);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: "bad_signature" };

  let payload: MeetingQrPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as MeetingQrPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (typeof payload.meetingId !== "string" || typeof payload.expiresAt !== "number") {
    return { valid: false, reason: "malformed" };
  }
  if (opts.expectedMeetingId !== undefined && payload.meetingId !== opts.expectedMeetingId) {
    return { valid: false, reason: "meeting_mismatch" };
  }
  if (opts.now.getTime() > payload.expiresAt) return { valid: false, reason: "expired" };

  return { valid: true, payload };
}
