/**
 * GAP-FINANCE-JOURNAL-ENTRY-04 review fix: flagging or un-flagging a control account is admin-only and
 * audited with the old and new value in the same transaction.
 *
 * GAP2-FINANCE-CHART-OF-ACCOUNTS-07: POST/PATCH /v1/finance/accounts are now
 * CQRS'd (route validates + publishes, consumer writes). The create/update
 * therefore return 202 and the row + audit are written asynchronously by
 * registerBudgetConsumers, so this test now registers that consumer on the
 * shared queue singleton (wrapped in runWithTenant exactly as worker.ts does)
 * and drains it before reading back. The authorization/validation semantics
 * (admin-only control flag, unchanged value = no audit) are unchanged.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { scoped } from "./_tenant.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000003f9";
const ACTOR = "00000000-aaaa-4000-8000-0000000003f9";
const HEAD = "cccccccc-5555-4000-8000-0000000003f9";
const hdr = (roles: string[], corr?: string) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-head-control" }, SECRET)}`,
  ...(corr ? { "x-correlation-id": corr } : {}),
});

// Wrap the shared queue singleton's subscribe the same way worker.ts does so
// the consumer's db.transaction() runs under the message tenant GUC (RLS), and
// register the budget consumers that drain accountCreate/accountUpdate.
type Drainable = { subscribe: (topic: string, handler: (msg: any) => Promise<void>) => void; drain(): Promise<void> };
const q = queue as unknown as Drainable;
const rawSubscribe = q.subscribe.bind(q);
q.subscribe = (topic, handler) =>
  rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
registerBudgetConsumers(queue);

async function rows(qy: ReturnType<typeof sql>): Promise<any[]> {
  return scoped(TENANT, async (tx) => { const r: any = await tx.execute(qy); return Array.isArray(r) ? r : r.rows ?? []; });
}
const controlOf = async () => (await rows(sql`SELECT is_control FROM budget.finance_heads WHERE id = ${HEAD}::uuid`))[0].is_control as boolean;
const audits = (corr: string) => rows(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${corr}`);

async function cleanup() {
  await scoped(TENANT, (tx) => tx.execute(sql`DELETE FROM budget.finance_heads WHERE tenant_id = ${TENANT}::uuid`));
  // GAP2-FINANCE-CHART-OF-ACCOUNTS-07: this test uses fixed correlation ids and
  // now asserts audit-row COUNTS written asynchronously by the consumer, so it
  // must purge its own outbox rows up front to stay isolated across re-runs.
  await scoped(TENANT, (tx) => tx.execute(sql`
    DELETE FROM _outbox.messages
    WHERE tenant_id = ${TENANT}::uuid
      AND correlation_id IN ('corr-head-rename','corr-head-on','corr-head-off','corr-head-same','corr-head-create')
  `));
}
beforeAll(async () => {
  await cleanup();
  await scoped(TENANT, (tx) => tx.execute(sql`
    INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, classification, is_control, created_by, updated_by)
    VALUES (${HEAD}::uuid, ${TENANT}::uuid, '2300', 'Creditors', 0, 'liability', false, ${ACTOR}::uuid, ${ACTOR}::uuid)`));
});
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("isControl is an admin-only, audited change", () => {
  it("a finance_officer cannot flag a control account on PATCH or on create; nothing changes", async () => {
    const app = await buildApp();
    try {
      const patch = await app.inject({ method: "PATCH", url: `/v1/finance/accounts/${HEAD}`, headers: hdr(["finance_officer"]), payload: { isControl: true } });
      expect(patch.statusCode).toBe(403);
      expect(await controlOf()).toBe(false);
      const create = await app.inject({ method: "POST", url: "/v1/finance/accounts", headers: hdr(["finance_officer"]), payload: { code: "2301", name: "Another control", level: 0, classification: "liability", isControl: true } });
      expect(create.statusCode).toBe(403);
      expect(await rows(sql`SELECT 1 FROM budget.finance_heads WHERE tenant_id = ${TENANT}::uuid AND code = '2301'`)).toHaveLength(0);
    } finally { await app.close(); }
  });

  it("an officer can still rename a head and re-send an unchanged isControl", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "PATCH", url: `/v1/finance/accounts/${HEAD}`, headers: hdr(["finance_officer"], "corr-head-rename"), payload: { name: "Trade Creditors", isControl: false } });
      expect(res.statusCode).toBe(202);
      await q.drain();
      // a plain rename / unchanged isControl is NOT a control change: no audit
      expect(await audits("corr-head-rename")).toHaveLength(0);
      expect((await rows(sql`SELECT name FROM budget.finance_heads WHERE id = ${HEAD}::uuid`))[0].name).toBe("Trade Creditors");
    } finally { await app.close(); }
  });

  it("an admin flips it and the same transaction records old and new in an audit event; un-flagging is audited too", async () => {
    const app = await buildApp();
    try {
      const on = await app.inject({ method: "PATCH", url: `/v1/finance/accounts/${HEAD}`, headers: hdr(["finance_admin"], "corr-head-on"), payload: { isControl: true } });
      expect(on.statusCode).toBe(202);
      await q.drain();
      expect(await controlOf()).toBe(true);
      const a = await audits("corr-head-on");
      expect(a).toHaveLength(1);
      expect(a[0].payload).toMatchObject({ action: "update_head_control", resourceType: "finance_head", resourceId: HEAD, details: { isControl: { old: false, new: true } } });
      const off = await app.inject({ method: "PATCH", url: `/v1/finance/accounts/${HEAD}`, headers: hdr(["super_admin"], "corr-head-off"), payload: { isControl: false } });
      expect(off.statusCode).toBe(202);
      await q.drain();
      expect((await audits("corr-head-off"))[0].payload).toMatchObject({ details: { isControl: { old: true, new: false } } });
      // re-sending the same value is not a change: no audit event
      const same = await app.inject({ method: "PATCH", url: `/v1/finance/accounts/${HEAD}`, headers: hdr(["finance_admin"], "corr-head-same"), payload: { isControl: false } });
      expect(same.statusCode).toBe(202);
      await q.drain();
      expect(await audits("corr-head-same")).toHaveLength(0);
    } finally { await app.close(); }
  });

  it("an admin creating a control account is audited (false -> true)", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: "/v1/finance/accounts", headers: hdr(["finance_admin"], "corr-head-create"), payload: { code: "2302", name: "Control two", level: 0, classification: "liability", isControl: true } });
      expect(res.statusCode).toBe(202);
      await q.drain();
      // the row is written by the consumer, not the route
      expect(await rows(sql`SELECT is_control FROM budget.finance_heads WHERE tenant_id = ${TENANT}::uuid AND code = '2302'`)).toMatchObject([{ is_control: true }]);
      const a = await audits("corr-head-create");
      expect(a[0].payload).toMatchObject({ action: "update_head_control", resourceId: res.json().id, details: { isControl: { old: false, new: true } } });
    } finally { await app.close(); }
  });
});
