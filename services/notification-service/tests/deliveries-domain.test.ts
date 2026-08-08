/**
 * Notification Deliveries — Consent Gate + Retry Domain Tests
 *
 * Module: services/notification-service/src/modules/deliveries
 * Pack: Notification_Module_Test_Pack/09_Deliveries_Test_Prompt.md
 *
 * Tests:
 *   1. decideGate: suppression → skip, marketing consent, channel consent, DND hold
 *   2. channelConsented: per-channel consent with opt-in requirements
 *   3. isMarketingSend: classification of marketing vs transactional
 *   4. retry: delay schedule, max retries, shouldRetry
 *   5. Fail-closed: unknown consent → skip (never deliver without consent)
 */
import { describe, it, expect } from "vitest";
import { decideGate, channelConsented, isMarketingSend, findPref, type GateInput, type ConsentPref } from "../src/modules/deliveries/consent-gate.js";
import { retryDelaySeconds, computeNextRetryAt, shouldRetry, MAX_DELIVERY_RETRIES, RETRY_DELAY_SECONDS } from "../src/modules/deliveries/retry.js";

// ─── 1. decideGate — consent gate evaluation ─────────────────────────────────

describe("decideGate — outbound consent gate", () => {
  const BASE_INPUT: GateInput = {
    suppressed: false,
    dnd: { action: "deliver" },
    prefs: [],
    candidateChannels: ["email"],
    marketing: { required: false, consent: "granted" },
  };

  it("suppressed recipient → skip (terminal)", () => {
    const r = decideGate({ ...BASE_INPUT, suppressed: true });
    expect(r.action).toBe("skip");
    if (r.action === "skip") expect(r.reason).toBe("recipient_suppressed");
  });

  it("marketing consent denied → skip", () => {
    const r = decideGate({ ...BASE_INPUT, marketing: { required: true, consent: "denied" } });
    expect(r.action).toBe("skip");
    if (r.action === "skip") expect(r.reason).toBe("marketing_consent_denied");
  });

  it("marketing consent unknown → skip (fail closed)", () => {
    const r = decideGate({ ...BASE_INPUT, marketing: { required: true, consent: "unknown" } });
    expect(r.action).toBe("skip");
    if (r.action === "skip") expect(r.reason).toBe("marketing_consent_unknown");
  });

  it("marketing consent deferred → NOT checked (later stage handles)", () => {
    const r = decideGate({ ...BASE_INPUT, marketing: { required: true, consent: "deferred" }, candidateChannels: ["email"] });
    expect(r.action).toBe("send"); // passes — deferred skips the check
  });

  it("transactional send → marketing consent NOT consulted", () => {
    const r = decideGate({ ...BASE_INPUT, marketing: { required: false, consent: "denied" } });
    expect(r.action).toBe("send"); // transactional ignores marketing consent
  });

  it("all candidate channels refused → skip (channel_consent_denied)", () => {
    const pref: ConsentPref = { eventType: "x", inApp: false, email: false, push: false, sms: false, whatsapp: false };
    const r = decideGate({ ...BASE_INPUT, prefs: [pref], candidateChannels: ["email", "sms"], marketing: { required: true, consent: "granted" } });
    expect(r.action).toBe("skip");
    if (r.action === "skip") expect(r.reason).toBe("channel_consent_denied");
  });

  it("DND active → hold with releaseAt", () => {
    const releaseAt = new Date("2026-07-15T06:00:00Z");
    const r = decideGate({ ...BASE_INPUT, dnd: { action: "hold", releaseAt } });
    expect(r.action).toBe("hold");
    if (r.action === "hold") expect(r.releaseAt).toBe(releaseAt);
  });

  it("all clear → send with consented channels", () => {
    const r = decideGate({ ...BASE_INPUT, candidateChannels: ["email", "push"] });
    expect(r.action).toBe("send");
    if (r.action === "send") expect(r.channels).toEqual(["email", "push"]);
  });

  it("evaluation order: suppression checked before DND (suppressed recipient not held)", () => {
    const r = decideGate({ ...BASE_INPUT, suppressed: true, dnd: { action: "hold", releaseAt: new Date() } });
    expect(r.action).toBe("skip"); // suppression wins over hold
  });
});

// ─── 2. channelConsented ─────────────────────────────────────────────────────

describe("channelConsented — per-channel consent logic", () => {
  const pref: ConsentPref = { eventType: "x", inApp: true, email: true, push: true, sms: null, whatsapp: false };

  it("email explicitly true → consented", () => expect(channelConsented("email", pref, false)).toBe(true));
  it("whatsapp explicitly false → NOT consented", () => expect(channelConsented("whatsapp", pref, false)).toBe(false));
  it("sms null + transactional → consented (null = no choice, transactional allowed)", () => {
    expect(channelConsented("sms", pref, false)).toBe(true);
  });
  it("sms null + marketing → NOT consented (opt-in required for commercial SMS)", () => {
    expect(channelConsented("sms", pref, true)).toBe(false);
  });
  it("unknown channel → implied consent if in implicit set", () => {
    expect(channelConsented("webhook", undefined, false)).toBe(true);
  });
  it("no pref at all + email → implied consent (default channels)", () => {
    expect(channelConsented("email", undefined, false)).toBe(true);
  });
});

// ─── 3. isMarketingSend ──────────────────────────────────────────────────────

describe("isMarketingSend — marketing vs transactional classification", () => {
  it("category=marketing → true", () => expect(isMarketingSend({ category: "marketing" })).toBe(true));
  it("has campaignId → true", () => expect(isMarketingSend({ campaignId: "c1" })).toBe(true));
  it("eventType starts with marketing. → true", () => expect(isMarketingSend({ eventType: "marketing.promo" })).toBe(true));
  it("eventType starts with campaign. → true", () => expect(isMarketingSend({ eventType: "campaign.welcome" })).toBe(true));
  it("transactional (no markers) → false", () => expect(isMarketingSend({ category: "transactional" })).toBe(false));
  it("no inputs at all → false (default transactional)", () => expect(isMarketingSend({})).toBe(false));
});

// ─── 4. Retry logic ──────────────────────────────────────────────────────────

describe("retry — exponential backoff schedule", () => {
  it("retry 0 → 900s (15 minutes)", () => expect(retryDelaySeconds(0)).toBe(900));
  it("retry 1 → 3600s (60 minutes)", () => expect(retryDelaySeconds(1)).toBe(3600));
  it("retry 2 → 14400s (240 minutes / 4 hours)", () => expect(retryDelaySeconds(2)).toBe(14400));
  it("retry beyond max → caps at last delay", () => expect(retryDelaySeconds(99)).toBe(14400));

  it("shouldRetry: below max → true", () => expect(shouldRetry(2)).toBe(true));
  it("shouldRetry: at max → false", () => expect(shouldRetry(3)).toBe(false));
  it("shouldRetry: above max → false", () => expect(shouldRetry(5)).toBe(false));
  it("MAX_DELIVERY_RETRIES = 3", () => expect(MAX_DELIVERY_RETRIES).toBe(3));

  it("computeNextRetryAt: adds delay to now", () => {
    const now = new Date("2026-07-15T10:00:00Z");
    const next = computeNextRetryAt(0, now);
    expect(next.getTime()).toBe(now.getTime() + 900_000); // 15 min
  });
});

// ─── 5. findPref — preference resolution ────────────────────────────────────

describe("findPref — event-specific preference lookup", () => {
  const prefs: ConsentPref[] = [
    { eventType: "generic", inApp: true, email: true, push: true, sms: null, whatsapp: null },
    { eventType: "leave.approved", inApp: true, email: false, push: true, sms: null, whatsapp: null },
  ];

  it("exact event match wins", () => {
    expect(findPref(prefs, "leave.approved")!.email).toBe(false);
  });

  it("no match → first pref (generic fallback)", () => {
    expect(findPref(prefs, "unknown.event")!.eventType).toBe("generic");
  });

  it("no eventType → first pref", () => {
    expect(findPref(prefs)!.eventType).toBe("generic");
  });

  it("empty prefs → undefined", () => {
    expect(findPref([])).toBeUndefined();
  });
});
