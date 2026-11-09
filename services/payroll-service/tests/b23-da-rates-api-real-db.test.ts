/**
 * Payroll admin DA-rate API (UAT b23 onboarding gap): a new tenant had no way to record a Dearness
 * Allowance rate, so every run failed with DA_RATE_NOT_CONFIGURED. Real Postgres, FORCE RLS as the
 * NOBYPASSRLS payroll_svc role, real consumers, no mocks:
 *   - GET/POST/DELETE role gates (payroll_admin / super_admin write; others 403) and nothing written when refused;
 *   - POST records the rate + one audit; payroll then resolves it (the original defect);
 *   - duplicate effective date -> 409, non-first-of-month / bad bps / missing order -> 400;
 *   - a rate used by a processed (approved/disbursed) run cannot be deleted (409, row survives); an unused one can;
 *   - tenant isolation of list, delete and the resolved rate.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient, scopedRead } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerDaRateConsumers } from "../src/modules/da-rates/consumer.js";
import { resolveDaRateBps } from "../src/modules/payroll/consumer.js";
import { lockDaRates } from "../src/modules/da-rates/rules.js";
import { runWithTenant } from "@civitasone/db";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER = randomUUID();
const ADMIN = randomUUID();
const ORDER = "7th CPC Central DA as per MoF DoE OM dated 28.03.2026";

const auth = (roles: string[], tenant = TENANT) => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid: tenant, roles, sid: "da" }, SECRET)}` });
type Row = Record<string, unknown>;
async function q(text: ReturnType<typeof sql>, tenant = TENANT): Promise<Row[]> {
  return withTenantScope(db as never, tenant, async (tx: { execute: (x: unknown) => Promise<unknown> }) => Array.from((await tx.execute(text)) as Iterable<Row>));
}
async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) { await new Promise((r) => setTimeout(r, 50)); v = await fn(); }
  return v;
}
const rates = (t = TENANT) => q(sql`SELECT id, to_char(effective_from,'YYYY-MM-DD') AS d, rate_bps, order_ref FROM payroll.dearness_allowance_rates ORDER BY effective_from`, t);
const audits = (t = TENANT) => q(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND tenant_id = ${t}::uuid AND payload->>'resourceType' = 'dearness_allowance_rates' ORDER BY created_at`, t);
const rateFor = (t: string, month: string) => runWithTenant(t, () => scopedRead((tx) => resolveDaRateBps(tx as never, t, month)));
const post = (body: unknown, roles = ["payroll_admin"], t = TENANT) => app.inject({ method: "POST", url: "/v1/payroll/da-rates", headers: auth(roles, t), payload: body as object });

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  registerDaRateConsumers(queue);
  await (queue as unknown as { start?: () => Promise<void> }).start?.();
  app = await buildApp();
});
afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await q(sql`DELETE FROM payroll.payroll_runs WHERE tenant_id = ${t}::uuid`, t);
    await q(sql`DELETE FROM payroll.dearness_allowance_rates WHERE tenant_id = ${t}::uuid`, t);
  }
  await app?.close();
  await sqlClient.end();
});

describe("DA rate admin API (real DB, NOBYPASSRLS)", () => {
  it("a tenant with no rate fails payroll with DA_RATE_NOT_CONFIGURED (the defect)", async () => {
    await expect(rateFor(TENANT, "2026-10")).rejects.toThrow(/DA_RATE_NOT_CONFIGURED/);
  });

  it("role gates: only payroll_admin / super_admin write; others get 403 and nothing is written", async () => {
    for (const roles of [["payroll_officer"], ["hr_admin"], ["finance_officer"], ["employee"]]) {
      expect((await post({ effectiveFrom: "2026-01-01", rateBps: 5800, orderRef: ORDER }, roles)).statusCode, roles.join()).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: "/v1/payroll/da-rates", headers: auth(["employee"]) })).statusCode).toBe(403);
    await new Promise((r) => setTimeout(r, 300));
    expect(await rates()).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });

  it("validation: first-of-month only, bps range, order reference required", async () => {
    for (const bad of [
      { effectiveFrom: "2026-01-15", rateBps: 5800, orderRef: ORDER },
      { effectiveFrom: "2026-02-30", rateBps: 5800, orderRef: ORDER },
      { effectiveFrom: "2026-01-01", rateBps: -1, orderRef: ORDER },
      { effectiveFrom: "2026-01-01", rateBps: 25000, orderRef: ORDER },
      { effectiveFrom: "2026-01-01", rateBps: 58.5, orderRef: ORDER },
      { effectiveFrom: "2026-01-01", rateBps: 5800, orderRef: "x" },
    ]) expect((await post(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    expect(await rates()).toHaveLength(0);
  });

  it("records a rate (202), audits it once, and payroll then resolves it", async () => {
    const res = await post({ effectiveFrom: "2026-01-01", rateBps: 5800, orderRef: ORDER });
    expect(res.statusCode).toBe(202);
    const rows = await until(() => rates(), (r) => r.length >= 1);
    expect(rows).toEqual([{ id: res.json().id, d: "2026-01-01", rate_bps: 5800, order_ref: ORDER }]);
    const a = await until(() => audits(), (r) => r.length >= 1);
    expect(a).toHaveLength(1);
    expect(a[0]!.payload).toMatchObject({ action: "create", effectiveFrom: "2026-01-01", rateBps: 5800, orderRef: ORDER });
    expect(await rateFor(TENANT, "2026-10")).toBe(5800n);
  });

  it("a duplicate effective date is refused with 409 and changes nothing", async () => {
    const res = await post({ effectiveFrom: "2026-01-01", rateBps: 6000, orderRef: ORDER });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DA_RATE_EXISTS_FOR_DATE");
    expect(await rates()).toHaveLength(1);
  });

  it("a July revision is added; GET lists the series oldest-first with the rate in force", async () => {
    const res = await post({ effectiveFrom: "2026-07-01", rateBps: 6000, orderRef: "7th CPC Central DA as per MoF DoE OM dated 30.09.2026" });
    expect(res.statusCode).toBe(202);
    await until(() => rates(), (r) => r.length >= 2);
    const list = await app.inject({ method: "GET", url: "/v1/payroll/da-rates", headers: auth(["payroll_officer"]) });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json().data.map((r: { effectiveFrom: string; rateBps: number }) => [r.effectiveFrom, r.rateBps])).toEqual([["2026-01-01", 5800], ["2026-07-01", 6000]]);
    expect(list.json().current.effectiveFrom).toBe("2026-07-01");
    expect(await rateFor(TENANT, "2026-06")).toBe(5800n);
    expect(await rateFor(TENANT, "2026-07")).toBe(6000n);
  });

  it("tenant isolation: another tenant sees none, cannot delete, and still fails payroll", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/payroll/da-rates", headers: auth(["payroll_admin"], OTHER) });
    expect(list.json().data).toEqual([]);
    const [mine] = await rates();
    const del = await app.inject({ method: "DELETE", url: `/v1/payroll/da-rates/${mine!.id}`, headers: auth(["payroll_admin"], OTHER) });
    expect(del.statusCode).toBe(404);
    await expect(rateFor(OTHER, "2026-10")).rejects.toThrow(/DA_RATE_NOT_CONFIGURED/);
  });

  it("a rate used by a processed payroll run cannot be deleted; an unused one can", async () => {
    const [jan, jul] = await rates();
    await q(sql`INSERT INTO payroll.payroll_runs (tenant_id, run_no, month, structure_id, status, created_by, updated_by)
                VALUES (${TENANT}::uuid, 'PR-2026-03', '2026-03', ${randomUUID()}::uuid, 'disbursed', ${ADMIN}::uuid, ${ADMIN}::uuid)`);
    const blocked = await app.inject({ method: "DELETE", url: `/v1/payroll/da-rates/${jan!.id}`, headers: auth(["payroll_admin"]) });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("DA_RATE_IN_USE");
    expect(blocked.json().message).toContain("2026-03");
    expect(await rates()).toHaveLength(2);

    // a draft run does not count as processed; the July rate has no processed run
    const refused = await app.inject({ method: "DELETE", url: `/v1/payroll/da-rates/${jul!.id}`, headers: auth(["hr_admin"]) });
    expect(refused.statusCode).toBe(403);
    const ok = await app.inject({ method: "DELETE", url: `/v1/payroll/da-rates/${jul!.id}`, headers: auth(["payroll_admin"]) });
    expect(ok.statusCode).toBe(202);
    const left = await until(() => rates(), (r) => r.length === 1);
    expect(left.map((r) => r.d)).toEqual(["2026-01-01"]);
    const a = await until(() => audits(), (r) => r.some((x) => (x.payload as { action: string }).action === "delete"));
    expect(a.map((x) => (x.payload as { action: string }).action)).toEqual(["create", "create", "delete"]);
  });

  it("deleting a rate whose later successor was removed now covers the later months too (guard follows the series)", async () => {
    // Jan rate is now the only one: a run in 2026-09 also depends on it
    await q(sql`INSERT INTO payroll.payroll_runs (tenant_id, run_no, month, structure_id, status, created_by, updated_by)
                VALUES (${TENANT}::uuid, 'PR-2026-09', '2026-09', ${randomUUID()}::uuid, 'approved', ${ADMIN}::uuid, ${ADMIN}::uuid)`);
    const [jan] = await rates();
    const blocked = await app.inject({ method: "DELETE", url: `/v1/payroll/da-rates/${jan!.id}`, headers: auth(["super_admin"]) });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().message).toContain("2026-09");
  });

  it.each(["computed", "paid", "processing"])("a rate behind a %s run cannot be deleted", async (status) => {
    const t = randomUUID();
    try {
      const a = await post({ effectiveFrom: "2025-04-01", rateBps: 5500, orderRef: ORDER }, ["payroll_admin"], t);
      expect(a.statusCode).toBe(202);
      const [rate] = await until(() => rates(t), (r) => r.length >= 1);
      await q(sql`INSERT INTO payroll.payroll_runs (tenant_id, run_no, month, structure_id, status, created_by, updated_by)
                  VALUES (${t}::uuid, ${"PR-" + status}, '2025-05', ${randomUUID()}::uuid, ${status}, ${ADMIN}::uuid, ${ADMIN}::uuid)`, t);
      const res = await app.inject({ method: "DELETE", url: `/v1/payroll/da-rates/${rate!.id}`, headers: auth(["payroll_admin"], t) });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("DA_RATE_IN_USE");
      expect(await rates(t)).toHaveLength(1);
      // draft / failed / cancelled runs never priced a payslip: they do not block
      await q(sql`UPDATE payroll.payroll_runs SET status = 'cancelled' WHERE tenant_id = ${t}::uuid`, t);
      expect((await app.inject({ method: "DELETE", url: `/v1/payroll/da-rates/${rate!.id}`, headers: auth(["payroll_admin"], t) })).statusCode).toBe(202);
      await until(() => rates(t), (r) => r.length === 0);
    } finally {
      await q(sql`DELETE FROM payroll.payroll_runs WHERE tenant_id = ${t}::uuid`, t);
      await q(sql`DELETE FROM payroll.dearness_allowance_rates WHERE tenant_id = ${t}::uuid`, t);
    }
  });

  it("a delete waits for a run's in-flight DA lookup (advisory lock), then applies", async () => {
    const t = randomUUID();
    try {
      await post({ effectiveFrom: "2025-04-01", rateBps: 5500, orderRef: ORDER }, ["payroll_admin"], t);
      const [rate] = await until(() => rates(t), (r) => r.length >= 1);
      let release!: () => void;
      const held = new Promise<void>((r) => { release = r; });
      let locked!: () => void;
      const gotLock = new Promise<void>((r) => { locked = r; });
      // a run's lookup: shared lock held inside its transaction
      const runTx = runWithTenant(t, () => db.transaction(async (tx) => {
        await lockDaRates(tx as never, t, "shared");
        locked();
        await held;
      }));
      await gotLock;
      expect((await app.inject({ method: "DELETE", url: `/v1/payroll/da-rates/${rate!.id}`, headers: auth(["payroll_admin"], t) })).statusCode).toBe(202);
      await new Promise((r) => setTimeout(r, 500));
      expect(await rates(t)).toHaveLength(1); // delete consumer is blocked behind the run's lookup
      release();
      await runTx;
      expect(await until(() => rates(t), (r) => r.length === 0)).toHaveLength(0);
    } finally {
      await q(sql`DELETE FROM payroll.dearness_allowance_rates WHERE tenant_id = ${t}::uuid`, t);
    }
  });
});
