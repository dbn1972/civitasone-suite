/**
 * V4-F-06 regression: when the upstream answers 5xx, proxyFetch throws away the
 * Response. Its body must be cancelled first so the undici socket is released
 * immediately instead of being pinned until GC during an error storm.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { proxyFetch } from "../src/upstream-proxy.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function responseWithSpyBody(status: number): { res: Response; cancelled: () => boolean } {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { res: new Response(body, { status }), cancelled: () => cancelled };
}

describe("V4-F-06 — proxyFetch releases the body of a discarded 5xx response", () => {
  it("cancels the upstream body before reporting the 5xx", async () => {
    const { res, cancelled } = responseWithSpyBody(502);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    const out = await proxyFetch({
      method: "GET",
      headers: {},
      serviceName: `svc-${globalThis.crypto.randomUUID()}`,
      url: "http://upstream.invalid/x",
    });

    expect(out).toMatchObject({ ok: false, status: 502, code: "UPSTREAM_ERROR" });
    expect(cancelled()).toBe(true);
  });

  it("leaves a 4xx body untouched for the caller to stream", async () => {
    const { res, cancelled } = responseWithSpyBody(404);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    const out = await proxyFetch({
      method: "GET",
      headers: {},
      serviceName: `svc-${globalThis.crypto.randomUUID()}`,
      url: "http://upstream.invalid/x",
    });

    expect(out.ok).toBe(true);
    expect(cancelled()).toBe(false);
  });
});
