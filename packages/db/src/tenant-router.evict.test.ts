import { describe, it, expect, vi, afterEach } from "vitest";
import { TenantRouter, type TenantResolver } from "./tenant-router.js";

// V4-C-06: LRU eviction must not end() a client that a caller was just handed.
const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const T3 = "33333333-3333-3333-3333-333333333333";

function fakeFactory() {
  const created: Array<{ dsn: string; ended: boolean }> = [];
  const factory = (dsn: string) => {
    const c = { dsn, ended: false, end: async () => { c.ended = true; } };
    created.push(c);
    return c as never;
  };
  return { factory: factory as never, created };
}

afterEach(() => { vi.useRealTimers(); });

describe("TenantRouter eviction vs in-flight holders (V4-C-06)", () => {
  it("does not end an evicted client immediately; ends it after the grace window", async () => {
    vi.useFakeTimers();
    const { factory, created } = fakeFactory();
    let n = 0;
    const resolver: TenantResolver = () => ({ tier: "silo", connectionString: `postgres://silo/${n++}` });
    const r = new TenantRouter({ poolDsn: "postgres://shared", resolver, clientFactory: factory, maxSiloClients: 2 });
    await r.sqlFor(T1);
    await r.sqlFor(T2);
    await r.sqlFor(T3); // evicts dsn 0 from the cache
    // A caller that obtained dsn 0 a moment ago must still be able to use it.
    expect(created[0]?.ended).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(created[0]?.ended).toBe(true);
    expect(created[1]?.ended).toBe(false);
    await r.end();
  });

  it("end() also closes clients still waiting out their grace window", async () => {
    vi.useFakeTimers();
    const { factory, created } = fakeFactory();
    let n = 0;
    const resolver: TenantResolver = () => ({ tier: "silo", connectionString: `postgres://silo/${n++}` });
    const r = new TenantRouter({ poolDsn: "postgres://shared", resolver, clientFactory: factory, maxSiloClients: 1 });
    await r.sqlFor(T1);
    await r.sqlFor(T2); // evicts dsn 0 (pending)
    await r.end();
    expect(created.every((c) => c.ended)).toBe(true);
  });
});
