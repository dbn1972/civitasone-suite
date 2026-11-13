/**
 * works-service: cross-module event consumers are behind the shared module-licence guard (module-sale gap M5).
 * Default off = delivered exactly as before; watch-only = delivered + would-deny logged; enforce + module not bought =
 * dropped (acked, no retry/DLQ loop); enforce + module bought = delivered. Tenant decisions never mix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { guardSubscriptions, LICENCE_MODULE } from "@civitasone/module-licence";
import { licence, CROSS_MODULE_CONSUMERS } from "../src/shared/licence.js";

const ENF_NO = "e1111111-1111-4111-8111-111111111111"; // enforce, module NOT bought
const ENF_YES = "e2222222-2222-4222-8222-222222222222"; // enforce, module bought
const OFF = "0f333333-3333-4333-8333-333333333333"; //     off (the default), module not bought
const SHADOW = "5a444444-4444-4444-8444-444444444444"; //  watch-only, module not bought

type Proj = { configured: boolean; mode: string; data: Array<{ name: string }> };

/** Stub fetch: admin composition projection per tenant, everything else goes to `target` and is recorded. */
function stubFetch(projections: Record<string, Proj>, target: (url: string) => unknown = () => ({ ok: true, status: 200, json: async () => ({}) })) {
  const targetCalls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/composition/internal/")) {
        const tid = /([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(String(url))?.[1] ?? "";
        const p = projections[tid];
        if (!p) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => p };
      }
      targetCalls.push(String(url));
      return target(String(url));
    }),
  );
  return targetCalls;
}
const proj = (mode: string, modules: string[]): Proj => ({ configured: true, mode, data: modules.map((name) => ({ name })) });

class FakeQueue {
  handlers = new Map<string, (m: unknown) => Promise<void>>();
  subscribe(topic: string, h: (m: unknown) => Promise<void>): void { this.handlers.set(topic, h); }
}

const topics = Object.keys(CROSS_MODULE_CONSUMERS);
const modules = [...new Set(Object.values(CROSS_MODULE_CONSUMERS))];

beforeEach(() => {
  vi.stubEnv("MODULE_LICENCE_CHECK", "on");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  licence._reset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function wired() {
  const q = new FakeQueue();
  const g = guardSubscriptions(q, licence, CROSS_MODULE_CONSUMERS);
  const calls: Array<{ topic: string; tenantId: string }> = [];
  for (const t of topics) g.subscribe(t, async (m) => void calls.push({ topic: t, tenantId: (m as { tenantId: string }).tenantId }));
  const deliver = (topic: string, tenantId: string) => q.handlers.get(topic)!({ tenantId, messageId: `m-${topic}` });
  return { calls, deliver };
}

describe("table", () => {
  it("lists the known cross-module topics for this service", () => {
    for (const t of ["finance.bill.rejected"]) expect(topics, t).toContain(t);
  });
  it("only uses licence keys the catalogue accessor knows", () => {
    const known = new Set<string>(Object.values(LICENCE_MODULE));
    for (const m of modules) expect(known.has(m), m).toBe(true);
  });
});

describe("consumers", () => {
  it("env switch unset: every topic is delivered untouched, with no admin call", async () => {
    vi.stubEnv("MODULE_LICENCE_CHECK", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { calls, deliver } = wired();
    for (const t of topics) await deliver(t, ENF_NO);
    expect(calls).toHaveLength(topics.length);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tenant off (default): delivered, nothing logged", async () => {
    stubFetch({ [OFF]: proj("off", []) });
    const { calls, deliver } = wired();
    for (const t of topics) await deliver(t, OFF);
    expect(calls).toHaveLength(topics.length);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("watch-only: delivered (never blocks) and the would-deny is logged", async () => {
    stubFetch({ [SHADOW]: proj("shadow", []) });
    const { calls, deliver } = wired();
    for (const t of topics) await deliver(t, SHADOW);
    expect(calls).toHaveLength(topics.length);
    expect(vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes("module_licence_would_deny")).length).toBe(topics.length);
  });

  it("enforce + module not bought: dropped without throwing (acked, so no retry/DLQ), logged", async () => {
    stubFetch({ [ENF_NO]: proj("enforce", ["workflow"]) });
    const { calls, deliver } = wired();
    for (const t of topics) await expect(deliver(t, ENF_NO)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes("module_licence_event_dropped")).length).toBe(topics.length);
  });

  it("enforce + module bought: delivered", async () => {
    stubFetch({ [ENF_YES]: proj("enforce", modules) });
    const { calls, deliver } = wired();
    for (const t of topics) await deliver(t, ENF_YES);
    expect(calls).toHaveLength(topics.length);
  });

  it("tenants never mix: interleaved enforce-no / enforce-yes / off decide independently", async () => {
    stubFetch({ [ENF_NO]: proj("enforce", []), [ENF_YES]: proj("enforce", modules), [OFF]: proj("off", []) });
    const { calls, deliver } = wired();
    const t = topics[0]!;
    await deliver(t, ENF_NO); await deliver(t, ENF_YES); await deliver(t, OFF); await deliver(t, ENF_NO);
    expect(calls.map((c) => c.tenantId)).toEqual([ENF_YES, OFF]);
  });

  it("enforce + admin outage after the tenant was seen: throws (so the queue redelivers), never silently dropped or delivered", async () => {
    stubFetch({ [ENF_YES]: proj("enforce", modules) });
    const w = wired();
    await w.deliver(topics[0]!, ENF_YES); // seeds the cache and the sticky enforce mode
    expect(w.calls).toHaveLength(1);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    vi.useFakeTimers({ toFake: ["Date"] }); // past the 30 s cache TTL
    vi.setSystemTime(Date.now() + 60_000);
    try {
      await expect(w.deliver(topics[0]!, ENF_YES)).rejects.toThrow(/will retry/);
    } finally {
      vi.useRealTimers();
    }
    expect(w.calls).toHaveLength(1);
  });
});
