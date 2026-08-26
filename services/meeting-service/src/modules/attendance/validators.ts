/**
 * Attendance module — Zod request validators (route boundary).
 *
 * Every write route parses its body through one of these before publishing a command
 * (route → zod → queue.publish → 202). Shapes mirror the `COMMANDS.attendance*` payload
 * contracts documented in src/topics.ts; `meetingId` is taken from the path param and merged
 * in by the route, so the body schemas below cover the request body only.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
 */
import { z } from "zod";
import { httpError } from "../../shared/context.js";
import { ATTENDANCE_METHODS, ATTENDANCE_MODES, ATTENDANCE_STATUSES } from "./domain.js";

const uuid = z.string().uuid();
const method = z.enum(ATTENDANCE_METHODS);
const mode = z.enum(ATTENDANCE_MODES);
const status = z.enum(ATTENDANCE_STATUSES);

/** ISO-8601 timestamp accepted on the wire and coerced to a Date for the domain layer. */
const isoDateTime = z.coerce.date();

/** Latitude/longitude in decimal degrees (WGS-84), bounded to valid ranges (Req 6.1). */
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/**
 * Record a check-in (Req 6.1, 6.2). `method` selects the capture channel; geolocation coordinates
 * are required together for the `geo` method (enforced by `superRefine`), a QR token is required
 * for the `qr` method, and `deviceId` provenance is optional. `checkInAt` defaults to server time
 * when the client omits it. VC presence is normally captured via the VC webhook, but `method: "vc"`
 * is accepted here for completeness.
 */
export const attendanceCheckInSchema = z
  .object({
    participantId: uuid,
    method,
    mode: mode.optional(),
    checkInAt: isoDateTime.optional(),
    /** Signed meeting QR token (see domain.generateMeetingQrToken); required when method === "qr". */
    qrToken: z.string().min(1).max(2_048).optional(),
    geoLatitude: latitude.optional(),
    geoLongitude: longitude.optional(),
    deviceId: z.string().trim().min(1).max(256).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.method === "geo" && (body.geoLatitude === undefined || body.geoLongitude === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "geo check-in requires both geoLatitude and geoLongitude",
        path: ["geoLatitude"],
      });
    }
    if (body.method === "qr" && !body.qrToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "qr check-in requires a qrToken",
        path: ["qrToken"],
      });
    }
    if ((body.geoLatitude === undefined) !== (body.geoLongitude === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "geoLatitude and geoLongitude must be provided together",
        path: ["geoLongitude"],
      });
    }
  });
export type AttendanceCheckInInput = z.infer<typeof attendanceCheckInSchema>;

/** Record a check-out (Req 6.6). `checkOutAt` defaults to server time when omitted. */
export const attendanceCheckOutSchema = z
  .object({
    participantId: uuid,
    checkOutAt: isoDateTime.optional(),
  })
  .strict();
export type AttendanceCheckOutInput = z.infer<typeof attendanceCheckOutSchema>;

/**
 * Secretary manual marking (Req 6.1). The secretary sets an explicit `status`; `mode` and
 * `checkInAt` are optional (the consumer defaults them). Used when automated capture is
 * unavailable or to correct the record.
 */
export const attendanceManualMarkSchema = z
  .object({
    participantId: uuid,
    status,
    mode: mode.optional(),
    checkInAt: isoDateTime.optional(),
  })
  .strict();
export type AttendanceManualMarkInput = z.infer<typeof attendanceManualMarkSchema>;

/**
 * Generate a meeting QR code (Req 6.1). `ttlMinutes` optionally overrides the default validity
 * window (see domain.DEFAULT_QR_TTL_MINUTES).
 */
export const generateQrSchema = z
  .object({
    ttlMinutes: z.number().int().positive().max(24 * 60).optional(),
  })
  .strict();
export type GenerateQrInput = z.infer<typeof generateQrSchema>;

// ─── Timestamp sanity bounds (Req 6.1, 6.6 — audit finding: previously unbounded) ─────────────
//
// These two asserts need the parent MEETING's `scheduledAt` (check-in/out) and, for a
// check-out, the EXISTING record's `checkInAt` — neither is available to a Zod object schema
// (which only sees the current request body), so they are plain exported functions the
// consumer calls once it has loaded that context (mirrors `meeting-core/domain.ts`'s
// `TransitionContext`-as-argument shape: pure, given its inputs).

/**
 * POLICY CALL: how far a check-in/check-out timestamp may sit from the meeting's own
 * `scheduledAt` before it's rejected as clearly-wrong data. Deliberately generous (24h each
 * side, not tied to `durationMinutes`) — early arrivals, marathon/multi-day sittings, VC clock
 * skew, and next-day secretary corrections are all legitimate; the bound exists to catch
 * obviously-bad data (a check-in a year off, a backdate to a past decade — this fix's own
 * regression cases), not to police punctuality.
 */
export const ATTENDANCE_TIMESTAMP_TOLERANCE_HOURS = 24;
const TOLERANCE_MS = ATTENDANCE_TIMESTAMP_TOLERANCE_HOURS * 60 * 60 * 1000;

/**
 * Assert `at` (a check-in or check-out instant) falls within the tolerance window of the
 * meeting's own `scheduledAt`. A meeting with no `scheduledAt` (defensive; the column is
 * nullable) has nothing to bound against and is always accepted. Throws
 * `ATTENDANCE_INVALID_TIMESTAMP` (422).
 */
export function assertWithinMeetingWindow(at: Date, scheduledAt: Date | null, label: "checkInAt" | "checkOutAt"): void {
  if (!scheduledAt) return;
  if (Math.abs(at.getTime() - scheduledAt.getTime()) > TOLERANCE_MS) {
    throw httpError(
      "ATTENDANCE_INVALID_TIMESTAMP",
      `${label} ${at.toISOString()} is more than ${ATTENDANCE_TIMESTAMP_TOLERANCE_HOURS}h from the meeting's scheduled time ${scheduledAt.toISOString()}`,
      { label, at: at.toISOString(), scheduledAt: scheduledAt.toISOString(), toleranceHours: ATTENDANCE_TIMESTAMP_TOLERANCE_HOURS },
    );
  }
}

/**
 * Assert `checkOutAt` is strictly after `checkInAt` (a negative attendance duration is never
 * valid). Throws `ATTENDANCE_INVALID_TIMESTAMP` (422).
 */
export function assertCheckOutAfterCheckIn(checkInAt: Date, checkOutAt: Date): void {
  if (checkOutAt.getTime() <= checkInAt.getTime()) {
    throw httpError(
      "ATTENDANCE_INVALID_TIMESTAMP",
      `checkOutAt ${checkOutAt.toISOString()} must be strictly after checkInAt ${checkInAt.toISOString()}`,
      { checkInAt: checkInAt.toISOString(), checkOutAt: checkOutAt.toISOString() },
    );
  }
}

// ─── Path / query params ─────────────────────────────────────────────────────

export const meetingIdParam = z.object({ meetingId: uuid });

export const attendanceQueryParams = z.object({
  status: status.optional(),
  mode: mode.optional(),
  limit: z.coerce.number().int().positive().max(200).default(200),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type AttendanceQueryParams = z.infer<typeof attendanceQueryParams>;
