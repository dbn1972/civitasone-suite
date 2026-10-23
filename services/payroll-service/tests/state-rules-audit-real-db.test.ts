/**
 * GAP-PAYROLL-STATUTORY-LWF-01 (real Postgres, FORCE RLS, real consumer, no mocks):
 *   - POST /v1/payroll/statutory/state-rules is closed to every non-payroll role (403) and nothing is
 *     written or audited for a refused caller;
 *   - an allowed change writes the rule AND exactly one audit event carrying the exact before/after
 *     (paise strings + frequency), in the same transaction as the write;
 *   - a partial update (COALESCE keeps the omitted fields) audits the true before and the true after;
 *   - the audit is tenant-scoped;
 *   - a command redelivered with the SAME messageId (to a fresh consumer, so the in-memory queue dedup
 *     cannot mask the DB guard) is skipped by markProcessed: one write, one audit.
 *
 * Requires DATABASE_URL pointing at a disposable, migrated instance (see vitest.config.ts REL-035).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { MemoryQueue } from "@civitasone/queue";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";

// vitest.config.ts sets JWT_SECRET for every suite.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ADMIN_USER = randomUUID();
const OFFICER_USER = randomUUID();

function auth(sub: string, roles: string[], tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "state-rules" }, SECRET)}` };
}

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);
async function q(text: ReturnType<typeof sql>, tenant = TENANT): Promise<Row[]> {
  return withTenantScope(db as never, tenant, async (tx: { execute: (x: unknown) => Promise<unknown> }) => rowsOf(await tx.execute(text)));
}
async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    v = await fn();
  }
  return v;
}
const stateAudits = (stateCode: string, tenant = TENANT) =>
  q(sql`SELECT actor_id, payload FROM _outbox.messages
         WHERE topic = 'audit.event.record' AND tenant_id = ${tenant}::uuid
           AND payload->>'resourceType' = 'payroll_state_rules' AND payload->>'resourceId' = ${stateCode}
         ORDER BY created_at`, tenant);
const lwfRow = async (stateCode: string, tenant = TENANT) =>
  (await q(sql`SELECT employee_contrib_minor::text AS emp, employer_contrib_minor::text AS er, frequency FROM payroll.payroll_lwf WHERE state_code = ${stateCode}`, tenant))[0];

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  registerPayrollConsumers(queue);
  await (queue as unknown as { start?: () => Promise<void> }).start?.();
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await sqlClient.end();
});

describe("POST /v1/payroll/statutory/state-rules -- role gate and before/after audit (real DB)", () => {
  it("refuses manager, hr_admin, finance_officer and employee with 403: nothing is written, nothing is audited", async () => {
    for (const roles of [["manager"], ["hr_admin"], ["finance_officer"], ["employee"]]) {
      const res = await app.inject({ method: "POST", url: "/v1/payroll/statutory/state-rules", headers: auth(randomUUID(), roles), payload: { stateCode: "GA", lwfEmployee: 4000 } });
      expect(res.statusCode, roles.join(",")).toBe(403);
    }
    await new Promise((r) => setTimeout(r, 400));
    expect(await lwfRow("GA")).toBeUndefined();
    expect(await stateAudits("GA")).toHaveLength(0);
  });

  it("a first-ever LWF rule: stored, and audited with oldValue null and the exact stored newValue", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/payroll/statutory/state-rules", headers: auth(ADMIN_USER, ["payroll_admin"]),
      payload: { stateCode: "MH", lwfEmployee: 2500, lwfEmployer: 7500, lwfFrequency: "half_yearly" },
    });
    expect(res.statusCode).toBe(202);
    const audits = await until(() => stateAudits("MH"), (a) => a.length >= 1);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor_id).toBe(ADMIN_USER);
    expect(audits[0]!.payload).toMatchObject({
      service: "payroll", action: "upsert", resourceType: "payroll_state_rules", resourceId: "MH", outcome: "success",
      oldValue: null,
      newValue: { lwfEmployeeMinor: "2500", lwfEmployerMinor: "7500", lwfFrequency: "half_yearly" },
    });
    expect(await lwfRow("MH")).toMatchObject({ emp: "2500", er: "7500", frequency: "half_yearly" });
  });

  it("a partial update audits the TRUE before and after: omitted fields are kept (COALESCE), changed ones differ", async () => {
    // payroll_officer is currently permitted (owner decision pending on narrowing -- see gap-routes.ts STATE_RULE_WRITER_ROLES)
    const res = await app.inject({
      method: "POST", url: "/v1/payroll/statutory/state-rules", headers: auth(OFFICER_USER, ["payroll_officer"]),
      payload: { stateCode: "MH", lwfEmployer: 9000, lwfFrequency: "yearly" },
    });
    expect(res.statusCode).toBe(202);
    const audits = await until(() => stateAudits("MH"), (a) => a.length >= 2);
    expect(audits).toHaveLength(2);
    expect(audits[1]!.actor_id).toBe(OFFICER_USER);
    expect(audits[1]!.payload).toMatchObject({
      oldValue: { lwfEmployeeMinor: "2500", lwfEmployerMinor: "7500", lwfFrequency: "half_yearly" },
      newValue: { lwfEmployeeMinor: "2500", lwfEmployerMinor: "9000", lwfFrequency: "yearly" },
    });
    expect(await lwfRow("MH")).toMatchObject({ emp: "2500", er: "9000", frequency: "yearly" });
  });

  it("the audit is tenant-scoped: another tenant's change to the same state never appears in this tenant's trail", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/payroll/statutory/state-rules", headers: auth(randomUUID(), ["payroll_admin"], OTHER_TENANT),
      payload: { stateCode: "MH", lwfEmployee: 1 },
    });
    expect(res.statusCode).toBe(202);
    const other = await until(() => stateAudits("MH", OTHER_TENANT), (a) => a.length >= 1);
    expect(other).toHaveLength(1);
    expect(other[0]!.payload).toMatchObject({ oldValue: null, newValue: { lwfEmployeeMinor: "1" } });
    expect(await stateAudits("MH")).toHaveLength(2);
    expect(await lwfRow("MH")).toMatchObject({ emp: "2500" });
  });

  it("a command redelivered with the same messageId is skipped by markProcessed: still one write and one audit event", async () => {
    const before = (await stateAudits("KA")).length;
    const envelope = {
      messageId: randomUUID(), type: COMMANDS.stateRulesUpsert,
      tenantId: TENANT, actorId: ADMIN_USER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: TENANT, stateCode: "KA", lwfEmployee: 100 },
    };
    // Each delivery goes to its OWN MemoryQueue, so that queue's per-instance (topic, messageId) dedup set is
    // empty both times: only the DB-level markProcessed in the consumer can stop the second delivery. (A single
    // POST never redelivers, and publishing twice to one queue would be swallowed before reaching the consumer.)
    for (let delivery = 1; delivery <= 2; delivery++) {
      const consumerQueue = new MemoryQueue();
      registerPayrollConsumers(consumerQueue);
      await consumerQueue.publish(COMMANDS.stateRulesUpsert, envelope);
      await consumerQueue.drain();
      expect(consumerQueue.dlq, `delivery ${delivery} must not dead-letter`).toHaveLength(0);
    }
    const audits = await stateAudits("KA");
    expect(audits.length).toBe(before + 1);
    expect(audits[audits.length - 1]!.payload).toMatchObject({ newValue: { lwfEmployeeMinor: "100" } });
    expect(await lwfRow("KA")).toMatchObject({ emp: "100" });
  });
});
