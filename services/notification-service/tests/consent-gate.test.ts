/**
 * R1 — outbound consent gate, pure decision + CRM lookup unit tests.
 *
 * No DB, no network. The decision function is deliberately pure so every
 * fail-closed branch can be asserted directly; the CRM client is exercised
 * against a stubbed `fetch`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  decideGate,
  channelConsented,
  findPref,
  isMarketingSend,
  type ConsentPref,
} from "../src/modules/deliveries/consent-gate.js";
import type { DndDecision } from "../src/modules/dnd/domain.js";

const DELIVER: DndDecision = { action: "deliver" };
const HOLD: DndDecision = { action: "hold", releaseAt: new Date("2026-08-04T00:30:00.000Z") };

function pref(over: Partial<ConsentPref> = {}): ConsentPref {
  return {
    eventType: "alert",
    inApp: true, email: true, push: false, sms: false, whatsapp: false,
    ...over,
  };
}

function input(over: Partial<Parameters<typeof decideGate>[0]> = {}): Parameters<typeof decideGate>[0] {
  return {
    suppressed: false,
    dnd: DELIVER,
    prefs: [],
    eventType: "alert",
    candidateChannels: ["email"],
    marketing: { required: false, consent: "unknown" },
    ...over,
  };
}

describe("R1 gate — suppression list", () => {
  it("a suppressed recipient is refused before anything else is considered", () => {
    // Everything else says "send" — suppression alone must stop it.
    const d = decideGate(input({ suppressed: true }));
    expect(d).toEqual({ action: "skip", reason: "recipient_suppressed" });
  });

  it("suppression wins over a DND hold (a refusal is not deferred)", () => {
    const d = decideGate(input({ suppressed: true, dnd: HOLD }));
    expect(d).toEqual({ action: "skip", reason: "recipient_suppressed" });
  });

  it("a released suppression (suppressed=false) does not block the send", () => {
    expect(decideGate(input()).action).toBe("send");
  });
});

describe("R1 gate — DND window", () => {
  it("an active window defers the send with the window's release time", () => {
    const d = decideGate(input({ dnd: HOLD }));
    expect(d).toEqual({ action: "hold", releaseAt: HOLD.action === "hold" ? HOLD.releaseAt : new Date(0) });
  });

  it("a DND hold never becomes a send", () => {
    expect(decideGate(input({ dnd: HOLD })).action).not.toBe("send");
  });

  it("no active window sends on the consented channels", () => {
    expect(decideGate(input({ candidateChannels: ["email", "in_app"] }))).toEqual({
      action: "send", channels: ["email", "in_app"],
    });
  });
});

describe("R1 gate — per-channel consent", () => {
  it("a channel the recipient disabled is removed from the attempt list", () => {
    const d = decideGate(input({
      prefs: [pref({ email: false, inApp: true })],
      candidateChannels: ["email", "in_app"],
    }));
    expect(d).toEqual({ action: "send", channels: ["in_app"] });
  });

  it("every candidate channel refused → skip, nothing is attempted", () => {
    const d = decideGate(input({
      prefs: [pref({ email: false, inApp: false, push: false })],
      candidateChannels: ["email", "in_app", "push"],
    }));
    expect(d).toEqual({ action: "skip", reason: "channel_consent_denied" });
  });

  it("consent is read from the row matching the event type, not the first row", () => {
    const prefs = [pref({ eventType: "other", email: false }), pref({ eventType: "alert", email: true })];
    expect(decideGate(input({ prefs, eventType: "alert" })).action).toBe("send");
  });

  it("sms is refused when no opt-in was ever recorded (TRAI/DLT fail closed)", () => {
    const d = decideGate(input({ prefs: [], candidateChannels: ["sms"] }));
    expect(d).toEqual({ action: "skip", reason: "channel_consent_denied" });
  });

  it("whatsapp is refused when no opt-in was ever recorded", () => {
    const d = decideGate(input({ prefs: [], candidateChannels: ["whatsapp"] }));
    expect(d).toEqual({ action: "skip", reason: "channel_consent_denied" });
  });

  it("sms is allowed once the recipient has opted in", () => {
    const d = decideGate(input({
      prefs: [pref({ sms: true })], candidateChannels: ["sms"],
    }));
    expect(d).toEqual({ action: "send", channels: ["sms"] });
  });

  it("email with no pref row at all is still delivered (transactional default)", () => {
    expect(decideGate(input({ prefs: [] })).action).toBe("send");
  });

  it("a refused channel is dropped even when it is only a FALLBACK", () => {
    // in_app is preferred and consented; email is the fallback and refused.
    // The fallback must not be attempted.
    const d = decideGate(input({
      prefs: [pref({ inApp: true, email: false })],
      candidateChannels: ["in_app", "email"],
    }));
    expect(d).toEqual({ action: "send", channels: ["in_app"] });
  });
});

describe("R1 gate — CRM marketing consent", () => {
  it("marketing_consent=false → skipped, no adapter reached", () => {
    const d = decideGate(input({ marketing: { required: true, consent: "denied" } }));
    expect(d).toEqual({ action: "skip", reason: "marketing_consent_denied" });
  });

  it("consent that cannot be established fails CLOSED (unknown → skip)", () => {
    const d = decideGate(input({ marketing: { required: true, consent: "unknown" } }));
    expect(d).toEqual({ action: "skip", reason: "marketing_consent_unknown" });
  });

  it("marketing_consent=true proceeds to the channel checks", () => {
    const d = decideGate(input({ marketing: { required: true, consent: "granted" } }));
    expect(d).toEqual({ action: "send", channels: ["email"] });
  });

  it("a transactional send is not blocked by an unknown marketing consent", () => {
    const d = decideGate(input({ marketing: { required: false, consent: "unknown" } }));
    expect(d.action).toBe("send");
  });

  it("a denied marketing consent is refused rather than deferred by DND", () => {
    const d = decideGate(input({ dnd: HOLD, marketing: { required: true, consent: "denied" } }));
    expect(d).toEqual({ action: "skip", reason: "marketing_consent_denied" });
  });
});

describe("channelConsented / findPref", () => {
  it("a matching pref row overrides implied consent for every channel", () => {
    expect(channelConsented("email", pref({ email: false }))).toBe(false);
    expect(channelConsented("push", pref({ push: true }))).toBe(true);
  });

  it("webhook is a machine endpoint — recipient consent does not gate it", () => {
    expect(channelConsented("webhook", undefined)).toBe(true);
  });

  it("an unrecognised channel with no pref row is refused", () => {
    expect(channelConsented("carrier_pigeon", undefined)).toBe(false);
  });

  it("findPref prefers the event-specific row and falls back to the first", () => {
    const a = pref({ eventType: "a" });
    const b = pref({ eventType: "b" });
    expect(findPref([a, b], "b")).toBe(b);
    expect(findPref([a, b], "missing")).toBe(a);
    expect(findPref([a, b], undefined)).toBe(a);
    expect(findPref([], "a")).toBeUndefined();
  });
});

describe("isMarketingSend", () => {
  it("is true for an explicit marketing category, a campaign, or a marketing event", () => {
    expect(isMarketingSend({ category: "marketing" })).toBe(true);
    expect(isMarketingSend({ campaignId: "c1" })).toBe(true);
    expect(isMarketingSend({ eventType: "marketing.newsletter" })).toBe(true);
    expect(isMarketingSend({ eventType: "campaign.blast" })).toBe(true);
  });

  it("is false for operational traffic", () => {
    expect(isMarketingSend({})).toBe(false);
    expect(isMarketingSend({ category: "transactional", eventType: "hrms.leave.approved" })).toBe(false);
  });
});

describe("R1 — CRM consent client fails closed", () => {
  const realFetch = globalThis.fetch;
  const CONTACT = "aaaaaaaa-1111-4000-8000-00000000000a";
  const TENANT = "bbbbbbbb-2222-4000-8000-00000000000b";

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_SECRET = "test-internal-secret";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  async function lookup(): Promise<string> {
    const { fetchMarketingConsent } = await import("../src/modules/deliveries/crm-consent-client.js");
    return fetchMarketingConsent(CONTACT, TENANT, "corr-1");
  }

  function stubFetch(impl: () => Promise<Response> | Response): void {
    globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
  }

  it("marketingConsent=true → granted", async () => {
    stubFetch(() => new Response(JSON.stringify({ marketingConsent: true }), { status: 200 }));
    expect(await lookup()).toBe("granted");
  });

  it("marketingConsent=false → denied", async () => {
    stubFetch(() => new Response(JSON.stringify({ marketingConsent: false }), { status: 200 }));
    expect(await lookup()).toBe("denied");
  });

  it("crm-service unreachable → unknown (gate then refuses the send)", async () => {
    stubFetch(() => Promise.reject(new Error("ECONNREFUSED")));
    expect(await lookup()).toBe("unknown");
  });

  it("crm-service 500 → unknown", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));
    expect(await lookup()).toBe("unknown");
  });

  it("contact not found (404) → unknown, never treated as consent", async () => {
    stubFetch(() => new Response("", { status: 404 }));
    expect(await lookup()).toBe("unknown");
  });

  it("a response without the consent field → unknown", async () => {
    stubFetch(() => new Response(JSON.stringify({ id: CONTACT }), { status: 200 }));
    expect(await lookup()).toBe("unknown");
  });

  it("a non-uuid recipient is never sent to crm-service", async () => {
    const spy = vi.fn(() => new Response("{}", { status: 200 }));
    stubFetch(spy);
    const { fetchMarketingConsent } = await import("../src/modules/deliveries/crm-consent-client.js");
    expect(await fetchMarketingConsent("officer@dept.gov.in", TENANT, "corr-1")).toBe("unknown");
    expect(spy).not.toHaveBeenCalled();
  });

  it("without INTERNAL_SERVICE_SECRET the lookup is unverifiable → unknown", async () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const spy = vi.fn(() => new Response("{}", { status: 200 }));
    stubFetch(spy);
    expect(await lookup()).toBe("unknown");
    expect(spy).not.toHaveBeenCalled();
  });

  it("the internal auth headers are sent (crm-service authenticates the caller)", async () => {
    let seen: Record<string, string> = {};
    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => {
      seen = (init?.headers ?? {}) as Record<string, string>;
      return Promise.resolve(new Response(JSON.stringify({ marketingConsent: true }), { status: 200 }));
    }) as unknown as typeof fetch;
    await lookup();
    expect(seen["x-internal"]).toBe("1");
    expect(seen["x-service-secret"]).toBe("test-internal-secret");
    expect(seen["x-tenant-id"]).toBe(TENANT);
  });
});
