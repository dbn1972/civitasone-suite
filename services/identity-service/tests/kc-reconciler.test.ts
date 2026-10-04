/**
 * SEC H2 reconciler: identity_kc_reconciliations is under FORCE RLS, so the worker must discover due rows across tenants
 * through the read-only BYPASSRLS scanner role and then claim/finish each row inside that row's tenant transaction.
 * Runs as the real non-superuser identity_svc role. Before the fix reconcileDueDeactivations returned 0/0 with a due row
 * present, so a failed or crashed Keycloak disable was never retried.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db, sqlClient } from "../src/shared/db.js";
import { scannerDb } from "../src/shared/scanner-db.js";
import { reconcileDueDeactivations, countPending } from "../src/shared/kc-reconcile.js";

const T = "bbbbbbbb-2222-4000-8000-0000000000c1";
const T2 = "bbbbbbbb-2222-4000-8000-0000000000c2";
const uid = (n: number) => `bbbbbbbb-2222-4000-8000-${String(100 + n).padStart(12, "0")}`;

async function asTenant<R>(tenant: string, fn: (q: typeof sqlClient) => Promise<R>): Promise<R> {
  return (await sqlClient.begin(async (q) => {
    await q`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(q as unknown as typeof sqlClient);
  })) as R;
}
const seedRow = (tenant: string, userId: string, email: string, attempts = 1, due = true) => asTenant(tenant, async (q) => {
  await q`INSERT INTO identity_kc_reconciliations (tenant_id, user_id, email, action, status, attempts, last_error, next_attempt_at)
          VALUES (${tenant}, ${userId}, ${email}, 'deactivate', 'pending', ${attempts}, 'seed', ${new Date(Date.now() + (due ? -1000 : 3_600_000)).toISOString()}::timestamptz)`;
});
const rowOf = (tenant: string, userId: string) => asTenant(tenant, async (q) =>
  (await q<Array<{ status: string; attempts: number; last_error: string | null }>>`SELECT status, attempts, last_error FROM identity_kc_reconciliations WHERE user_id = ${userId}`)[0]);
const auditActions = (tenant: string) => sqlClient<Array<{ payload: unknown }>>`SELECT payload FROM _outbox.messages WHERE tenant_id = ${tenant} AND topic = 'audit.event.record'`
  .then((rows) => rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>));

const wipe = async () => {
  for (const t of [T, T2]) await asTenant(t, async (q) => { await q`DELETE FROM identity_kc_reconciliations WHERE tenant_id = ${t}`; });
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id IN (${T}, ${T2})`;
};
beforeEach(wipe);
afterAll(async () => { await wipe(); await sqlClient.end(); });

const ok = async () => ({ ok: true });
const bad = async () => ({ ok: false, reason: "kc 503" });

describe("reconcileDueDeactivations (identity_svc under FORCE RLS)", () => {
  it("finds due rows in several tenants, calls Keycloak for each and flips them to reconciled", async () => {
    await seedRow(T, uid(1), "one@dept.gov.in");
    await seedRow(T2, uid(2), "two@dept.gov.in");
    const calls: Array<[string, string]> = [];
    const r = await reconcileDueDeactivations(db, async (t, e) => { calls.push([t, e]); return { ok: true }; }, 20, { scanner: scannerDb });
    expect(r).toEqual({ reconciled: 2, retried: 0, failed: 0 });
    expect(calls).toEqual(expect.arrayContaining([[T, "one@dept.gov.in"], [T2, "two@dept.gov.in"]]));
    expect((await rowOf(T, uid(1)))!.status).toBe("reconciled");
    expect((await rowOf(T2, uid(2)))!.status).toBe("reconciled");
  });

  it("does not touch rows that are not yet due or already reconciled", async () => {
    await seedRow(T, uid(1), "later@dept.gov.in", 1, false);
    let called = 0;
    const r = await reconcileDueDeactivations(db, async () => { called++; return { ok: true }; }, 20, { scanner: scannerDb });
    expect(called).toBe(0);
    expect(r).toEqual({ reconciled: 0, retried: 0, failed: 0 });
  });

  it("a failed Keycloak call schedules a backed-off retry and keeps the row pending", async () => {
    await seedRow(T, uid(1), "retry@dept.gov.in", 1);
    const r = await reconcileDueDeactivations(db, bad, 20, { scanner: scannerDb, maxAttempts: 5 });
    expect(r).toEqual({ reconciled: 0, retried: 1, failed: 0 });
    expect(await rowOf(T, uid(1))).toMatchObject({ status: "pending", attempts: 2, last_error: "kc 503" });
    // backoff: not due again right away
    expect((await reconcileDueDeactivations(db, ok, 20, { scanner: scannerDb })).reconciled).toBe(0);
  });

  it("retries are bounded: at max attempts the row goes terminal failed and a high-severity kc_deprovision_failed audit is emitted", async () => {
    await seedRow(T, uid(1), "dead@dept.gov.in", 2);
    const r = await reconcileDueDeactivations(db, bad, 20, { scanner: scannerDb, maxAttempts: 3 });
    expect(r).toEqual({ reconciled: 0, retried: 0, failed: 1 });
    expect(await rowOf(T, uid(1))).toMatchObject({ status: "failed", attempts: 3 });
    const ev = (await auditActions(T)).find((a) => a.action === "kc_deprovision_failed");
    expect(ev).toMatchObject({ severity: "high", resourceId: uid(1), outcome: "failure" });
    // a failed row is never picked up again
    let called = 0;
    await reconcileDueDeactivations(db, async () => { called++; return { ok: true }; }, 20, { scanner: scannerDb });
    expect(called).toBe(0);
  });

  it("a thrown deactivate counts as a failed attempt", async () => {
    await seedRow(T, uid(1), "throw@dept.gov.in", 1);
    const r = await reconcileDueDeactivations(db, async () => { throw new Error("boom"); }, 20, { scanner: scannerDb, maxAttempts: 9 });
    expect(r.retried).toBe(1);
    expect((await rowOf(T, uid(1)))!.last_error).toContain("boom");
  });

  it("two workers never process the same row (SKIP LOCKED + lease)", async () => {
    await seedRow(T, uid(1), "race@dept.gov.in");
    const calls: string[] = [];
    const slow = async (_t: string, e: string) => { calls.push(e); await new Promise((r) => setTimeout(r, 300)); return { ok: true }; };
    const [a, b] = await Promise.all([
      reconcileDueDeactivations(db, slow, 20, { scanner: scannerDb }),
      reconcileDueDeactivations(db, slow, 20, { scanner: scannerDb }),
    ]);
    expect(calls).toHaveLength(1);
    expect(a.reconciled + b.reconciled).toBe(1);
  });

  it("countPending sees pending rows across tenants via the scanner", async () => {
    await seedRow(T, uid(1), "c1@dept.gov.in");
    await seedRow(T2, uid(2), "c2@dept.gov.in");
    expect(await countPending(scannerDb)).toBeGreaterThanOrEqual(2);
  });
});

void randomUUID;
