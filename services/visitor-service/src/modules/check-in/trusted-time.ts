/**
 * visitor-service: which instant a check-in is judged at.
 *
 * A live check-in is ALWAYS judged at server time: the client `timestamp` used to be trusted, so a
 * gate-role caller could backdate it into an expired pass's window. Only a check-in the gate terminal
 * recorded while OFFLINE (`offlineRecorded: true`) may carry its own timestamp, and then only if it is
 * not in the future (small clock-skew allowance) and no older than the tenant's
 * `check_in.offline_max_age_hours` (default 12 h).
 */
export const FUTURE_SKEW_MS = 2 * 60_000;

export type CheckInTimeResult =
  | { ok: true; at: Date; offline: boolean }
  | { ok: false; code: "OFFLINE_TIMESTAMP_REQUIRED" | "OFFLINE_TIMESTAMP_IN_FUTURE" | "OFFLINE_TIMESTAMP_TOO_OLD"; message: string };

export function resolveCheckInTime(
  input: { offlineRecorded?: boolean | null | undefined; timestamp?: string | null | undefined },
  now: Date,
  maxOfflineAgeMs: number,
): CheckInTimeResult {
  if (input.offlineRecorded !== true) return { ok: true, at: now, offline: false }; // client timestamp ignored
  if (!input.timestamp) {
    return { ok: false, code: "OFFLINE_TIMESTAMP_REQUIRED", message: "an offline-recorded check-in must carry the time it was recorded" };
  }
  const at = new Date(input.timestamp);
  if (Number.isNaN(at.getTime())) {
    return { ok: false, code: "OFFLINE_TIMESTAMP_REQUIRED", message: "timestamp is not a valid date" };
  }
  if (at.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    return { ok: false, code: "OFFLINE_TIMESTAMP_IN_FUTURE", message: `offline timestamp ${at.toISOString()} is in the future` };
  }
  if (now.getTime() - at.getTime() > maxOfflineAgeMs) {
    return {
      ok: false, code: "OFFLINE_TIMESTAMP_TOO_OLD",
      message: `offline timestamp ${at.toISOString()} is older than the ${maxOfflineAgeMs / 3_600_000} h limit`,
    };
  }
  return { ok: true, at, offline: true };
}
