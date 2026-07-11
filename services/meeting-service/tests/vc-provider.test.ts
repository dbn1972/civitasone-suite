/**
 * VC-integration module — provider/fallback-chain resolution unit tests (task 14.2).
 *
 * Pure, DB-free tests of `provider.ts` (tenant VC configuration → priority-ordered fallback chain,
 * Req 13.5) and the env-driven chain construction. Also exercises the real breaker-wrapped adapter
 * stub paths (adapter.ts) end-to-end through the chain (createSession → getJoinLink → recording →
 * endSession → getParticipants) with no network (stub mode: no API key configured).
 */
import { afterEach, describe, expect, it } from "vitest";
import { resolveVcChain, anyProviderAvailable, __setVcChainFactory } from "../src/modules/vc-integration/provider.js";
import { DEFAULT_PROVIDER_PRIORITY } from "../src/modules/vc-integration/adapter.js";

const TENANT = "aaaaaaaa-0000-4000-8000-0000000000d3";

/** Snapshot + restore the VC_* env so tests do not leak configuration into each other. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>): void | Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  const restore = () => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  try {
    const r = fn();
    if (r instanceof Promise) return r.finally(restore);
    restore();
  } catch (err) {
    restore();
    throw err;
  }
}

afterEach(() => {
  __setVcChainFactory(null);
});

describe("resolveVcChain — env-configured chain (Req 13.5)", () => {
  it("defaults to the full provider priority when VC_PROVIDERS is unset", () => {
    return withEnv({ VC_PROVIDERS: undefined }, () => {
      const chain = resolveVcChain(TENANT);
      expect(chain.providers).toEqual([...DEFAULT_PROVIDER_PRIORITY]);
      expect(anyProviderAvailable(chain)).toBe(true); // fresh breakers are closed
      expect(chain.isProviderAvailable("nic_vc")).toBe(true);
      expect(chain.adapterFor("nic_vc")).not.toBeNull();
      expect(chain.adapterFor("webrtc")).not.toBeNull();
    });
  });

  it("honours VC_PROVIDERS (comma list, invalid entries filtered)", () => {
    return withEnv({ VC_PROVIDERS: "zoom, webrtc, skype" }, () => {
      const chain = resolveVcChain(TENANT);
      expect(chain.providers).toEqual(["zoom", "webrtc"]);
      expect(chain.adapterFor("nic_vc")).toBeNull(); // not configured
    });
  });

  it("falls back to the default set when VC_PROVIDERS has no valid entries", () => {
    return withEnv({ VC_PROVIDERS: "skype,webex" }, () => {
      const chain = resolveVcChain(TENANT);
      expect(chain.providers).toEqual([...DEFAULT_PROVIDER_PRIORITY]);
    });
  });

  it("moves a preferred provider to the front of the priority order", () => {
    return withEnv({ VC_PROVIDERS: "nic_vc,ms_teams,webrtc" }, () => {
      const chain = resolveVcChain(TENANT, "webrtc");
      expect(chain.providers[0]).toBe("webrtc");
      expect(new Set(chain.providers)).toEqual(new Set(["nic_vc", "ms_teams", "webrtc"]));
    });
  });

  it("ignores a preferred provider that is not configured", () => {
    return withEnv({ VC_PROVIDERS: "nic_vc,webrtc" }, () => {
      const chain = resolveVcChain(TENANT, "zoom");
      expect(chain.providers).toEqual(["nic_vc", "webrtc"]);
    });
  });

  it("reads per-provider env config (base URL / timeout) without a network call", () => {
    return withEnv(
      { VC_PROVIDERS: "webrtc", VC_WEBRTC_BASE_URL: "", VC_TIMEOUT_MS: "5000" },
      async () => {
        const chain = resolveVcChain(TENANT);
        // Stub mode (no API key) → createSession returns a realistic shape with no network.
        const result = await chain.createSession({
          meetingId: "m-1",
          title: "Board",
          scheduledAt: new Date(),
          durationMinutes: 60,
          hostEmail: "chair@example.gov",
          participants: [],
        });
        expect(result.provider).toBe("webrtc");
        expect(result.switchedFrom).toBeNull();
        expect(result.session.joinUrl).toContain("/room/");
        expect(result.session.externalId).toContain("webrtc-");
      },
    );
  });
});

describe("chain adapter operations (stub mode, Req 13.7)", () => {
  it("drives an adapter through its full lifecycle with no network", () => {
    return withEnv({ VC_PROVIDERS: "nic_vc" }, async () => {
      const chain = resolveVcChain(TENANT);
      const adapter = chain.adapterFor("nic_vc");
      expect(adapter).not.toBeNull();
      const session = await adapter!.createSession({
        meetingId: "m-2",
        title: "AGM",
        scheduledAt: new Date(),
        durationMinutes: 90,
        hostEmail: "chair@example.gov",
        participants: ["a@x", "b@x"],
      });
      expect(session.joinUrl).toContain("vc.nic.in");
      await expect(adapter!.getJoinLink(session.externalId)).resolves.toContain("vc.nic.in");
      await expect(adapter!.getParticipants(session.externalId)).resolves.toEqual([]);
      await expect(adapter!.startRecording(session.externalId)).resolves.toBeUndefined();
      const recording = await adapter!.stopRecording(session.externalId);
      expect(recording.storageKey).toContain("vc-recordings/nic_vc/");
      await expect(adapter!.endSession(session.externalId)).resolves.toBeUndefined();
    });
  });
});

describe("__setVcChainFactory override", () => {
  it("routes resolveVcChain through the injected factory when set", () => {
    const fake = {
      providers: ["webrtc"] as const,
      isProviderAvailable: () => false,
      adapterFor: () => null,
      createSession: async () => {
        throw new Error("unused");
      },
    };
    __setVcChainFactory(() => fake as never);
    const chain = resolveVcChain(TENANT);
    expect(anyProviderAvailable(chain)).toBe(false);
    __setVcChainFactory(null);
    // After reset, the env chain is used again (providers available).
    expect(anyProviderAvailable(resolveVcChain(TENANT))).toBe(true);
  });
});
