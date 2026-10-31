/**
 * F2 (UAT bundle 10): createTenantTxHook must scope the request's RLS GUC to the
 * VERIFIED tenant (req.ctx.tenantId, set by authPlugin), never to the raw
 * x-tenant-id header. Real-Postgres coverage of the same contract lives in
 * services/crm-service/tests/f2-tenant-header-guc-real-db.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { createTenantTxHook, resolveRlsTenant } from "./tenant-tx.js";
import { tenantStorage, getCurrentTenantId, runWithTenant } from "./tenant-context.js";

const A = "aaaaaaaa-0000-4000-8000-0000000000f2";
const B = "bbbbbbbb-0000-4000-8000-0000000000f2";

type Req = Parameters<typeof resolveRlsTenant>[0];
const userReq = (tid: string, header?: string): Req => ({
  headers: header ? { "x-tenant-id": header } : {},
  ctx: { tenantId: tid, actorId: "11111111-0000-4000-8000-000000000001" },
});

function fakeReply() {
  const sent: { status?: number; body?: unknown } = {};
  return {
    sent,
    reply: { code: (s: number) => { sent.status = s; return { send: (b: unknown) => { sent.body = b; return b; } }; } },
  };
}

/** Run the hook inside a fresh ALS scope (like a Fastify request) and report the tenant it left behind. */
async function runHook(req: Req) {
  const executed: unknown[] = [];
  const db = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({ execute: async (q: unknown) => { executed.push(q); } }),
  };
  const { sent, reply } = fakeReply();
  const warn = vi.fn();
  const r = { ...req, log: { warn } };
  const seen = await tenantStorage.run(undefined as never, async () => {
    await createTenantTxHook(db)(r, reply);
    return getCurrentTenantId();
  });
  return { sent, alsTenant: seen, warn, req: r as Req & { tenantTx?: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }, executed };
}

describe("resolveRlsTenant", () => {
  it("uses the verified tenant when no header is sent", () => {
    expect(resolveRlsTenant(userReq(A))).toEqual({ tenantId: A });
  });
  it("accepts a header equal to the verified tenant (gateway path)", () => {
    expect(resolveRlsTenant(userReq(A, A))).toEqual({ tenantId: A });
  });
  it("ignores (and reports) a header naming a different tenant", () => {
    expect(resolveRlsTenant(userReq(A, B))).toEqual({ tenantId: A, ignoredHeaderTenantId: B });
  });
  it("never falls back to the header without a verified context", () => {
    expect(resolveRlsTenant({ headers: { "x-tenant-id": B } })).toEqual({ tenantId: undefined });
    expect(resolveRlsTenant({ headers: { "x-tenant-id": B }, ctx: null })).toEqual({ tenantId: undefined });
  });
  it("ignores the header for an authenticated token that carries no tenant", () => {
    expect(resolveRlsTenant({ headers: { "x-tenant-id": B }, ctx: { tenantId: "", actorId: "u-1" } })).toEqual({ tenantId: undefined });
  });
  it("ignores the header on /health-style system contexts", () => {
    expect(resolveRlsTenant({ headers: { "x-tenant-id": B }, ctx: { tenantId: "", actorId: "system" } })).toEqual({ tenantId: undefined });
  });
  it("public (anonymous) routes with no ctx tenant may name the tenant by header", () => {
    expect(resolveRlsTenant({ headers: { "x-tenant-id": B }, ctx: { tenantId: "", actorId: "anonymous" } })).toEqual({ tenantId: B });
  });
  it("public routes: a header that contradicts the ctx tenant is ignored too", () => {
    expect(resolveRlsTenant({ headers: { "x-tenant-id": B }, ctx: { tenantId: A, actorId: "anonymous" } })).toEqual({ tenantId: A, ignoredHeaderTenantId: B });
  });
  it("x-internal: authPlugin copies the header into ctx after the secret check, so it matches", () => {
    expect(resolveRlsTenant({ headers: { "x-internal": "1", "x-tenant-id": B }, ctx: { tenantId: B, actorId: "00000000-0000-0000-0000-000000000099" } })).toEqual({ tenantId: B });
  });
});

describe("createTenantTxHook", () => {
  it("a mismatched header is ignored and logged: the tenant stays the verified one", async () => {
    const r = await runHook(userReq(A, B));
    expect(r.sent.status).toBeUndefined();
    expect(r.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "tenant_header_mismatch", verifiedTenantId: A, headerTenantId: B }), expect.any(String));
    expect(r.alsTenant).toBe(A);
    await r.req.tenantTx!(async () => undefined);
    expect(JSON.stringify(r.executed)).toContain(A);
    expect(JSON.stringify(r.executed)).not.toContain(B);
  });
  it("truncates the raw header value it logs to 64 characters", async () => {
    const huge = B + "x".repeat(5000);
    const r = await runHook(userReq(A, huge));
    const logged = r.warn.mock.calls[0]![0] as { headerTenantId: string };
    expect(logged.headerTenantId).toHaveLength(64);
    expect(huge.startsWith(logged.headerTenantId)).toBe(true);
    expect(r.alsTenant).toBe(A);
  });
  it("stores the verified tenant in AsyncLocalStorage (no header)", async () => {
    const r = await runHook(userReq(A));
    expect(r.sent.status).toBeUndefined();
    expect(r.alsTenant).toBe(A);
  });
  it("req.tenantTx scopes to the verified tenant", async () => {
    const r = await runHook(userReq(A, A));
    await r.req.tenantTx!(async () => undefined);
    expect(JSON.stringify(r.executed)).toContain(A);
    expect(JSON.stringify(r.executed)).not.toContain(B);
  });
  it("no verified context: no tenant even when the header is set", async () => {
    const r = await runHook({ headers: { "x-tenant-id": B } });
    expect(r.alsTenant).toBeUndefined();
    expect(r.sent.status).toBeUndefined();
  });
});

describe("createTenantTxHook does not inherit a stale tenant", () => {
  it("a request with no verified tenant clears a store left by an earlier request", async () => {
    const db = { transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({ execute: async () => undefined }) };
    const { reply } = fakeReply();
    const seen = await tenantStorage.run({ tenantId: B }, async () => {
      await createTenantTxHook(db)({ headers: { "x-tenant-id": B } }, reply);
      return getCurrentTenantId();
    });
    expect(seen).toBeFalsy();
  });
});

describe("worker path is independent of the hook", () => {
  it("runWithTenant scopes the envelope tenant", async () => {
    expect(await runWithTenant(B, () => getCurrentTenantId())).toBe(B);
  });
});
