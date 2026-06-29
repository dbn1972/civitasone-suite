import { describe, it, expect, vi } from "vitest";
import { TenantRouter, envTenantResolver, cachedResolver, type TenantResolver } from "./tenant-router.js";

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const T3 = "33333333-3333-3333-3333-333333333333";

// Minimal fake postgres-js client: identifiable by dsn, with an end() spy.
function fakeFactory() {
  const created: Array<{ dsn: string; ended: boolean }> = [];
  const factory = ((dsn: string) => {
    const c = { dsn, ended: false, end: async () => { c.ended = true; } };
    created.push(c);
    return c as unknown as ReturnType<typeof import("./pool.js").createSqlClient>;
  });
  return { factory: factory as never, created };
}

describe("TenantRouter", () => {
  it("pool tenants share one client; silo tenants get their own", async () => {
    const { factory, created } = fakeFactory();
    const resolver: TenantResolver = (id) =>
      id === T2 ? { tier: "silo", connectionString: "postgres://silo/t2" } : { tier: "pool" };
    const r = new TenantRouter({ poolDsn: "postgres://shared", resolver, clientFactory: factory });

    const a = await r.sqlFor(T1);
    const b = await r.sqlFor(T3); // another pool tenant
    const c = await r.sqlFor(T2); // silo

    expect(a).toBe(b); // pool tenants reuse the shared client
    expect(c).not.toBe(a); // silo is a distinct client
    expect((c as unknown as { dsn: string }).dsn).toBe("postgres://silo/t2");
    expect(created).toHaveLength(2); // one shared + one silo
  });

  it("caches silo clients per DSN and reuses them", async () => {
    const { factory, created } = fakeFactory();
    const resolver: TenantResolver = () => ({ tier: "silo", connectionString: "postgres://silo/x" });
    const r = new TenantRouter({ poolDsn: "postgres://shared", resolver, clientFactory: factory });
    const c1 = await r.sqlFor(T1);
    const c2 = await r.sqlFor(T1);
    expect(c1).toBe(c2);
    expect(created).toHaveLength(1);
  });

  it("LRU-evicts and closes silo clients beyond the cap", async () => {
    const { factory, created } = fakeFactory();
    let n = 0;
    const resolver: TenantResolver = () => ({ tier: "silo", connectionString: `postgres://silo/${n++}` });
    const r = new TenantRouter({ poolDsn: "postgres://shared", resolver, clientFactory: factory, maxSiloClients: 2 });
    await r.sqlFor(T1); // dsn 0
    await r.sqlFor(T2); // dsn 1
    await r.sqlFor(T3); // dsn 2 → evicts dsn 0
    expect(created[0]?.ended).toBe(true);  // oldest closed
    expect(created[1]?.ended).toBe(false);
  });

  it("rejects invalid tenant ids and silo without DSN", async () => {
    const { factory } = fakeFactory();
    const r = new TenantRouter({ poolDsn: "postgres://shared", resolver: () => ({ tier: "silo" }), clientFactory: factory });
    await expect(r.sqlFor("not-a-uuid")).rejects.toThrow();
    await expect(r.sqlFor(T1)).rejects.toThrow(/no connectionString/);
  });

  it("envTenantResolver: silo only for listed ids with a template, else pool", () => {
    const prev = { ids: process.env.TENANT_SILO_IDS, tpl: process.env.TENANT_SILO_DSN_TEMPLATE };
    process.env.TENANT_SILO_IDS = T2;
    process.env.TENANT_SILO_DSN_TEMPLATE = "postgres://h/civitas_tenant_{tenant}";
    const resolve = envTenantResolver();
    expect(resolve(T1)).toEqual({ tier: "pool" });
    expect(resolve(T2)).toEqual({ tier: "silo", connectionString: `postgres://h/civitas_tenant_${T2}` });
    process.env.TENANT_SILO_IDS = prev.ids;
    process.env.TENANT_SILO_DSN_TEMPLATE = prev.tpl;
  });

  it("defaults every tenant to pool when no silo config (backward compatible)", () => {
    const prev = process.env.TENANT_SILO_IDS;
    delete process.env.TENANT_SILO_IDS;
    expect(envTenantResolver()(T1)).toEqual({ tier: "pool" });
    process.env.TENANT_SILO_IDS = prev;
  });

  it("cachedResolver memoizes per tenant within the TTL", async () => {
    let calls = 0;
    const inner: TenantResolver = () => { calls++; return { tier: "pool" }; };
    const resolve = cachedResolver(inner, 10_000);
    await resolve(T1); await resolve(T1); await resolve(T1);
    expect(calls).toBe(1);
    await resolve(T2);
    expect(calls).toBe(2);
  });
});
