/**
 * SEC-012 — POST /v1/quotas/check trusted the `tenantId` in the request
 * BODY instead of deriving tenant identity from the authenticated session.
 * The route had no role gate at all (any authenticated user, any tenant),
 * so an ordinary tenant user could read ANOTHER tenant's quota/usage
 * numbers (limit, used, usagePercent, overLimit, allowed) simply by putting
 * that tenant's id in the body — a cross-tenant data leak.
 *
 * Fixed by deriving tenant identity exclusively from `ctx.tenantId` (see
 * commands.quotaCheck) — `body.tenantId` is still accepted on the wire but
 * is never read for scoping.
 *
 * This test seeds two tenants with clearly different, unambiguous quota
 * state via the real SET + INCREMENT queue-first path (same
 * registerConsumers + MemoryQueue#drain pattern as
 * routes-coverage-full.test.ts's "PATCH /v1/tenant/:tenantId/quotas ->
 * real persisted outcome" block), so a leaked cross-tenant response can
 * never be mistaken for a coincidence: TENANT_A is healthy (100/0),
 * TENANT_B is fully exhausted (7/7, over limit). Rows are deleted in both
 * beforeAll (defensive, in case a prior interrupted run left residue) and
 * afterAll, same rationale as that file's cleanup.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerQuotaConsumers } from "../src/modules/quotas/consumer.js";
import { quotas } from "../src/modules/quotas/schema.js";

const SECRET = process.env.JWT_SECRET as string;

const ACTOR_A = "aa012012-0012-4000-8000-0000000012aa";
const ACTOR_B = "bb012012-0012-4000-8000-0000000012bb";
const TENANT_A = "10012012-aaaa-4000-8000-000000000012";
const TENANT_B = "20012012-bbbb-4000-8000-000000000012";

function bearer(tid: string, sub: string, roles: string[]) {
  return { authorization: `Bearer ${signToken({ sub, tid, roles, sid: "sess-sec012" }, SECRET, 3600)}` };
}

function employeeBearer(tid: string, sub: string) {
  return bearer(tid, sub, ["employee"]);
}

function adminBearer(tid: string, sub: string) {
  return bearer(tid, sub, ["platform_admin"]);
}

async function deleteQuotaRows(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.delete(quotas).where(eq(quotas.tenantId, tenantId))),
  ).catch(() => undefined);
}

let app: FastifyInstance;

describe("POST /v1/quotas/check — SEC-012 cross-tenant scope", () => {
  beforeAll(async () => {
    app = await buildApp();
    registerQuotaConsumers(queue);
    await queue.start();

    // Defensive: remove any residue a prior interrupted run left behind, so
    // this test is idempotent/re-runnable against a persistent dev DB.
    await deleteQuotaRows(TENANT_A);
    await deleteQuotaRows(TENANT_B);

    // TENANT_A: healthy quota, nowhere near the limit.
    await app.inject({
      method: "POST",
      url: "/v1/quotas",
      headers: adminBearer(TENANT_A, ACTOR_A),
      payload: { tenantId: TENANT_A, resource: "api_calls_daily", limit: 100 },
    });
    await (queue as unknown as MemoryQueue).drain();

    // TENANT_B: quota fully exhausted (limit 7, used 7 -> overLimit).
    await app.inject({
      method: "POST",
      url: "/v1/quotas",
      headers: adminBearer(TENANT_B, ACTOR_B),
      payload: { tenantId: TENANT_B, resource: "api_calls_daily", limit: 7 },
    });
    await (queue as unknown as MemoryQueue).drain();
    await app.inject({
      method: "POST",
      url: "/v1/quotas/increment",
      headers: adminBearer(TENANT_B, ACTOR_B),
      payload: { tenantId: TENANT_B, resource: "api_calls_daily", delta: 7 },
    });
    await (queue as unknown as MemoryQueue).drain();
  });

  afterAll(async () => {
    await deleteQuotaRows(TENANT_A);
    await deleteQuotaRows(TENANT_B);
    await queue.stop();
    await app.close();
  });

  it("a caller authenticated as tenant A gets tenant A's OWN quota, even when the body asks for tenant B", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/quotas/check",
      headers: employeeBearer(TENANT_A, ACTOR_A), // authenticated session = TENANT_A
      payload: { tenantId: TENANT_B, resource: "api_calls_daily", requestedAmount: 1 }, // body asks for TENANT_B
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();

    // Must reflect TENANT_A's real, healthy quota...
    expect(json.limit).toBe(100);
    expect(json.used).toBe(0);
    expect(json.allowed).toBe(true);
    expect(json.overLimit).toBe(false);

    // ...and must NOT leak TENANT_B's exhausted quota, proving the body's
    // tenantId no longer influences which tenant is looked up.
    expect(json.limit).not.toBe(7);
    expect(json.used).not.toBe(7);
    expect(json.overLimit).not.toBe(true);
  });

  it("a caller authenticated as tenant B still sees its OWN exhausted quota regardless of body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/quotas/check",
      headers: employeeBearer(TENANT_B, ACTOR_B), // authenticated session = TENANT_B
      payload: { tenantId: TENANT_A, resource: "api_calls_daily", requestedAmount: 1 }, // body asks for TENANT_A
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.limit).toBe(7);
    expect(json.used).toBe(7);
    expect(json.overLimit).toBe(true);
    expect(json.allowed).toBe(false);
  });

  it("still returns 401 without authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/quotas/check",
      payload: { tenantId: TENANT_A, resource: "api_calls_daily", requestedAmount: 1 },
    });
    expect(res.statusCode).toBe(401);
  });
});
