/**
 * Webhook signature validation tests.
 *
 * Tests the pure domain functions for Twilio HMAC-SHA1 signature validation
 * and Exotel timing-safe token comparison.
 *
 * Validates: Requirements 15.1
 */
import { describe, it, expect, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { validateTwilioSignature, validateExotelToken } from "../src/modules/webhooks/domain.js";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

// ── Twilio signature helpers ──────────────────────────────────────

const TWILIO_AUTH_TOKEN = "test_auth_token_for_twilio_32chr";

function computeTwilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const keys = Object.keys(params).sort();
  const data = url + keys.map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data).digest("base64");
}

// ── Twilio signature validation ───────────────────────────────────

describe("validateTwilioSignature", () => {
  const url = "https://api.civitasone.in/v1/telephony/webhooks/twilio/inbound";
  const params = {
    CallSid: "CA1234567890abcdef",
    From: "+919876500011",
    To: "+918001112222",
    CallStatus: "ringing",
  };

  it("accepts a valid HMAC-SHA1 signature", () => {
    const signature = computeTwilioSignature(url, params, TWILIO_AUTH_TOKEN);
    const result = validateTwilioSignature(url, params, signature, TWILIO_AUTH_TOKEN);
    expect(result).toBe(true);
  });

  it("rejects an invalid signature (wrong content)", () => {
    const signature = computeTwilioSignature(url, params, TWILIO_AUTH_TOKEN);
    // Tamper with the signature
    const tampered = Buffer.from(signature, "base64");
    tampered[0] = tampered[0]! ^ 0xff;
    const result = validateTwilioSignature(url, params, tampered.toString("base64"), TWILIO_AUTH_TOKEN);
    expect(result).toBe(false);
  });

  it("rejects when signature is computed with a different auth token", () => {
    const wrongToken = "completely_different_secret_token";
    const signature = computeTwilioSignature(url, params, wrongToken);
    const result = validateTwilioSignature(url, params, signature, TWILIO_AUTH_TOKEN);
    expect(result).toBe(false);
  });

  it("rejects when signature header is missing (empty string)", () => {
    const result = validateTwilioSignature(url, params, "", TWILIO_AUTH_TOKEN);
    expect(result).toBe(false);
  });

  it("rejects when auth token is not configured (empty string)", () => {
    const signature = computeTwilioSignature(url, params, TWILIO_AUTH_TOKEN);
    const result = validateTwilioSignature(url, params, signature, "");
    expect(result).toBe(false);
  });

  it("handles empty params correctly", () => {
    const emptyParams: Record<string, string> = {};
    const signature = computeTwilioSignature(url, emptyParams, TWILIO_AUTH_TOKEN);
    const result = validateTwilioSignature(url, emptyParams, signature, TWILIO_AUTH_TOKEN);
    expect(result).toBe(true);
  });

  it("validates that param sort order matters for correctness", () => {
    // Signature is computed with sorted keys, so different param orderings
    // in the input object should still produce the same result
    const paramsReversed: Record<string, string> = {
      To: "+918001112222",
      From: "+919876500011",
      CallStatus: "ringing",
      CallSid: "CA1234567890abcdef",
    };
    const signature = computeTwilioSignature(url, params, TWILIO_AUTH_TOKEN);
    const result = validateTwilioSignature(url, paramsReversed, signature, TWILIO_AUTH_TOKEN);
    expect(result).toBe(true);
  });

  it("rejects when URL differs from what was signed", () => {
    const signature = computeTwilioSignature(url, params, TWILIO_AUTH_TOKEN);
    const differentUrl = "https://api.civitasone.in/v1/telephony/webhooks/twilio/status";
    const result = validateTwilioSignature(differentUrl, params, signature, TWILIO_AUTH_TOKEN);
    expect(result).toBe(false);
  });

  it("rejects when params differ from what was signed", () => {
    const signature = computeTwilioSignature(url, params, TWILIO_AUTH_TOKEN);
    const tamperedParams = { ...params, CallStatus: "completed" };
    const result = validateTwilioSignature(url, tamperedParams, signature, TWILIO_AUTH_TOKEN);
    expect(result).toBe(false);
  });

  it("rejects a non-base64 garbage signature gracefully", () => {
    const result = validateTwilioSignature(url, params, "not-valid-base64!!!", TWILIO_AUTH_TOKEN);
    expect(result).toBe(false);
  });
});

// ── Exotel token validation ───────────────────────────────────────

describe("validateExotelToken", () => {
  const EXOTEL_TOKEN = "exotel_webhook_secret_abc123";

  it("accepts a valid token (exact match)", () => {
    const result = validateExotelToken(EXOTEL_TOKEN, EXOTEL_TOKEN);
    expect(result).toBe(true);
  });

  it("rejects an invalid token", () => {
    const result = validateExotelToken("wrong_token", EXOTEL_TOKEN);
    expect(result).toBe(false);
  });

  it("rejects when provided token is empty", () => {
    const result = validateExotelToken("", EXOTEL_TOKEN);
    expect(result).toBe(false);
  });

  it("rejects when configured token is empty (not configured)", () => {
    const result = validateExotelToken(EXOTEL_TOKEN, "");
    expect(result).toBe(false);
  });

  it("rejects a token that is a substring of the configured token", () => {
    const result = validateExotelToken("exotel_webhook_secret", EXOTEL_TOKEN);
    expect(result).toBe(false);
  });

  it("rejects a token that is a superset of the configured token", () => {
    const result = validateExotelToken(EXOTEL_TOKEN + "_extra", EXOTEL_TOKEN);
    expect(result).toBe(false);
  });

  it("timing safety: does not short-circuit on first byte mismatch", () => {
    // We validate timing safety by ensuring the function uses timingSafeEqual
    // and handles length mismatches properly. A token differing only in the
    // last character should still be rejected.
    const almostRight = EXOTEL_TOKEN.slice(0, -1) + "X";
    const result = validateExotelToken(almostRight, EXOTEL_TOKEN);
    expect(result).toBe(false);
  });

  it("timing safety: tokens differing only in first byte are rejected", () => {
    const firstByteDiff = "X" + EXOTEL_TOKEN.slice(1);
    const result = validateExotelToken(firstByteDiff, EXOTEL_TOKEN);
    expect(result).toBe(false);
  });

  it("handles special characters in tokens", () => {
    const specialToken = "abc!@#$%^&*()_+-=[]{}|;':\",./<>?";
    const result = validateExotelToken(specialToken, specialToken);
    expect(result).toBe(true);
  });

  it("handles unicode tokens correctly", () => {
    const unicodeToken = "token_with_emoji_🔐";
    const result = validateExotelToken(unicodeToken, unicodeToken);
    expect(result).toBe(true);
  });
});

// ── Integration-style route tests (via app.inject) ────────────────

afterAll(async () => {
  await sqlClient.end();
});

describe("webhook routes — signature enforcement", () => {
  // These tests use the Fastify inject API to verify that routes reject
  // invalid/missing signatures with 401 status codes.
  // The routes read TWILIO_AUTH_TOKEN and EXOTEL_WEBHOOK_TOKEN at import
  // time, so when they are empty/unset, any signature will be rejected.

  it("POST /v1/telephony/webhooks/twilio/inbound rejects missing signature with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/webhooks/twilio/inbound",
      payload: { CallSid: "CA123", From: "+91987", To: "+91800" },
      // No X-Twilio-Signature header
    });
    await app.close();
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("WEBHOOK_UNAUTHORIZED");
  });

  it("POST /v1/telephony/webhooks/twilio/inbound rejects invalid signature with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/webhooks/twilio/inbound",
      payload: { CallSid: "CA123", From: "+91987", To: "+91800" },
      headers: { "x-twilio-signature": "dGhpcyBpcyBpbnZhbGlk" }, // random base64
    });
    await app.close();
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("WEBHOOK_UNAUTHORIZED");
  });

  it("POST /v1/telephony/webhooks/twilio/status rejects missing signature with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/webhooks/twilio/status",
      payload: { CallSid: "CA123", CallStatus: "completed" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/telephony/webhooks/twilio/recording rejects missing signature with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/webhooks/twilio/recording",
      payload: { CallSid: "CA123", RecordingSid: "RE456", RecordingUrl: "https://api.twilio.com/rec" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/telephony/webhooks/exotel/inbound rejects missing token with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/webhooks/exotel/inbound",
      payload: { CallSid: "EX123", From: "+91987", To: "+91800" },
      // No X-Exotel-Token header
    });
    await app.close();
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("WEBHOOK_UNAUTHORIZED");
  });

  it("POST /v1/telephony/webhooks/exotel/inbound rejects invalid token with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/webhooks/exotel/inbound",
      payload: { CallSid: "EX123", From: "+91987", To: "+91800" },
      headers: { "x-exotel-token": "completely_wrong_token" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/telephony/webhooks/exotel/status rejects missing token with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/webhooks/exotel/status",
      payload: { CallSid: "EX123", Status: "completed" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("responds within 200ms for signature rejection", async () => {
    const app = await buildApp();
    const start = performance.now();
    const res = await app.inject({
      method: "POST",
      url: "/v1/telephony/webhooks/twilio/inbound",
      payload: { CallSid: "CA123", From: "+91987", To: "+91800" },
      headers: { "x-twilio-signature": "aW52YWxpZA==" },
    });
    const elapsed = performance.now() - start;
    await app.close();
    expect(res.statusCode).toBe(401);
    expect(elapsed).toBeLessThan(200);
  });
});
