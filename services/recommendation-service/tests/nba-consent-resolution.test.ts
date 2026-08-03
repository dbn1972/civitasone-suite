/**
 * P2-1 — consent resolution unit tests.
 *
 * These exercise the edge helper and the CRM client directly, with the lookup
 * injected (no network), so the fail-closed matrix is pinned down without going
 * through Fastify. The HTTP-level proof lives in nba-consent-server-side.test.ts.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  requiresConsentResolution,
  resolveConsentGranted,
} from "../src/modules/nba/consent-resolution.js";
import {
  fetchMarketingConsent,
  type ConsentLookup,
  type MarketingConsent,
} from "../src/modules/nba/crm-consent-client.js";
import type { ActionCandidate } from "../src/modules/nba/ranking-domain.js";

const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const CORR = "corr-1";
const INTERNAL_SECRET = "internal_secret_for_tests_32chars";

function candidate(overrides: Partial<ActionCandidate> = {}): ActionCandidate {
  return {
    id: "c1",
    actionType: "marketing_offer",
    signals: { affinity: 1 },
    ...overrides,
  };
}

const lookupReturning = (verdict: MarketingConsent): ConsentLookup =>
  vi.fn(async () => verdict);

describe("requiresConsentResolution", () => {
  it("is false for an empty candidate set", () => {
    expect(requiresConsentResolution([])).toBe(false);
  });

  it("is false when no candidate carries eligibility rules", () => {
    expect(requiresConsentResolution([candidate()])).toBe(false);
  });

  it("is false when requiresConsent is explicitly false", () => {
    expect(
      requiresConsentResolution([
        candidate({ eligibility: { requiresConsent: false } }),
      ]),
    ).toBe(false);
  });

  it("is true when any candidate requires consent", () => {
    expect(
      requiresConsentResolution([
        candidate({ id: "open" }),
        candidate({ id: "gated", eligibility: { requiresConsent: true } }),
      ]),
    ).toBe(true);
  });
});

describe("resolveConsentGranted", () => {
  const gated = [
    candidate({ id: "gated", eligibility: { requiresConsent: true } }),
  ];

  it("does not call the lookup when nothing is gated", async () => {
    const lookup = lookupReturning("granted");
    expect(
      await resolveConsentGranted(
        [candidate()],
        PROFILE_ID,
        TENANT,
        CORR,
        lookup,
      ),
    ).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("passes the profile, tenant and correlation id straight through to the lookup", async () => {
    const lookup = lookupReturning("granted");
    await resolveConsentGranted(gated, PROFILE_ID, TENANT, CORR, lookup);
    expect(lookup).toHaveBeenCalledWith(PROFILE_ID, TENANT, CORR);
  });

  it("grants only on an explicit granted verdict", async () => {
    expect(
      await resolveConsentGranted(
        gated,
        PROFILE_ID,
        TENANT,
        CORR,
        lookupReturning("granted"),
      ),
    ).toBe(true);
  });

  it("fails closed on denied", async () => {
    expect(
      await resolveConsentGranted(
        gated,
        PROFILE_ID,
        TENANT,
        CORR,
        lookupReturning("denied"),
      ),
    ).toBe(false);
  });

  it("fails closed on unknown", async () => {
    expect(
      await resolveConsentGranted(
        gated,
        PROFILE_ID,
        TENANT,
        CORR,
        lookupReturning("unknown"),
      ),
    ).toBe(false);
  });
});

describe("fetchMarketingConsent", () => {
  let secretBefore: string | undefined;
  let timeoutBefore: string | undefined;

  beforeEach(() => {
    secretBefore = process.env.INTERNAL_SERVICE_SECRET;
    timeoutBefore = process.env.CRM_CONSENT_TIMEOUT_MS;
    process.env.INTERNAL_SERVICE_SECRET = INTERNAL_SECRET;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (secretBefore === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = secretBefore;
    if (timeoutBefore === undefined) delete process.env.CRM_CONSENT_TIMEOUT_MS;
    else process.env.CRM_CONSENT_TIMEOUT_MS = timeoutBefore;
  });

  function stubFetch(handler: (...a: unknown[]) => unknown) {
    const spy = vi.fn(handler);
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  const ok = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
  });

  it("returns granted for marketingConsent true", async () => {
    stubFetch(() => ok({ marketingConsent: true }));
    expect(await fetchMarketingConsent(PROFILE_ID, TENANT, CORR)).toBe(
      "granted",
    );
  });

  it("returns denied for marketingConsent false", async () => {
    stubFetch(() => ok({ marketingConsent: false }));
    expect(await fetchMarketingConsent(PROFILE_ID, TENANT, CORR)).toBe(
      "denied",
    );
  });

  it("returns unknown when the field is absent", async () => {
    stubFetch(() => ok({ id: PROFILE_ID }));
    expect(await fetchMarketingConsent(PROFILE_ID, TENANT, CORR)).toBe(
      "unknown",
    );
  });

  it("returns unknown on 404", async () => {
    stubFetch(() => ({ ok: false, status: 404, json: async () => ({}) }));
    expect(await fetchMarketingConsent(PROFILE_ID, TENANT, CORR)).toBe(
      "unknown",
    );
  });

  it("returns unknown on a server error", async () => {
    stubFetch(() => ({ ok: false, status: 503, json: async () => ({}) }));
    expect(await fetchMarketingConsent(PROFILE_ID, TENANT, CORR)).toBe(
      "unknown",
    );
  });

  it("returns unknown when the call throws", async () => {
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    expect(await fetchMarketingConsent(PROFILE_ID, TENANT, CORR)).toBe(
      "unknown",
    );
  });

  it("returns unknown and aborts when the call exceeds the timeout", async () => {
    process.env.CRM_CONSENT_TIMEOUT_MS = "5";
    let aborted = false;
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as { signal?: AbortSignal }).signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
          );
        }),
    );
    expect(await fetchMarketingConsent(PROFILE_ID, TENANT, CORR)).toBe(
      "unknown",
    );
    expect(aborted).toBe(true);
  });

  it("returns unknown without calling CRM when INTERNAL_SERVICE_SECRET is missing", async () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const spy = stubFetch(() => ok({ marketingConsent: true }));
    expect(await fetchMarketingConsent(PROFILE_ID, TENANT, CORR)).toBe(
      "unknown",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns unknown without calling CRM for a non-uuid profile id", async () => {
    const spy = stubFetch(() => ok({ marketingConsent: true }));
    expect(await fetchMarketingConsent("not-a-uuid", TENANT, CORR)).toBe(
      "unknown",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("falls back to a sane timeout when the override is not a positive number", async () => {
    process.env.CRM_CONSENT_TIMEOUT_MS = "nonsense";
    stubFetch(() => ok({ marketingConsent: true }));
    expect(await fetchMarketingConsent(PROFILE_ID, TENANT, CORR)).toBe(
      "granted",
    );
  });
});
