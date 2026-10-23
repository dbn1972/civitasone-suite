/**
 * CLOS2-S6-10 — every outbound carrier HTTP call must carry an AbortSignal so a stalled
 * connection cannot hang click-to-call / hangup forever. (The `timeout` request field is the RING timeout.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Adapter = typeof import("../src/shared/carrier-adapter.js");

/** fetch that never answers on its own but honours the AbortSignal, like the real one. */
function stalledFetch() {
  return vi.fn((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const sig = init?.signal;
      if (!sig) return; // no signal -> hangs forever (the defect)
      const fail = () => reject(sig.reason ?? new DOMException("aborted", "AbortError"));
      if (sig.aborted) fail();
      else sig.addEventListener("abort", fail, { once: true });
    }),
  );
}

async function load(carrier: "twilio" | "exotel"): Promise<Adapter> {
  vi.resetModules();
  vi.stubEnv("TELEPHONY_CARRIER", carrier);
  vi.stubEnv("CARRIER_HTTP_TIMEOUT_MS", "50");
  if (carrier === "twilio") {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "unit-test-token");
  } else {
    vi.stubEnv("EXOTEL_SID", "exotest");
    vi.stubEnv("EXOTEL_API_KEY", "unit-test-key");
  }
  return import("../src/shared/carrier-adapter.js");
}

describe("carrier adapter HTTP timeout", () => {
  let fetchMock: ReturnType<typeof stalledFetch>;
  beforeEach(() => {
    fetchMock = stalledFetch();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("twilio dial rejects within the timeout and passes a signal", async () => {
    const a = await load("twilio");
    const t0 = Date.now();
    await expect(a.dial({ from: "+911", to: "+912" })).rejects.toBeDefined();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("exotel dial rejects within the timeout and passes a signal", async () => {
    const a = await load("exotel");
    const t0 = Date.now();
    await expect(a.dial({ from: "911", to: "912" })).rejects.toBeDefined();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("twilio hangup rejects within the timeout and passes a signal", async () => {
    const a = await load("twilio");
    const t0 = Date.now();
    await expect(a.hangup({ carrierCallId: "CA1" })).rejects.toBeDefined();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});
