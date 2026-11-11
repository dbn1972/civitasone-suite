import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createModuleLicence,
  guardSubscriptions,
  compositionProjectionSource,
  ModuleNotLicensedError,
  type ModuleSnapshot,
  type ModuleSource,
  type LicenceLogger,
} from "../src/index.js";
import { getModuleLicenceDecisionCount, resetModuleLicenceMetrics } from "@civitasone/observability";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const snap = (modules: string[], mode: ModuleSnapshot["mode"], configured = true): ModuleSnapshot => ({
  modules: configured ? new Set(modules) : null,
  configured,
  mode,
});

function fakeSource(byTenant: Record<string, ModuleSnapshot | Error>): ModuleSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async load(t: string) {
      calls.push(t);
      const v = byTenant[t];
      if (!v) throw new Error("unknown tenant");
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

function fixture(src: ModuleSource, over: { enabled?: boolean; now?: () => number } = {}) {
  const warns: Array<Record<string, unknown>> = [];
  const log: LicenceLogger = { warn: (o) => void warns.push(o) };
  const licence = createModuleLicence({
    service: "finance",
    source: src,
    enabled: () => over.enabled ?? true,
    log,
    ...(over.now ? { now: over.now } : {}),
  });
  return { licence, warns };
}

beforeEach(() => resetModuleLicenceMetrics());

describe("default off (parity)", () => {
  it("MODULE_LICENCE_CHECK unset: no fetch, no log, everything allowed", async () => {
    const src = fakeSource({ [A]: snap([], "enforce") });
    const { licence, warns } = fixture(src, { enabled: false });
    const handler = vi.fn(async () => {});
    await licence.guardConsumer({ topic: "payroll.run.approved", module: "finance" }, handler)({ tenantId: A, messageId: "m1" });
    await licence.assertLicensed(A, "finance", "x");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(src.calls).toEqual([]);
    expect(warns).toEqual([]);
  });

  it("default enabled() reads MODULE_LICENCE_CHECK", async () => {
    const src = fakeSource({ [A]: snap([], "enforce") });
    const licence = createModuleLicence({ service: "finance", source: src });
    vi.stubEnv("MODULE_LICENCE_CHECK", "");
    expect((await licence.check(A, "finance", "http", "t")).allowed).toBe(true);
    expect(src.calls).toEqual([]);
    vi.stubEnv("MODULE_LICENCE_CHECK", "on");
    expect((await licence.check(A, "finance", "http", "t")).outcome).toBe("deny");
    vi.unstubAllEnvs();
  });

  it("tenant mode off: an unlicensed module is allowed silently (no log)", async () => {
    const { licence, warns } = fixture(fakeSource({ [A]: snap(["payroll"], "off") }));
    const d = await licence.check(A, "finance", "event", "payroll.run.approved");
    expect(d).toMatchObject({ allowed: true, outcome: "allow", mode: "off" });
    expect(warns).toEqual([]);
  });

  it("tenant mode off + source outage with no history: allowed (cold start, same as the gateway)", async () => {
    const { licence } = fixture(fakeSource({ [A]: new Error("down") }));
    expect((await licence.check(A, "finance", "http", "t")).allowed).toBe(true);
  });
});

describe("watch-only (shadow)", () => {
  it("logs + counts would-deny but never blocks, for HTTP and events", async () => {
    const { licence, warns } = fixture(fakeSource({ [A]: snap(["payroll"], "shadow") }));
    const handler = vi.fn(async () => {});
    await licence.guardConsumer({ topic: "payroll.run.approved", module: "finance" }, handler)({ tenantId: A, messageId: "m1" });
    await expect(licence.assertLicensed(A, "finance", "GET /sanctions")).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(warns.filter((w) => w.event === "module_licence_would_deny")).toHaveLength(2);
    expect(getModuleLicenceDecisionCount("finance", "finance", "event", "would_deny")).toBe(1);
    expect(getModuleLicenceDecisionCount("finance", "finance", "http", "would_deny")).toBe(1);
  });

  it("an unconfigured tenant in shadow is allowed with a would-deny", async () => {
    const { licence } = fixture(fakeSource({ [A]: snap([], "shadow", false) }));
    expect(await licence.check(A, "finance", "http", "t")).toMatchObject({ allowed: true, outcome: "would_deny", reason: "tenant_not_configured" });
  });

  it("a licensed module in shadow is a plain allow", async () => {
    const { licence, warns } = fixture(fakeSource({ [A]: snap(["finance"], "shadow") }));
    expect((await licence.check(A, "finance", "http", "t")).outcome).toBe("allow");
    expect(warns).toEqual([]);
  });

  it("source outage after a shadow tenant was seen: allowed, counted as would-deny", async () => {
    let t = 0;
    const src = fakeSource({ [A]: snap(["finance"], "shadow") });
    const { licence } = fixture(src, { now: () => t });
    await licence.check(A, "finance", "http", "t");
    t += 60_000;
    src.load = async () => { throw new Error("down"); };
    expect(await licence.check(A, "finance", "http", "t")).toMatchObject({ allowed: true, outcome: "would_deny" });
  });
});

describe("enforce", () => {
  it("HTTP: unlicensed module throws ModuleNotLicensedError (not retryable)", async () => {
    const { licence } = fixture(fakeSource({ [A]: snap(["payroll"], "enforce") }));
    const err = await licence.assertLicensed(A, "finance", "GET /sanctions").catch((e) => e);
    expect(err).toBeInstanceOf(ModuleNotLicensedError);
    expect(err.code).toBe("MODULE_NOT_LICENSED");
    expect(err.retryable).toBe(false);
  });

  it("HTTP: licensed module passes", async () => {
    const { licence } = fixture(fakeSource({ [A]: snap(["finance"], "enforce") }));
    await expect(licence.assertLicensed(A, "finance", "t")).resolves.toBeUndefined();
  });

  it("events: unlicensed consumer module is DROPPED (handler not run, no throw, so no retry/DLQ) with a log entry and onDrop", async () => {
    const { licence, warns } = fixture(fakeSource({ [A]: snap(["payroll"], "enforce") }));
    const handler = vi.fn(async () => {});
    const onDrop = vi.fn();
    await expect(
      licence.guardConsumer({ topic: "payroll.run.approved", module: "finance" }, handler, onDrop)({ tenantId: A, messageId: "m1" }),
    ).resolves.toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(warns.find((w) => w.event === "module_licence_event_dropped")).toMatchObject({ topic: "payroll.run.approved", module: "finance", messageId: "m1", tenantId: A });
    expect(getModuleLicenceDecisionCount("finance", "finance", "event", "deny")).toBe(1);
  });

  it("events: a throwing onDrop hook never fails the ack", async () => {
    const { licence } = fixture(fakeSource({ [A]: snap([], "enforce") }));
    await expect(
      licence.guardConsumer({ topic: "t", module: "finance" }, async () => {}, () => { throw new Error("audit down"); })({ tenantId: A }),
    ).resolves.toBeUndefined();
  });

  it("events: licensed module runs the handler", async () => {
    const { licence } = fixture(fakeSource({ [A]: snap(["finance"], "enforce") }));
    const handler = vi.fn(async () => {});
    await licence.guardConsumer({ topic: "t", module: "finance" }, handler)({ tenantId: A });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fail closed: unconfigured tenant is refused", async () => {
    const { licence } = fixture(fakeSource({ [A]: snap([], "enforce", false) }));
    expect(await licence.check(A, "finance", "http", "t")).toMatchObject({ allowed: false, outcome: "deny", reason: "tenant_not_configured" });
  });

  it("fail closed: missing or malformed tenant is refused without any fetch", async () => {
    const src = fakeSource({});
    const { licence } = fixture(src);
    expect((await licence.check(undefined, "finance", "http", "t")).allowed).toBe(false);
    expect((await licence.check("../../etc", "finance", "http", "t")).allowed).toBe(false);
    expect(src.calls).toEqual([]);
  });

  it("fail closed: outage for a tenant seen as enforce is 'unavailable' (retryable), and events THROW so they are redelivered, not dropped", async () => {
    let t = 0;
    const src = fakeSource({ [A]: snap(["finance"], "enforce") });
    const { licence } = fixture(src, { now: () => t });
    await licence.check(A, "finance", "http", "t");
    t += 60_000;
    src.load = async () => { throw new Error("down"); };
    const d = await licence.check(A, "finance", "http", "t");
    expect(d).toMatchObject({ allowed: false, outcome: "unavailable" });
    const err = await licence.assertLicensed(A, "finance", "t").catch((e) => e);
    expect(err.retryable).toBe(true);
    const handler = vi.fn(async () => {});
    await expect(licence.guardConsumer({ topic: "t", module: "finance" }, handler)({ tenantId: A })).rejects.toThrow(/will retry/);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("cache", () => {
  it("one source call per tenant inside the TTL; refetch after it", async () => {
    let t = 1000;
    const src = fakeSource({ [A]: snap(["finance"], "enforce") });
    const { licence } = fixture(src, { now: () => t });
    await licence.check(A, "finance", "http", "t");
    await licence.check(A, "finance", "http", "t");
    await licence.check(A, "payroll", "http", "t");
    expect(src.calls).toEqual([A]);
    t += 30_001;
    await licence.check(A, "finance", "http", "t");
    expect(src.calls).toEqual([A, A]);
  });

  it("concurrent callers share a single in-flight load", async () => {
    const src = fakeSource({ [A]: snap(["finance"], "enforce") });
    const { licence } = fixture(src);
    await Promise.all([1, 2, 3, 4, 5].map(() => licence.check(A, "finance", "event", "t")));
    expect(src.calls).toEqual([A]);
  });

  it("a licence revoked at the source is honoured after the TTL (staleness bound)", async () => {
    let t = 0;
    const state: { s: ModuleSnapshot } = { s: snap(["finance"], "enforce") };
    const src: ModuleSource = { load: async () => state.s };
    const { licence } = fixture(src, { now: () => t });
    expect((await licence.check(A, "finance", "http", "t")).allowed).toBe(true);
    state.s = snap([], "enforce");
    expect((await licence.check(A, "finance", "http", "t")).allowed).toBe(true);
    t += 30_001;
    expect((await licence.check(A, "finance", "http", "t")).allowed).toBe(false);
  });

  it("failures are not cached: the next call after recovery re-fetches", async () => {
    let up = false;
    const src: ModuleSource = { load: async () => { if (!up) throw new Error("down"); return snap(["finance"], "enforce"); } };
    const { licence } = fixture(src);
    await licence.check(A, "finance", "http", "t");
    up = true;
    expect((await licence.check(A, "finance", "http", "t")).outcome).toBe("allow");
  });
});

describe("tenant isolation", () => {
  it("interleaved tenants never share a decision, cache entry or sticky mode", async () => {
    const src = fakeSource({ [A]: snap(["finance"], "enforce"), [B]: snap(["payroll"], "enforce") });
    const { licence } = fixture(src);
    for (let i = 0; i < 3; i++) {
      expect((await licence.check(A, "finance", "http", "t")).allowed).toBe(true);
      expect((await licence.check(B, "finance", "http", "t")).allowed).toBe(false);
      expect((await licence.check(B, "payroll", "http", "t")).allowed).toBe(true);
      expect((await licence.check(A, "payroll", "http", "t")).allowed).toBe(false);
    }
    expect(src.calls.sort()).toEqual([A, B]);
  });

  it("an enforce tenant's outage does not turn a different (off) tenant fail-closed", async () => {
    let t = 0;
    const src = fakeSource({ [A]: snap(["finance"], "enforce"), [B]: snap([], "off") });
    const { licence } = fixture(src, { now: () => t });
    await licence.check(A, "finance", "http", "t");
    await licence.check(B, "finance", "http", "t");
    t += 60_000;
    src.load = async () => { throw new Error("down"); };
    expect((await licence.check(A, "finance", "http", "t")).allowed).toBe(false);
    expect((await licence.check(B, "finance", "http", "t")).allowed).toBe(true);
  });

  it("the decision tenant is the message envelope's, never a payload field", async () => {
    const src = fakeSource({ [A]: snap(["finance"], "enforce"), [B]: snap([], "enforce") });
    const { licence } = fixture(src);
    const handler = vi.fn(async () => {});
    const guarded = licence.guardConsumer<{ tenantId: string; payload: { tenantId: string } }>({ topic: "t", module: "finance" }, handler);
    await guarded({ tenantId: B, payload: { tenantId: A } });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("compositionProjectionSource", () => {
  it("fetches the composition projection for exactly the requested tenant (x-tenant-id header and path)", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, headers: init.headers });
      return { ok: true, status: 200, json: async () => ({ configured: true, mode: "shadow", data: [{ name: "finance" }] }) };
    }) as unknown as typeof fetch;
    const src = compositionProjectionSource({ caller: "finance-licence", fetchImpl });
    const s = await src.load(A);
    expect(s.mode).toBe("shadow");
    expect(s.modules?.has("finance")).toBe(true);
    expect(seen[0]!.url).toContain(`/internal/${A}/modules`);
    expect(seen[0]!.headers["x-tenant-id"]).toBe(A);
    expect(seen[0]!.headers["x-internal"]).toBe("1");
  });

  it("rejects a non-UUID tenant before any request; unknown mode strings fall back to off; non-2xx throws", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const src = compositionProjectionSource({ caller: "x", fetchImpl });
    await expect(src.load("not-a-uuid")).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(src.load(A)).rejects.toThrow(/500/);
    const ok = (async () => ({ ok: true, status: 200, json: async () => ({ configured: true, mode: "bogus", data: [] }) })) as unknown as typeof fetch;
    expect((await compositionProjectionSource({ caller: "x", fetchImpl: ok }).load(A)).mode).toBe("off");
  });
});

describe("guardSubscriptions", () => {
  class FakeQueue {
    handlers = new Map<string, (m: any) => Promise<void>>();
    started = false;
    subscribe(topic: string, handler: (m: any) => Promise<void>): void { this.handlers.set(topic, handler); }
    async start(): Promise<void> { this.started = true; }
  }

  it("guards only the tabled topics; others and other methods pass through untouched", async () => {
    const { licence } = fixture(fakeSource({ [A]: snap(["payroll"], "enforce") }));
    const q = new FakeQueue();
    const g = guardSubscriptions(q, licence, { "payroll.run.approved": "finance" });
    const guarded = vi.fn(async () => {});
    const plain = vi.fn(async () => {});
    g.subscribe("payroll.run.approved", guarded);
    g.subscribe("finance.something.own", plain);
    await q.handlers.get("payroll.run.approved")!({ tenantId: A, messageId: "m" });
    await q.handlers.get("finance.something.own")!({ tenantId: A, messageId: "m" });
    expect(guarded).not.toHaveBeenCalled(); // dropped: finance not licensed
    expect(plain).toHaveBeenCalledTimes(1);
    await g.start();
    expect(q.started).toBe(true);
  });

  it("with the process switch off the wrapped handler behaves exactly like the original", async () => {
    const { licence } = fixture(fakeSource({}), { enabled: false });
    const q = new FakeQueue();
    const g = guardSubscriptions(q, licence, { t: "finance" });
    const h = vi.fn(async () => {});
    g.subscribe("t", h);
    await q.handlers.get("t")!({ tenantId: A });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("a handler error still propagates (so the queue's own retry/DLQ handling is unchanged)", async () => {
    const { licence } = fixture(fakeSource({ [A]: snap(["finance"], "enforce") }));
    const q = new FakeQueue();
    guardSubscriptions(q, licence, { t: "finance" }).subscribe("t", async () => { throw new Error("boom"); });
    await expect(q.handlers.get("t")!({ tenantId: A })).rejects.toThrow("boom");
  });
});
