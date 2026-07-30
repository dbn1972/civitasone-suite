/**
 * R-RA-0152 — interview recording/transcript domain (pure).
 */
import { describe, it, expect } from "vitest";
import {
  validateRecording, isSafeStorageKey, recordingKeyPrefix, computeRetentionUntil, isExpired,
  DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS,
} from "../src/modules/recruitment/interview-recording.js";

describe("validateRecording", () => {
  const ok = { kind: "recording", storageKey: "interviews/iv-1/recordings/a.mp4", consentGiven: true, consentReference: "econsent-abc" };
  it("accepts a valid consented recording", () => {
    expect(validateRecording(ok)).toEqual([]);
  });
  it("REQUIRES consent (fail closed)", () => {
    expect(validateRecording({ ...ok, consentGiven: false }).some((e) => e.includes("consent"))).toBe(true);
    expect(validateRecording({ kind: "transcript", storageKey: "k" }).some((e) => e.includes("consent"))).toBe(true);
  });
  it("REQUIRES a consent reference (not just a bare flag)", () => {
    expect(validateRecording({ ...ok, consentReference: undefined }).some((e) => e.includes("consentReference"))).toBe(true);
    expect(validateRecording({ ...ok, consentReference: "  " }).some((e) => e.includes("consentReference"))).toBe(true);
  });
  it("rejects an unknown kind and a missing key", () => {
    expect(validateRecording({ ...ok, kind: "video" }).some((e) => e.includes("kind must be"))).toBe(true);
    expect(validateRecording({ ...ok, storageKey: "" }).some((e) => e.includes("storageKey"))).toBe(true);
  });
  it("rejects an unsafe (path-traversal) storage key", () => {
    expect(validateRecording({ ...ok, storageKey: "interviews/iv-1/recordings/../../other/x" }).some((e) => e.includes("unsafe path"))).toBe(true);
    expect(validateRecording({ ...ok, storageKey: "/etc/passwd" }).some((e) => e.includes("unsafe path"))).toBe(true);
  });
  it("bounds retentionDays", () => {
    expect(validateRecording({ ...ok, retentionDays: 0 }).some((e) => e.includes("retentionDays"))).toBe(true);
    expect(validateRecording({ ...ok, retentionDays: MAX_RETENTION_DAYS + 1 }).some((e) => e.includes("retentionDays"))).toBe(true);
    expect(validateRecording({ ...ok, retentionDays: 30 })).toEqual([]);
  });
});

describe("isSafeStorageKey", () => {
  it("rejects traversal / absolute / backslash keys", () => {
    expect(isSafeStorageKey("interviews/iv/recordings/a.mp4")).toBe(true);
    expect(isSafeStorageKey("interviews/iv/../x")).toBe(false);
    expect(isSafeStorageKey("/abs")).toBe(false);
    expect(isSafeStorageKey("a//b")).toBe(false);
    expect(isSafeStorageKey("a\\b")).toBe(false);
  });
});

describe("recordingKeyPrefix", () => {
  it("scopes the key to the interview", () => {
    expect(recordingKeyPrefix("iv-9")).toBe("interviews/iv-9/recordings/");
  });
});

describe("computeRetentionUntil", () => {
  it("is now + days (default 180) as YYYY-MM-DD", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(computeRetentionUntil(now, 10)).toBe("2026-01-11");
    expect(computeRetentionUntil(now)).toBe(computeRetentionUntil(now, DEFAULT_RETENTION_DAYS));
  });
});

describe("isExpired", () => {
  it("is true once the retention day has fully passed", () => {
    const now = Date.parse("2026-06-15T12:00:00Z");
    expect(isExpired("2026-06-14", now)).toBe(true);
    expect(isExpired("2026-06-15", now)).toBe(false); // still within the final day
    expect(isExpired("2026-12-31", now)).toBe(false);
  });
});
