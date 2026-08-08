/**
 * Notification Bounces & Suppressions — Domain Tests
 *
 * Module: services/notification-service/src/modules/bounces
 * Pack: Notification_Module_Test_Pack/05_Bounces_Test_Prompt.md
 *
 * Tests:
 *   1. classifyBounce: SMTP codes (5xx=hard, 4xx=soft, overrides)
 *   2. classifyBounce: reason-text fallback (keyword patterns)
 *   3. classifyBounce: "unknown" safety (never false-suppress)
 *   4. decideSuppression: hard → suppress, soft threshold, unknown → no suppress
 *   5. normalizeFeedbackType: canonicalize ESP complaint types
 *   6. decideComplaintSuppression: always suppresses (one complaint = terminal)
 *   7. resolveSoftBounceThreshold: tenant > env > default(5)
 */
import { describe, it, expect } from "vitest";
import {
  classifyBounce,
  decideSuppression,
  decideComplaintSuppression,
  normalizeFeedbackType,
  resolveSoftBounceThreshold,
  DEFAULT_SOFT_BOUNCE_THRESHOLD,
  type BounceClassification,
} from "../src/modules/bounces/domain.js";

// ─── 1. classifyBounce — SMTP code classification ───────────────────────────

describe("classifyBounce — SMTP enhanced status codes", () => {
  it("5.1.1 (user unknown) → hard", () => {
    expect(classifyBounce({ smtpCode: "5.1.1" })).toBe("hard");
  });

  it("5.1.0 (address rejected) → hard", () => {
    expect(classifyBounce({ smtpCode: "5.1.0" })).toBe("hard");
  });

  it("4.2.1 (mailbox disabled temporarily) → soft", () => {
    expect(classifyBounce({ smtpCode: "4.2.1" })).toBe("soft");
  });

  it("5.2.2 (mailbox full) → SOFT override (temporary condition)", () => {
    // Source: SOFT_OVERRIDE_ENHANCED includes "5.2.2"
    expect(classifyBounce({ smtpCode: "5.2.2" })).toBe("soft");
  });

  it("5.3.1 (mail system full) → SOFT override", () => {
    expect(classifyBounce({ smtpCode: "5.3.1" })).toBe("soft");
  });

  it("4.1.1 (unknown mailbox via transient code) → HARD override", () => {
    // Source: HARD_OVERRIDE_ENHANCED includes "4.1.1"
    expect(classifyBounce({ smtpCode: "4.1.1" })).toBe("hard");
  });
});

describe("classifyBounce — 3-digit reply codes", () => {
  it("550 → hard", () => expect(classifyBounce({ smtpCode: "550" })).toBe("hard"));
  it("553 → hard", () => expect(classifyBounce({ smtpCode: "553" })).toBe("hard"));
  it("421 → soft", () => expect(classifyBounce({ smtpCode: "421" })).toBe("soft"));
  it("450 → soft", () => expect(classifyBounce({ smtpCode: "450" })).toBe("soft"));
  it("250 (success) → unknown (not a bounce)", () => expect(classifyBounce({ smtpCode: "250" })).toBe("unknown"));
});

describe("classifyBounce — reason text overrides code", () => {
  it("5xx code + 'mailbox full' reason → soft (reason wins)", () => {
    expect(classifyBounce({ smtpCode: "552", reason: "mailbox full" })).toBe("soft");
  });

  it("4xx code + 'user unknown' reason → hard (reason wins)", () => {
    expect(classifyBounce({ smtpCode: "450", reason: "user unknown" })).toBe("hard");
  });
});

// ─── 2. classifyBounce — reason-text keyword fallback ────────────────────────

describe("classifyBounce — reason keywords (no code)", () => {
  it("'user unknown' → hard", () => expect(classifyBounce({ reason: "user unknown" })).toBe("hard"));
  it("'no such user' → hard", () => expect(classifyBounce({ reason: "no such user at this domain" })).toBe("hard"));
  it("'account disabled' → hard", () => expect(classifyBounce({ reason: "account has been disabled" })).toBe("hard"));
  it("'mailbox unavailable' → hard", () => expect(classifyBounce({ reason: "mailbox unavailable" })).toBe("hard"));

  it("'over quota' → soft", () => expect(classifyBounce({ reason: "over quota" })).toBe("soft"));
  it("'try again later' → soft", () => expect(classifyBounce({ reason: "try again later" })).toBe("soft"));
  it("'greylisted' → soft", () => expect(classifyBounce({ reason: "greylisted by recipient" })).toBe("soft"));
  it("'rate limited' → soft", () => expect(classifyBounce({ reason: "rate limited" })).toBe("soft"));
});

// ─── 3. classifyBounce — "unknown" safety ────────────────────────────────────

describe("classifyBounce — unknown (safe default)", () => {
  it("empty code + empty reason → unknown", () => {
    expect(classifyBounce({})).toBe("unknown");
    expect(classifyBounce({ smtpCode: "", reason: "" })).toBe("unknown");
  });

  it("unrecognizable reason → unknown", () => {
    expect(classifyBounce({ reason: "some random ESP diagnostic text" })).toBe("unknown");
  });

  it("null inputs → unknown", () => {
    expect(classifyBounce({ smtpCode: null, reason: null })).toBe("unknown");
  });
});

// ─── 4. decideSuppression — suppression gate ─────────────────────────────────

describe("decideSuppression", () => {
  it("hard bounce → suppress immediately (reason: hard_bounce)", () => {
    const r = decideSuppression("hard", 1, 5);
    expect(r.suppress).toBe(true);
    expect(r.reason).toBe("hard_bounce");
  });

  it("soft bounce below threshold → no suppress (reason: transient)", () => {
    const r = decideSuppression("soft", 3, 5);
    expect(r.suppress).toBe(false);
    expect(r.reason).toBe("transient");
  });

  it("soft bounce AT threshold → suppress (reason: soft_bounce_threshold)", () => {
    const r = decideSuppression("soft", 5, 5);
    expect(r.suppress).toBe(true);
    expect(r.reason).toBe("soft_bounce_threshold");
  });

  it("soft bounce ABOVE threshold → suppress", () => {
    expect(decideSuppression("soft", 10, 5).suppress).toBe(true);
  });

  it("unknown → NEVER suppress (reason: not_a_bounce)", () => {
    const r = decideSuppression("unknown", 99, 5);
    expect(r.suppress).toBe(false);
    expect(r.reason).toBe("not_a_bounce");
  });
});

// ─── 5. normalizeFeedbackType — complaint classification ─────────────────────

describe("normalizeFeedbackType", () => {
  it("'abuse' → abuse", () => expect(normalizeFeedbackType("abuse")).toBe("abuse"));
  it("'FRAUD' (uppercase) → fraud", () => expect(normalizeFeedbackType("FRAUD")).toBe("fraud"));
  it("' Virus ' (whitespace) → virus", () => expect(normalizeFeedbackType(" Virus ")).toBe("virus"));
  it("'other' → other", () => expect(normalizeFeedbackType("other")).toBe("other"));
  it("unrecognized value → 'other' (degraded, not rejected)", () => {
    expect(normalizeFeedbackType("not-spam")).toBe("other");
    expect(normalizeFeedbackType("custom_type")).toBe("other");
  });
  it("null → null", () => expect(normalizeFeedbackType(null)).toBeNull());
  it("empty string → null", () => expect(normalizeFeedbackType("")).toBeNull());
  it("whitespace only → null", () => expect(normalizeFeedbackType("   ")).toBeNull());
});

// ─── 6. decideComplaintSuppression — always terminal ─────────────────────────

describe("decideComplaintSuppression", () => {
  it("always returns suppress=true, reason=complaint", () => {
    const r = decideComplaintSuppression();
    expect(r.suppress).toBe(true);
    expect(r.reason).toBe("complaint");
  });
});

// ─── 7. resolveSoftBounceThreshold ───────────────────────────────────────────

describe("resolveSoftBounceThreshold", () => {
  it("tenant setting wins when valid", () => {
    expect(resolveSoftBounceThreshold(3)).toBe(3);
  });

  it("env var wins when no tenant setting", () => {
    expect(resolveSoftBounceThreshold(null, { NOTIFICATION_SOFT_BOUNCE_THRESHOLD: "7" })).toBe(7);
  });

  it("defaults to 5 when nothing configured", () => {
    expect(resolveSoftBounceThreshold(null, {})).toBe(DEFAULT_SOFT_BOUNCE_THRESHOLD);
    expect(DEFAULT_SOFT_BOUNCE_THRESHOLD).toBe(5);
  });

  it("ignores invalid tenant setting (0, negative, non-integer)", () => {
    expect(resolveSoftBounceThreshold(0)).toBe(5);
    expect(resolveSoftBounceThreshold(-1)).toBe(5);
  });

  it("ignores invalid env var", () => {
    expect(resolveSoftBounceThreshold(null, { NOTIFICATION_SOFT_BOUNCE_THRESHOLD: "abc" })).toBe(5);
    expect(resolveSoftBounceThreshold(null, { NOTIFICATION_SOFT_BOUNCE_THRESHOLD: "0" })).toBe(5);
  });
});
