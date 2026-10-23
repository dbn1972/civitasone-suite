/**
 * CLOS2-S6-07 — a malformed / wrong-shape cached quota must be treated as a cache miss
 * (refetch + overwrite), never a 500 from the onRequest hook, and the limit must still be enforced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quotaCheckPlugin, type QuotaCheckStore } from "./quota-check.js";

type Hook = (req: unknown, reply: unknown) => Promise<unknown>;

async function buildHook(store: QuotaCheckStore): Promise<Hook> {
  let hook: Hook | undefined;
  const fastify = { addHook: (_name: string, fn: Hook) => { hook = fn; } };
  await (quotaCheckPlugin as unknown as (f: unknown, o: unknown) => Promise<void>)(fastify, {
    store,
    tenantServiceUrl: "http://tenant-service.invalid",
  });
  return hook!;
}

function makeReply() {
  const reply = { code: 0, body: undefined as unknown, status(c: number) { this.code = c; return this; }, send(b: unknown) { this.body = b; return this; } };
  return reply;
}

const req = { url: "/v1/things", ctx: { tenantId: "t-1" }, log: { warn: vi.fn() } };

describe("quota-check: corrupt cached quota", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ tenantId: "t-1", maxApiCallsPerMin: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  for (const bad of ["{bad", "{}", "null"]) {
    it(`treats cached ${JSON.stringify(bad)} as a miss: one fetch, no throw, overwritten, limit enforced`, async () => {
      const set = vi.fn(async (_k: string, _v: string, _t: number) => undefined);
      let n = 0;
      const store: QuotaCheckStore = { get: async () => bad, set, incr: async () => ++n };
      const hook = await buildHook(store);

      const r1 = makeReply();
      await expect(hook(req, r1)).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledTimes(1);
      expect(JSON.parse(set.mock.calls[0]![1]).maxApiCallsPerMin).toBe(2);

      await hook(req, makeReply()); // 2nd call: still within limit of 2
      const r3 = makeReply();
      await hook(req, r3); // 3rd call: over the refetched limit
      expect(r3.code).toBe(429);
    });
  }

  it("uses a well-formed cached quota without fetching", async () => {
    const store: QuotaCheckStore = {
      get: async () => JSON.stringify({ tenantId: "t-1", maxApiCallsPerMin: 5 }),
      set: vi.fn(async () => undefined),
      incr: async () => 1,
    };
    await (await buildHook(store))(req, makeReply());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
