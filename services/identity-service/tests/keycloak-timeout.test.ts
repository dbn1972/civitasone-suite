/**
 * Every Keycloak call must be bounded (CLOS3-S5-12). A server that accepts and never answers would
 * otherwise hang provisionUser/deactivateUser forever and stall the reconciler tick.
 * AbortSignal.timeout runs on Node's native timers (not vitest fake timers), so a short
 * KEYCLOAK_TIMEOUT_MS with real timers is used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@civitasone/observability", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  captureError: vi.fn(),
}));

import { deactivateUser, provisionUser } from "../src/shared/keycloak.js";

const ENV_KEYS = ["KEYCLOAK_URL", "KEYCLOAK_ADMIN_USER", "KEYCLOAK_ADMIN_PASSWORD", "KEYCLOAK_TIMEOUT_MS"] as const;

describe("keycloak fetch timeout", () => {
  const saved: Record<string, string | undefined> = {};
  const seen: Array<RequestInit | undefined> = [];

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.KEYCLOAK_URL = "http://kc.invalid";
    process.env.KEYCLOAK_ADMIN_USER = globalThis.crypto.randomUUID();
    process.env.KEYCLOAK_ADMIN_PASSWORD = globalThis.crypto.randomUUID();
    process.env.KEYCLOAK_TIMEOUT_MS = "50";
    seen.length = 0;
    // Hangs until aborted; with no signal it never settles.
    vi.stubGlobal("fetch", (_u: unknown, init?: RequestInit) => {
      seen.push(init);
      return new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
      });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("provisionUser settles with ok:false when Keycloak never answers", async () => {
    const r = await provisionUser({ id: "u1", tenantId: "t1", email: "a@example.com", name: "A" });
    expect(r.ok).toBe(false);
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  }, 5000);

  it("deactivateUser settles with ok:false when Keycloak never answers", async () => {
    const r = await deactivateUser("t1", "a@example.com");
    expect(r.ok).toBe(false);
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  }, 5000);

  it("falls back to the 10s default for an invalid KEYCLOAK_TIMEOUT_MS", async () => {
    process.env.KEYCLOAK_TIMEOUT_MS = "not-a-number";
    const p = deactivateUser("t1", "a@example.com");
    await new Promise((r) => setTimeout(r, 20));
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0]?.signal?.aborted).toBe(false);
    // Leave the pending promise; the test process tears it down. Avoid unhandled rejection.
    p.catch(() => undefined);
  });
});
