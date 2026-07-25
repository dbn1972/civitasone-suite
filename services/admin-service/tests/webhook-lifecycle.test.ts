/**
 * CAP-054 webhook lifecycle — pure-domain unit tests.
 * Covers: retry backoff schedule, HTTP-response classification, delivery state
 * machine, dedup-key derivation, replay eligibility, HMAC signing/verification
 * with rotation grace window, and the maker-checker rotation guard.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  retryDelaySeconds,
  shouldRetry,
  computeNextRetryAt,
  classifyResponse,
  nextDeliveryState,
  isTerminal,
  makeDedupKey,
  canReplay,
} from "../src/modules/webhooks/delivery.js";
import {
  verifyWithRotation,
  assertCanDecide,
  decidedStatus,
  applyRotation,
  RotationError,
} from "../src/modules/webhooks/rotation.js";
import { signPayload } from "../src/modules/webhooks/commands.js";

describe("delivery retry backoff", () => {
  it("exposes the documented schedule 1m/5m/15m/1h/6h", () => {
    expect(RETRY_BACKOFF_SECONDS).toEqual([60, 300, 900, 3600, 21600]);
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it("retryDelaySeconds maps attempts to the schedule and clamps at the tail", () => {
    expect(retryDelaySeconds(0)).toBe(60);
    expect(retryDelaySeconds(1)).toBe(60);
    expect(retryDelaySeconds(2)).toBe(300);
    expect(retryDelaySeconds(3)).toBe(900);
    expect(retryDelaySeconds(4)).toBe(3600);
    expect(retryDelaySeconds(5)).toBe(21600);
    expect(retryDelaySeconds(99)).toBe(21600);
  });

  it("shouldRetry respects the attempt cap", () => {
    expect(shouldRetry(1)).toBe(true);
    expect(shouldRetry(4)).toBe(true);
    expect(shouldRetry(5)).toBe(false);
    expect(shouldRetry(2, 3)).toBe(true);
    expect(shouldRetry(3, 3)).toBe(false);
  });

  it("computeNextRetryAt schedules now+delay, null once exhausted", () => {
    const now = new Date("2026-07-25T10:00:00.000Z");
    expect(computeNextRetryAt(1, now)!.getTime() - now.getTime()).toBe(60_000);
    expect(computeNextRetryAt(2, now)!.getTime() - now.getTime()).toBe(300_000);
    expect(computeNextRetryAt(5, now)).toBeNull();
    expect(computeNextRetryAt(2, now, 3)!.getTime() - now.getTime()).toBe(300_000);
    expect(computeNextRetryAt(3, now, 3)).toBeNull();
  });
});

describe("response classification", () => {
  it("2xx is delivered", () => {
    for (const s of [200, 201, 202, 204, 299]) expect(classifyResponse(s)).toBe("delivered");
  });
  it("408/429/5xx and transport errors are retryable", () => {
    for (const s of [408, 429, 500, 502, 503, 504]) expect(classifyResponse(s)).toBe("retryable");
    expect(classifyResponse(null)).toBe("retryable");
    expect(classifyResponse(undefined)).toBe("retryable");
  });
  it("other 4xx are permanent", () => {
    for (const s of [400, 401, 403, 404, 410, 422]) expect(classifyResponse(s)).toBe("permanent");
  });
});

describe("delivery state machine", () => {
  const now = new Date("2026-07-25T10:00:00.000Z");

  it("delivered → terminal delivered", () => {
    expect(nextDeliveryState("delivered", 1, now)).toEqual({ status: "delivered", nextRetryAt: null });
  });
  it("permanent → terminal exhausted", () => {
    expect(nextDeliveryState("permanent", 1, now)).toEqual({ status: "exhausted", nextRetryAt: null });
  });
  it("retryable with attempts left → failed + next retry", () => {
    const t = nextDeliveryState("retryable", 1, now);
    expect(t.status).toBe("failed");
    expect(t.nextRetryAt!.getTime() - now.getTime()).toBe(60_000);
  });
  it("retryable at the cap → exhausted", () => {
    expect(nextDeliveryState("retryable", 5, now)).toEqual({ status: "exhausted", nextRetryAt: null });
  });
  it("isTerminal is true only for delivered/exhausted", () => {
    expect(isTerminal("delivered")).toBe(true);
    expect(isTerminal("exhausted")).toBe(true);
    expect(isTerminal("failed")).toBe(false);
    expect(isTerminal("pending")).toBe(false);
    expect(isTerminal("delivering")).toBe(false);
  });
});

describe("dedup + replay eligibility", () => {
  it("makeDedupKey combines webhook + event, null without event", () => {
    expect(makeDedupKey("wh1", "evt1")).toBe("wh1:evt1");
    expect(makeDedupKey("wh1", null)).toBeNull();
    expect(makeDedupKey("wh1", undefined)).toBeNull();
  });
  it("only terminal-or-failed deliveries can be replayed", () => {
    expect(canReplay("delivered")).toBe(true);
    expect(canReplay("exhausted")).toBe(true);
    expect(canReplay("failed")).toBe(true);
    expect(canReplay("pending")).toBe(false);
    expect(canReplay("delivering")).toBe(false);
  });
});

describe("HMAC signing + rotation grace window", () => {
  const body = JSON.stringify({ hello: "world", n: 42 });
  const current = "whsec_current_secret_value_1234567890";
  const previous = "whsec_previous_secret_value_0987654321";

  it("signature is deterministic and prefixed sha256=", () => {
    const sig = signPayload(current, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signPayload(current, body)).toBe(sig);
  });

  it("verifies against the current secret", () => {
    const sig = signPayload(current, body);
    expect(verifyWithRotation(current, previous, body, sig)).toBe(true);
  });

  it("verifies against the previous secret during grace window", () => {
    const sig = signPayload(previous, body);
    expect(verifyWithRotation(current, previous, body, sig)).toBe(true);
  });

  it("rejects an unknown secret and a null previous", () => {
    const sig = signPayload("some_other_secret_value_aaaaaaaaaaaa", body);
    expect(verifyWithRotation(current, previous, body, sig)).toBe(false);
    expect(verifyWithRotation(current, null, body, signPayload(previous, body))).toBe(false);
  });

  it("rejects a tampered body", () => {
    const sig = signPayload(current, body);
    expect(verifyWithRotation(current, previous, body + "x", sig)).toBe(false);
  });
});

describe("maker-checker rotation guard", () => {
  const maker = "11111111-1111-4000-8000-000000000001";
  const checker = "22222222-2222-4000-8000-000000000002";

  it("blocks the requester from deciding their own rotation", () => {
    expect(() => assertCanDecide({ status: "pending", requestedBy: maker }, maker))
      .toThrowError(RotationError);
    try {
      assertCanDecide({ status: "pending", requestedBy: maker }, maker);
    } catch (e) {
      expect((e as RotationError).code).toBe("MAKER_CHECKER");
    }
  });

  it("blocks deciding a non-pending rotation", () => {
    try {
      assertCanDecide({ status: "approved", requestedBy: maker }, checker);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as RotationError).code).toBe("NOT_PENDING");
    }
  });

  it("allows a different actor to decide a pending rotation", () => {
    expect(() => assertCanDecide({ status: "pending", requestedBy: maker }, checker)).not.toThrow();
  });

  it("decidedStatus maps decision to status", () => {
    expect(decidedStatus("approve")).toBe("approved");
    expect(decidedStatus("reject")).toBe("rejected");
  });

  it("applyRotation moves the live secret into the grace slot", () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const out = applyRotation("old_secret", "new_secret", now);
    expect(out).toEqual({ secret: "new_secret", previousSecret: "old_secret", secretRotatedAt: now });
  });
});
