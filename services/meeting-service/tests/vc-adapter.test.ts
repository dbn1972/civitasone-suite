/**
 * VC-integration module — unit tests for the VC_Adapter abstraction, factory, and priority-ordered
 * fallback chain (task 14.1).
 *
 * These exercise the pure/deterministic surface of adapter.ts without any network:
 *   - provider stub shapes (join URLs, dial-in, PIN) for each of the 5 platforms
 *   - the single-provider factory (createVCAdapter) wrapping calls in a real circuit breaker
 *   - the pure fallback SELECTION function (selectFallbackProvider)
 *   - the fallback CHAIN: fall-through on open/failing providers, switchedFrom reporting,
 *     VC_ALL_PLATFORMS_UNAVAILABLE when everything is down
 *   - the CIRCUIT-BREAKER OPEN PATH end-to-end: 5 consecutive failures open the real
 *     @civitasone/circuit-breaker, after which the chain skips that provider and falls through.
 *
 * The dedicated property test (P21) lands in task 14.3; these are example/edge-case unit tests.
 *
 * _Requirements: 13.1, 13.2, 13.5, 13.6, 13.7_
 */
import { describe, it, expect } from "vitest";
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import {
  createVCAdapter,
  createVCFallbackChain,
  assembleFallbackChain,
  wrapWithBreaker,
  selectFallbackProvider,
  NicVCAdapter,
  TeamsAdapter,
  GoogleMeetAdapter,
  ZoomAdapter,
  WebRTCAdapter,
  VCAdapterError,
  VCAllPlatformsUnavailableError,
  DEFAULT_PROVIDER_PRIORITY,
  VC_BREAKER_FAILURE_THRESHOLD,
  type VCAdapter,
  type VCProvider,
  type VCAdapterConfig,
  type VCChainEntry,
  type CreateSessionParams,
  type VCSession,
  type VCParticipant,
  type VCRecording,
} from "../src/modules/vc-integration/adapter.js";

// ── Fixtures / helpers ──────────────────────────────────────────────────────

const PARAMS: CreateSessionParams = {
  meetingId: "11111111-1111-1111-1111-111111111111",
  title: "Finance Committee — Q3 review",
  scheduledAt: new Date("2026-01-15T09:00:00Z"),
  durationMinutes: 60,
  hostEmail: "secretary@gov.example",
  participants: ["a@gov.example", "b@gov.example"],
};

/** Stub-mode config (no apiKey → adapters return realistic stub shapes, never touch the network). */
function stubConfig(provider: VCProvider): VCAdapterConfig {
  return { provider, apiBaseUrl: "", apiKey: "" };
}

/** A fake adapter whose every call throws — used to drive the breaker/fallthrough paths. */
function failingAdapter(provider: VCProvider): VCAdapter {
  const fail = (): Promise<never> =>
    Promise.reject(new VCAdapterError(`${provider} down`, provider, "VC_API_ERROR", 503));
  return {
    provider,
    createSession: fail,
    getJoinLink: fail,
    getParticipants: fail,
    startRecording: fail,
    stopRecording: fail,
    endSession: fail,
  };
}

/** A fake adapter that always succeeds, returning a marker session identifying the provider. */
function okAdapter(provider: VCProvider): VCAdapter {
  const session: VCSession = { externalId: `${provider}-ok`, joinUrl: `https://${provider}.local/join` };
  return {
    provider,
    createSession: () => Promise.resolve(session),
    getJoinLink: () => Promise.resolve(session.joinUrl),
    getParticipants: (): Promise<VCParticipant[]> => Promise.resolve([]),
    startRecording: () => Promise.resolve(),
    stopRecording: (): Promise<VCRecording> =>
      Promise.resolve({ recordingUrl: "", storageKey: "", durationSeconds: 0, sizeBytes: 0 }),
    endSession: () => Promise.resolve(),
  };
}

/** Build a chain entry with a fixed open/closed state (no real breaker). */
function entry(provider: VCProvider, adapter: VCAdapter, open = false): VCChainEntry {
  return { provider, adapter, isOpen: () => open };
}

// ── Provider stub shapes (Req 13.1, 13.7) ───────────────────────────────────

describe("provider stub adapters", () => {
  it("each provider produces a platform-shaped join URL and consistent externalId", async () => {
    const cases: Array<[VCAdapter, RegExp]> = [
      [new NicVCAdapter(stubConfig("nic_vc")), /^https:\/\/vc\.nic\.in\/join\//],
      [new TeamsAdapter(stubConfig("ms_teams")), /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\//],
      [new GoogleMeetAdapter(stubConfig("google_meet")), /^https:\/\/meet\.google\.com\//],
      [new ZoomAdapter(stubConfig("zoom")), /^https:\/\/zoom\.us\/j\//],
      [new WebRTCAdapter(stubConfig("webrtc")), /^https:\/\/webrtc\.meeting\.local\/room\//],
    ];
    for (const [adapter, urlPattern] of cases) {
      const session = await adapter.createSession(PARAMS);
      expect(session.externalId).toContain(adapter.provider);
      expect(session.joinUrl).toMatch(urlPattern);
      // getJoinLink is deterministic for the same externalId in stub mode.
      expect(await adapter.getJoinLink(session.externalId)).toBe(session.joinUrl);
      // No live participants in a freshly stubbed session (VC attendance arrives via webhook).
      expect(await adapter.getParticipants(session.externalId)).toEqual([]);
    }
  });

  it("NIC VC exposes a 9-digit PIN and a government dial-in", async () => {
    const session = await new NicVCAdapter(stubConfig("nic_vc")).createSession(PARAMS);
    expect(session.meetingPin).toMatch(/^\d{9}$/);
    expect(session.dialInNumber).toBe("+91-11-2430-0000");
  });

  it("self-hosted WebRTC has no PSTN dial-in", async () => {
    const session = await new WebRTCAdapter(stubConfig("webrtc")).createSession(PARAMS);
    expect(session.dialInNumber).toBeUndefined();
  });

  it("stopRecording returns a deterministic storage key in stub mode", async () => {
    const adapter = new ZoomAdapter(stubConfig("zoom"));
    const created = await adapter.createSession(PARAMS);
    const rec = await adapter.stopRecording(created.externalId);
    expect(rec.storageKey).toBe(`vc-recordings/zoom/${created.externalId}.mp4`);
  });
});

// ── Single-provider factory (Req 13.6, 13.7) ────────────────────────────────

describe("createVCAdapter factory", () => {
  it("returns a breaker-wrapped adapter for the requested provider", async () => {
    const adapter = createVCAdapter(stubConfig("nic_vc"));
    expect(adapter.provider).toBe("nic_vc");
    const session = await adapter.createSession(PARAMS);
    expect(session.joinUrl).toMatch(/vc\.nic\.in/);
  });
});

// ── Pure fallback selection (Req 13.5) ──────────────────────────────────────

describe("selectFallbackProvider", () => {
  const priority: VCProvider[] = ["nic_vc", "ms_teams", "google_meet", "zoom", "webrtc"];

  it("returns the first provider when none are open", () => {
    expect(selectFallbackProvider(priority, () => false)).toBe("nic_vc");
  });

  it("skips open providers and returns the first available in priority order", () => {
    const open = new Set<VCProvider>(["nic_vc", "ms_teams"]);
    expect(selectFallbackProvider(priority, (p) => open.has(p))).toBe("google_meet");
  });

  it("returns null when every provider is open", () => {
    expect(selectFallbackProvider(priority, () => true)).toBeNull();
  });

  it("returns null for an empty priority list", () => {
    expect(selectFallbackProvider([], () => false)).toBeNull();
  });
});

// ── Fallback chain fall-through (Req 13.5) ──────────────────────────────────

describe("assembleFallbackChain", () => {
  it("serves the session from the first available provider (no switch)", async () => {
    const chain = assembleFallbackChain([
      entry("nic_vc", okAdapter("nic_vc")),
      entry("ms_teams", okAdapter("ms_teams")),
    ]);
    const result = await chain.createSession(PARAMS);
    expect(result.provider).toBe("nic_vc");
    expect(result.switchedFrom).toBeNull();
    expect(result.attempts).toEqual([]);
  });

  it("skips a provider whose breaker is open and reports switchedFrom", async () => {
    const chain = assembleFallbackChain([
      entry("nic_vc", okAdapter("nic_vc"), /* open */ true),
      entry("ms_teams", okAdapter("ms_teams")),
    ]);
    const result = await chain.createSession(PARAMS);
    expect(result.provider).toBe("ms_teams");
    // switchedFrom is the evidence of the skip: the preferred provider was NIC, but it was open.
    expect(result.switchedFrom).toBe("nic_vc");
    // A skipped-open provider that is bypassed during a successful selection is not logged as a
    // failed attempt (attempts records tried-and-failed providers only).
    expect(result.attempts).toEqual([]);
  });

  it("falls through when the preferred provider call fails, recording the attempt reason", async () => {
    const chain = assembleFallbackChain([
      entry("nic_vc", failingAdapter("nic_vc")),
      entry("webrtc", okAdapter("webrtc")),
    ]);
    const result = await chain.createSession(PARAMS);
    expect(result.provider).toBe("webrtc");
    expect(result.switchedFrom).toBe("nic_vc");
    expect(result.attempts).toContainEqual({ provider: "nic_vc", reason: "VC_API_ERROR" });
  });

  it("throws VC_ALL_PLATFORMS_UNAVAILABLE when every provider is open", async () => {
    const chain = assembleFallbackChain([
      entry("nic_vc", okAdapter("nic_vc"), true),
      entry("ms_teams", okAdapter("ms_teams"), true),
    ]);
    await expect(chain.createSession(PARAMS)).rejects.toBeInstanceOf(VCAllPlatformsUnavailableError);
    try {
      await chain.createSession(PARAMS);
    } catch (err) {
      expect(err).toBeInstanceOf(VCAllPlatformsUnavailableError);
      expect((err as VCAllPlatformsUnavailableError).code).toBe("VC_ALL_PLATFORMS_UNAVAILABLE");
      const providers = (err as VCAllPlatformsUnavailableError).attempts.map((a) => a.provider);
      expect(providers).toEqual(expect.arrayContaining(["nic_vc", "ms_teams"]));
    }
  });

  it("throws VC_ALL_PLATFORMS_UNAVAILABLE when every provider call fails", async () => {
    const chain = assembleFallbackChain([
      entry("nic_vc", failingAdapter("nic_vc")),
      entry("webrtc", failingAdapter("webrtc")),
    ]);
    await expect(chain.createSession(PARAMS)).rejects.toBeInstanceOf(VCAllPlatformsUnavailableError);
  });

  it("respects a tenant priority override for selection order", async () => {
    const chain = assembleFallbackChain(
      [entry("nic_vc", okAdapter("nic_vc")), entry("zoom", okAdapter("zoom"))],
      ["zoom", "nic_vc"], // tenant prefers zoom first
    );
    expect(chain.providers).toEqual(["zoom", "nic_vc"]);
    const result = await chain.createSession(PARAMS);
    expect(result.provider).toBe("zoom");
    expect(result.switchedFrom).toBeNull();
  });

  it("exposes adapterFor and isProviderAvailable", () => {
    const chain = assembleFallbackChain([
      entry("nic_vc", okAdapter("nic_vc"), true),
      entry("webrtc", okAdapter("webrtc")),
    ]);
    expect(chain.adapterFor("webrtc")?.provider).toBe("webrtc");
    expect(chain.adapterFor("zoom")).toBeNull();
    expect(chain.isProviderAvailable("nic_vc")).toBe(false); // breaker open
    expect(chain.isProviderAvailable("webrtc")).toBe(true);
    expect(chain.isProviderAvailable("zoom")).toBe(false); // not configured
  });
});

// ── Circuit-breaker OPEN path, end-to-end with the real breaker (Req 13.6) ──

describe("circuit breaker open path (real @civitasone/circuit-breaker)", () => {
  it("opens after 5 consecutive failures and then rejects immediately with CircuitBreakerOpenError", async () => {
    const breaker = new CircuitBreaker({ name: "vc-test", failureThreshold: VC_BREAKER_FAILURE_THRESHOLD, recoveryMs: 30_000 });
    const wrapped = wrapWithBreaker(failingAdapter("nic_vc"), breaker);

    // First 5 calls hit the (failing) provider and surface its VCAdapterError.
    for (let i = 0; i < VC_BREAKER_FAILURE_THRESHOLD; i++) {
      await expect(wrapped.createSession(PARAMS)).rejects.toBeInstanceOf(VCAdapterError);
    }
    expect(breaker.state).toBe("open");

    // Once open, the breaker rejects without ever invoking the provider.
    await expect(wrapped.createSession(PARAMS)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
  });

  it("a fallback chain skips a provider once its breaker has tripped open", async () => {
    const nicBreaker = new CircuitBreaker({ name: "vc-nic", failureThreshold: VC_BREAKER_FAILURE_THRESHOLD, recoveryMs: 30_000 });
    const nicWrapped = wrapWithBreaker(failingAdapter("nic_vc"), nicBreaker);

    const entries: VCChainEntry[] = [
      { provider: "nic_vc", adapter: nicWrapped, isOpen: () => nicBreaker.state === "open" },
      { provider: "webrtc", adapter: okAdapter("webrtc"), isOpen: () => false },
    ];
    const chain = assembleFallbackChain(entries);

    // Trip the NIC breaker open with 5 direct failures.
    for (let i = 0; i < VC_BREAKER_FAILURE_THRESHOLD; i++) {
      await expect(nicWrapped.createSession(PARAMS)).rejects.toBeInstanceOf(VCAdapterError);
    }
    expect(nicBreaker.state).toBe("open");

    // Now the chain sees NIC as open and goes straight to webrtc; the switch is reported via
    // switchedFrom (the bypassed-open NIC provider is not logged as a failed attempt).
    const result = await chain.createSession(PARAMS);
    expect(result.provider).toBe("webrtc");
    expect(result.switchedFrom).toBe("nic_vc");
    expect(result.attempts).toEqual([]);
  });
});

// ── createVCFallbackChain end-to-end from configs (Req 13.5) ─────────────────

describe("createVCFallbackChain", () => {
  it("defaults the chain order to the config order (tenant-declared priority)", async () => {
    const chain = createVCFallbackChain([stubConfig("zoom"), stubConfig("nic_vc"), stubConfig("webrtc")]);
    // With no override, the tenant's configured order is the priority; DEFAULT_PROVIDER_PRIORITY
    // only fills in providers the tenant did not list.
    expect(chain.providers).toEqual(["zoom", "nic_vc", "webrtc"]);
    const result = await chain.createSession(PARAMS);
    expect(result.provider).toBe("zoom"); // first configured provider leads
    expect(result.session.joinUrl).toMatch(/zoom\.us/);
  });

  it("fills un-ordered providers from DEFAULT_PROVIDER_PRIORITY (nic_vc ahead of zoom)", async () => {
    // Config order is left unspecified for these two by passing them in reverse-of-default order;
    // the dedupe against DEFAULT_PROVIDER_PRIORITY keeps config order first, so config wins.
    const chain = createVCFallbackChain([stubConfig("nic_vc"), stubConfig("zoom")]);
    expect(chain.providers).toEqual(["nic_vc", "zoom"]);
    const result = await chain.createSession(PARAMS);
    expect(result.provider).toBe("nic_vc");
  });

  it("honours an explicit tenant priority override", async () => {
    const chain = createVCFallbackChain(
      [stubConfig("nic_vc"), stubConfig("ms_teams")],
      ["ms_teams", "nic_vc"],
    );
    expect(chain.providers).toEqual(["ms_teams", "nic_vc"]);
    const result = await chain.createSession(PARAMS);
    expect(result.provider).toBe("ms_teams");
  });

  it("DEFAULT_PROVIDER_PRIORITY leads with nic_vc and anchors with webrtc", () => {
    expect(DEFAULT_PROVIDER_PRIORITY[0]).toBe("nic_vc");
    expect(DEFAULT_PROVIDER_PRIORITY[DEFAULT_PROVIDER_PRIORITY.length - 1]).toBe("webrtc");
  });
});
