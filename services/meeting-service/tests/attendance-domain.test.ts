/**
 * Attendance module — unit tests for the pure domain logic (check-in verification, joined-late
 * detection, status resolution, quorum verification, geo-fence validation, QR token
 * generation/verification). All functions are pure and deterministic; the caller injects `now`,
 * the QR `secret`, and the `nonce`, so no I/O or clock coupling is exercised here.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_
 */
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_METHODS,
  ATTENDANCE_MODES,
  ATTENDANCE_STATUSES,
  assertParticipantInvited,
  isJoinedLate,
  resolveCheckInStatus,
  verifyQuorum,
  isValidGeoPoint,
  haversineMeters,
  isWithinGeoFence,
  assertWithinGeoFence,
  generateMeetingQrToken,
  verifyMeetingQrToken,
  DEFAULT_QR_TTL_MINUTES,
  type GeoFence,
  type QuorumRule,
} from "../src/modules/attendance/domain.js";

const MEETING = "11111111-1111-1111-1111-111111111111";
const OTHER_MEETING = "22222222-2222-2222-2222-222222222222";
const PARTICIPANT = "33333333-3333-3333-3333-333333333333";
const EMPLOYEE = "44444444-4444-4444-4444-444444444444";
const SECRETARY = "55555555-5555-5555-5555-555555555555";
const STRANGER = "66666666-6666-6666-6666-666666666666";
const START = new Date("2026-01-15T09:00:00.000Z");

describe("domain vocabularies (Req 6.1, 6.3)", () => {
  it("exposes the migration value sets", () => {
    expect([...ATTENDANCE_METHODS]).toEqual(["qr", "biometric", "geo", "vc", "manual"]);
    expect([...ATTENDANCE_MODES]).toEqual(["in_person", "vc"]);
    expect([...ATTENDANCE_STATUSES]).toEqual(["present", "absent", "joined_late", "left_early", "attending_via_vc"]);
  });
});

describe("assertParticipantInvited (Req 6.2)", () => {
  it("accepts the participant checking themselves in", () => {
    expect(() =>
      assertParticipantInvited(
        { id: PARTICIPANT, meetingId: MEETING, invitationStatus: "accepted", employeeId: EMPLOYEE },
        MEETING,
        { actorId: EMPLOYEE },
      ),
    ).not.toThrow();
    expect(() =>
      assertParticipantInvited(
        { id: PARTICIPANT, meetingId: MEETING, invitationStatus: "pending", employeeId: EMPLOYEE },
        MEETING,
        { actorId: EMPLOYEE },
      ),
    ).not.toThrow();
  });

  it("accepts an authorized agent of the meeting (secretary/chairperson/creator) checking in someone else", () => {
    expect(() =>
      assertParticipantInvited(
        { id: PARTICIPANT, meetingId: MEETING, invitationStatus: "accepted", employeeId: EMPLOYEE },
        MEETING,
        { actorId: SECRETARY, authorizedAgentIds: [SECRETARY, null, undefined] },
      ),
    ).not.toThrow();
  });

  it("rejects an unrelated caller who is neither the participant nor an authorized agent (Req 6.2 identity check)", () => {
    expect(() =>
      assertParticipantInvited(
        { id: PARTICIPANT, meetingId: MEETING, invitationStatus: "accepted", employeeId: EMPLOYEE },
        MEETING,
        { actorId: STRANGER, authorizedAgentIds: [SECRETARY] },
      ),
    ).toThrowError(/not authorized to check in/);
    expect(() =>
      assertParticipantInvited(
        { id: PARTICIPANT, meetingId: MEETING, invitationStatus: "accepted", employeeId: EMPLOYEE },
        MEETING,
        { actorId: STRANGER },
      ),
    ).toThrowError(/not authorized to check in/);
  });

  it("rejects a missing participant", () => {
    expect(() => assertParticipantInvited(null, MEETING, { actorId: EMPLOYEE })).toThrowError(/not an invited member/);
    expect(() => assertParticipantInvited(undefined, MEETING, { actorId: EMPLOYEE })).toThrowError(/not an invited member/);
  });

  it("rejects a participant from another meeting", () => {
    expect(() =>
      assertParticipantInvited(
        { id: PARTICIPANT, meetingId: OTHER_MEETING, invitationStatus: "accepted", employeeId: EMPLOYEE },
        MEETING,
        { actorId: EMPLOYEE },
      ),
    ).toThrowError(/does not belong to this meeting/);
  });

  it("rejects a declined/withdrawn invitation", () => {
    expect(() =>
      assertParticipantInvited(
        { id: PARTICIPANT, meetingId: MEETING, invitationStatus: "declined", employeeId: EMPLOYEE },
        MEETING,
        { actorId: EMPLOYEE },
      ),
    ).toThrowError(/invitation is not active/);
  });
});

describe("joined-late detection + status resolution (Req 6.3, 6.5, 6.7)", () => {
  it("isJoinedLate is true only for a check-in strictly after the actual start", () => {
    expect(isJoinedLate(new Date("2026-01-15T09:05:00Z"), START)).toBe(true);
    expect(isJoinedLate(new Date("2026-01-15T08:55:00Z"), START)).toBe(false);
    expect(isJoinedLate(START, START)).toBe(false);
    expect(isJoinedLate(new Date("2026-01-15T09:05:00Z"), null)).toBe(false);
  });

  it("resolveCheckInStatus maps mode + timing to a status", () => {
    expect(resolveCheckInStatus(new Date("2026-01-15T09:05:00Z"), START, "vc")).toBe("attending_via_vc");
    expect(resolveCheckInStatus(new Date("2026-01-15T09:05:00Z"), START, "in_person")).toBe("joined_late");
    expect(resolveCheckInStatus(new Date("2026-01-15T08:55:00Z"), START, "in_person")).toBe("present");
    expect(resolveCheckInStatus(START, null, "in_person")).toBe("present");
  });
});

describe("verifyQuorum (Req 6.4)", () => {
  const rule: QuorumRule = { minMembers: 2, vcCountsForQuorum: false };

  it("counts present/joined_late in-person attendees and honours VC exclusion", () => {
    const attendees = [
      { status: "present", mode: "in_person" },
      { status: "joined_late", mode: "in_person" },
      { status: "attending_via_vc", mode: "vc" }, // excluded (vcCountsForQuorum=false and not present)
    ];
    const evaluation = verifyQuorum(attendees, rule, 5);
    expect(evaluation.countedAttendees).toBe(2);
    expect(evaluation.requiredMembers).toBe(2);
    expect(evaluation.established).toBe(true);
  });

  it("reports shortfall when quorum is not met", () => {
    const evaluation = verifyQuorum([{ status: "present", mode: "in_person" }], rule, 5);
    expect(evaluation.established).toBe(false);
    expect(evaluation.countSatisfied).toBe(false);
  });
});

describe("geo-fence validation (Req 6.1)", () => {
  const fence: GeoFence = { center: { latitude: 28.6139, longitude: 77.209 }, radiusMeters: 100 };

  it("validates coordinate ranges", () => {
    expect(isValidGeoPoint({ latitude: 10, longitude: 20 })).toBe(true);
    expect(isValidGeoPoint({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidGeoPoint({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isValidGeoPoint({ latitude: Number.NaN, longitude: 0 })).toBe(false);
  });

  it("measures distance and evaluates containment", () => {
    expect(haversineMeters(fence.center, fence.center)).toBe(0);
    expect(isWithinGeoFence({ latitude: 28.6139, longitude: 77.209 }, fence)).toBe(true);
    // ~1.5km away — well outside the 100m fence.
    expect(isWithinGeoFence({ latitude: 28.6272, longitude: 77.209 }, fence)).toBe(false);
    expect(isWithinGeoFence({ latitude: 999, longitude: 0 }, fence)).toBe(false);
  });

  it("assertWithinGeoFence throws for out-of-range and malformed coordinates", () => {
    expect(() => assertWithinGeoFence({ latitude: 28.6139, longitude: 77.209 }, fence)).not.toThrow();
    expect(() => assertWithinGeoFence({ latitude: 28.7, longitude: 77.3 }, fence)).toThrowError(/outside the meeting geo-fence/);
    expect(() => assertWithinGeoFence({ latitude: 999, longitude: 0 }, fence)).toThrowError(/coordinates are invalid/);
  });
});

describe("meeting QR token (Req 6.1, 6.2)", () => {
  const secret = "unit-test-qr-secret";

  it("round-trips a valid, unexpired token", () => {
    const token = generateMeetingQrToken({ meetingId: MEETING, secret, now: START, nonce: "n1", ttlMinutes: 60 });
    expect(token).toContain(".");
    const result = verifyMeetingQrToken(token, { secret, now: new Date(START.getTime() + 60_000), expectedMeetingId: MEETING });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.payload.meetingId).toBe(MEETING);
  });

  it("defaults the TTL when none/invalid is supplied", () => {
    const token = generateMeetingQrToken({ meetingId: MEETING, secret, now: START, nonce: "n2" });
    const result = verifyMeetingQrToken(token, { secret, now: START });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.expiresAt).toBe(START.getTime() + DEFAULT_QR_TTL_MINUTES * 60_000);
    }
  });

  it("rejects a tampered signature", () => {
    const token = generateMeetingQrToken({ meetingId: MEETING, secret, now: START, nonce: "n3" });
    const result = verifyMeetingQrToken(token, { secret: "wrong-secret", now: START });
    expect(result).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("rejects an expired token", () => {
    const token = generateMeetingQrToken({ meetingId: MEETING, secret, now: START, nonce: "n4", ttlMinutes: 1 });
    const result = verifyMeetingQrToken(token, { secret, now: new Date(START.getTime() + 2 * 60_000) });
    expect(result).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects a token minted for a different meeting", () => {
    const token = generateMeetingQrToken({ meetingId: MEETING, secret, now: START, nonce: "n5" });
    const result = verifyMeetingQrToken(token, { secret, now: START, expectedMeetingId: OTHER_MEETING });
    expect(result).toEqual({ valid: false, reason: "meeting_mismatch" });
  });

  it("rejects a malformed token", () => {
    expect(verifyMeetingQrToken("not-a-token", { secret, now: START })).toEqual({ valid: false, reason: "malformed" });
    expect(verifyMeetingQrToken(".", { secret, now: START })).toEqual({ valid: false, reason: "malformed" });
  });
});
