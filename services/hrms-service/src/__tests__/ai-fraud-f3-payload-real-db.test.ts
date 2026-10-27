/**
 * AI fraud alerts / recommendations through the F3 queue, real DB, no mocks.
 *
 * POST /v1/hrms/ai/scan and GET /v1/hrms/ai/recommendations looped over their
 * in-memory alert / rec objects but published only { body, params, query }, so
 * the consumer had nothing to persist: every alert and recommendation was
 * dropped (the consumer referenced undefined `alert` / `rec`). This suite proves
 * the objects now reach the table, tenant-scoped and idempotent on redelivery.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { COMMANDS } from "../topics.js";
import { registerF3_ai_fraud_Consumers } from "../modules/ai-fraud/f3-consumer.js";

registerF3_ai_fraud_Consumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = "facade00-a04c-4000-8000-000000000051";
const OTHER_TENANT = "facade00-a04c-4000-8000-000000000052";
const SEED_ACTOR = globalThis.crypto.randomUUID();
const GHOST_A = globalThis.crypto.randomUUID();
const GHOST_B = globalThis.crypto.randomUUID();
const hr = { authorization: `Bearer ${signToken({ sub: globalThis.crypto.randomUUID(), tid: TENANT, roles: ["hr_admin"], sid: "sess-ai-fraud" }, SECRET)}` };

let app: Awaited<ReturnType<typeof buildApp>>;
const asTenant = <T>(t: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, t, fn);

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER_TENANT]) {
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_fraud_alerts WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_recommendations WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${t} AND topic = ${"audit.event.record"}`);
  }
}
async function seedEmployee(id: string, no: string): Promise<void> {
  await asTenant(TENANT, (tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, created_by, updated_by)
    VALUES (${id}, ${TENANT}, ${no}, ${"Ghost " + no}, ${globalThis.crypto.randomUUID()}, ${globalThis.crypto.randomUUID()}, ${"2020-01-01"}, ${"confirmed"}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
}
const alertRows = (t = TENANT) => asTenant(t, (tx) => tx`
  SELECT alert_type, severity, employee_id, status, ml_model, risk_score::float AS risk_score, tenant_id
  FROM employee.hrms_fraud_alerts WHERE tenant_id = ${t} ORDER BY employee_id`);
const recRows = (t = TENANT) => asTenant(t, (tx) => tx`
  SELECT category, title, priority, employee_id FROM employee.hrms_recommendations WHERE tenant_id = ${t} ORDER BY title`);

beforeAll(async () => { await cleanup(); app = await buildApp(); });
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("POST /v1/hrms/ai/scan stores its alerts", () => {
  it("writes one hrms_fraud_alerts row per ghost-employee alert with the right type, severity and employee", async () => {
    await seedEmployee(GHOST_A, "AIF-1");
    await seedEmployee(GHOST_B, "AIF-2");

    const r = await app.inject({ method: "POST", url: "/v1/hrms/ai/scan", headers: hr });
    expect(r.statusCode).toBe(200);
    expect(r.json().alertsGenerated).toBe(2);
    await drain();

    const rows = await alertRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x.employee_id).sort()).toEqual([GHOST_A, GHOST_B].sort());
    for (const row of rows) {
      expect(row).toMatchObject({ alert_type: "ghost_employee", severity: "critical", status: "open", ml_model: "ghost_detector_v1", tenant_id: TENANT });
      expect(row.risk_score).toBeCloseTo(0.95, 4);
    }
    expect(await alertRows(OTHER_TENANT)).toHaveLength(0);
  });
});

describe("GET /v1/hrms/ai/recommendations stores its recs", () => {
  it("persists every generated recommendation for the tenant and returns them", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/ai/recommendations", headers: hr });
    expect(r.statusCode).toBe(200);
    await drain();

    const rows = await recRows();
    expect(rows.length).toBe(3);
    expect(rows.map((x) => x.category).sort()).toEqual(["compliance", "staffing", "wellness"]);
    expect(rows.find((x) => x.category === "wellness")).toMatchObject({ priority: "medium", employee_id: "eeeeeeee-0001-0000-0000-000000000005" });
    expect(await recRows(OTHER_TENANT)).toHaveLength(0);

    // A second call now finds stored recs and must not generate a duplicate set.
    const again = await app.inject({ method: "GET", url: "/v1/hrms/ai/recommendations", headers: hr });
    expect(again.json().data).toHaveLength(3);
    await drain();
    expect(await recRows()).toHaveLength(3);
  });
});

describe("redelivery", () => {
  it("a redelivered alert / rec message does not duplicate rows", async () => {
    const publish = (messageId: string, op: string, extra: Record<string, unknown>) => queue.publish(COMMANDS.f3RouteWrite, {
      messageId, type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: SEED_ACTOR,
      correlationId: globalThis.crypto.randomUUID(), schemaVersion: "1.0",
      payload: { op, id: messageId, tenantId: TENANT, body: {}, params: {}, query: {}, ...extra },
    });
    const alertMsg = globalThis.crypto.randomUUID();
    const recMsg = globalThis.crypto.randomUUID();
    const alert = { alertType: "duplicate_bank", severity: "high", employeeId: GHOST_A, description: "dup", evidence: { k: 1 }, riskScore: 0.9, mlModel: "duplicate_bank_v1" };
    const rec = { category: "retention", title: "Redelivery rec", description: "d", priority: "low" };
    const before = { a: (await alertRows()).length, r: (await recRows()).length };

    for (let i = 0; i < 3; i++) {
      await publish(alertMsg, "ai_fraud_routes__0", { alert });
      await publish(recMsg, "ai_fraud_routes__1", { rec });
      await drain();
    }
    expect((await alertRows()).length).toBe(before.a + 1);
    expect((await recRows()).length).toBe(before.r + 1);
  });
});
