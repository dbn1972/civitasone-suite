/**
 * W1 SF-05a -- real-Postgres suite for POST /v1/hrms/pii/reveal (employee master):
 *  - a permitted role gets the CLEAR value (decrypted from the encrypted-at-rest column) and exactly one
 *    audit row (actor, subject, field, reason; never the value) is written by the consumer;
 *  - a reason is required; a forbidden role gets 403 with no value and NO audit row;
 *  - phone also admits hr_officer, PAN/bank/IFSC/Aadhaar do not;
 *  - tenant isolation: another tenant's caller gets 404 for this employee, no audit row;
 *  - redelivery of the same command messageId writes the audit row once (markProcessed in the same tx).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import postgres from "postgres";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { encryptPii } from "../src/shared/pii-crypto.js";
import { registerEmployeePiiRevealConsumer, EMPLOYEE_PII_REVEAL_OP } from "../src/modules/employee/pii-reveal.js";
import { seedHrmsCoreFixtures } from "./fixtures/core-seed.js";

registerEmployeePiiRevealConsumer(queue);
async function drain(): Promise<void> { await (queue as unknown as MemoryQueue).drain(); }

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000f0502";
const DEPT = "eeeeeeee-0001-0000-0000-000000000001";
const DESIG = "eeeeeeee-0001-0000-0000-000000000003";
const CT = { "content-type": "application/json" };
const U = { admin: "aaaaaaaa-f502-4000-8000-000000000001", officer: "aaaaaaaa-f502-4000-8000-000000000002", employee: "aaaaaaaa-f502-4000-8000-000000000003", other: "aaaaaaaa-f502-4000-8000-000000000004" };
const as = (sub: string, roles: string[], tid = TENANT) => ({ authorization: `Bearer ${signToken({ sub, tid, roles, sid: "s" }, SECRET)}` });

const EMP_ID = randomUUID();
const PAN = "ABCDE1234F";
const MOBILE = "9876543210";
const ACCOUNT = "123456789012";
const IFSC = "SBIN0001234";

let app: FastifyInstance;
let db: postgres.Sql;
async function asTenant<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return db.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${TENANT}', true)`);
    return fn(tx);
  });
}
async function audits(): Promise<Array<Record<string, any>>> {
  const rows = await asTenant((tx) => tx`
    select payload, actor_id from _outbox.messages
    where topic = 'audit.event.record' and payload->>'action' = 'employee_pii_revealed' and payload->>'resourceId' = ${EMP_ID}
    order by created_at`);
  return rows.map((r) => ({ ...(r.payload as Record<string, unknown>), _actor: r.actor_id }));
}
const reveal = (headers: Record<string, string>, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/hrms/pii/reveal", headers: { ...headers, ...CT }, payload });
const body = (field: string, reason = "verify payroll bank details") => ({ resourceType: "employee", resourceId: EMP_ID, field, reason });

beforeAll(async () => {
  await seedHrmsCoreFixtures();
  db = postgres(process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms", { max: 5 });
  await asTenant((tx) => tx`
    insert into employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining,
      employee_type, status, basic_minor, currency, pan, mobile, bank_account_no, bank_ifsc, created_at, updated_at, created_by, updated_by, version)
    values (${EMP_ID}, ${TENANT}, ${"PII-" + EMP_ID.slice(0, 8)}, 'Reveal Subject', ${DEPT}, ${DESIG}, '2015-06-01',
      'permanent', 'confirmed', 9000000, 'INR', ${encryptPii(PAN)}, ${encryptPii(MOBILE)}, ${encryptPii(ACCOUNT)}, ${encryptPii(IFSC)},
      now(), now(), ${U.admin}, ${U.admin}, 1)`);
  app = await buildApp();
});
afterAll(async () => {
  await asTenant((tx) => tx`delete from employee.hrms_employees where id = ${EMP_ID}`);
  await app.close();
  await db.end({ timeout: 5 });
  await sqlClient.end();
});

describe("employee PII reveal (audited)", () => {
  it("the column is ciphertext at rest, the read API masks it, and hr_admin's reveal returns the clear value with exactly one audit row", async () => {
    const [raw] = await asTenant((tx) => tx`select pan from employee.hrms_employees where id = ${EMP_ID}`);
    expect(String(raw!.pan)).toMatch(/^enc:v/);
    const read = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP_ID}`, headers: as(U.admin, ["hr_admin"]) });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.body).not.toContain(PAN);
    expect((read.json().data ?? read.json()).pan).toBe("******234F");

    expect(await audits()).toHaveLength(0);
    const res = await reveal(as(U.admin, ["hr_admin"]), body("pan", "verify PAN against Form 16 before filing"));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toMatchObject({ resourceType: "employee", resourceId: EMP_ID, field: "pan", value: PAN });
    expect(res.headers["cache-control"]).toBe("no-store");
    await drain();

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ service: "hrms", action: "employee_pii_revealed", resourceType: "employee", resourceId: EMP_ID, field: "pan", reason: "verify PAN against Form 16 before filing", outcome: "success", _actor: U.admin });
    expect(JSON.stringify(rows[0])).not.toContain(PAN);
  });

  it("reveals bank account, IFSC and phone for hr_admin, one audit row each, none containing a value", async () => {
    const before = (await audits()).length;
    for (const [field, value] of [["bankAccountNo", ACCOUNT], ["bankIfsc", IFSC], ["phone", MOBILE]] as const) {
      const r = await reveal(as(U.admin, ["hr_admin"]), body(field));
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().data.value).toBe(value);
    }
    await drain();
    const rows = await audits();
    expect(rows.length - before).toBe(3);
    for (const v of [ACCOUNT, IFSC, MOBILE]) expect(JSON.stringify(rows)).not.toContain(v);
  });

  it("a reason is required (>= 10 chars): 400, no value, no audit row", async () => {
    const before = (await audits()).length;
    for (const reason of ["", "short", "         "]) {
      const r = await reveal(as(U.admin, ["hr_admin"]), body("pan", reason));
      expect(r.statusCode).toBe(400);
      expect(r.body).not.toContain(PAN);
    }
    const missing = await reveal(as(U.admin, ["hr_admin"]), { resourceType: "employee", resourceId: EMP_ID, field: "pan" });
    expect(missing.statusCode).toBe(400);
    await drain();
    expect((await audits()).length).toBe(before);
  });

  it("forbidden roles get 403, no value, and no audit row: employee, manager, hr_officer for PAN/bank", async () => {
    const before = (await audits()).length;
    const cases: Array<[string, string[], string]> = [
      ["employee", ["employee"], "pan"], ["employee", ["employee"], "phone"],
      ["manager", ["manager"], "bankAccountNo"], ["officer", ["hr_officer"], "pan"], ["officer", ["hr_officer"], "bankIfsc"], ["officer", ["hr_officer"], "aadhaarRef"],
    ];
    for (const [who, roles, field] of cases) {
      const sub = who === "employee" ? U.employee : who === "officer" ? U.officer : U.other;
      const r = await reveal(as(sub, roles), body(field));
      expect(r.statusCode, `${roles}:${field}`).toBe(403);
      expect(r.body).not.toContain(PAN);
      expect(r.body).not.toContain(ACCOUNT);
    }
    await drain();
    expect((await audits()).length).toBe(before);
  });

  it("hr_officer may reveal the phone (audited); an unknown field is 422 and never a column lookup", async () => {
    const before = (await audits()).length;
    const ok = await reveal(as(U.officer, ["hr_officer"]), body("phone", "call about the transfer order"));
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.value).toBe(MOBILE);
    const bad = await reveal(as(U.admin, ["hr_admin"]), body("password_hash"));
    expect(bad.statusCode).toBe(422);
    const proto = await reveal(as(U.admin, ["hr_admin"]), body("constructor"));
    expect(proto.statusCode).toBe(422);
    await drain();
    const rows = await audits();
    expect(rows.length - before).toBe(1);
    expect(rows.at(-1)).toMatchObject({ field: "phone", _actor: U.officer });
  });

  it("is tenant-scoped: another tenant's HR admin gets 404 for this employee and no audit row appears", async () => {
    const before = (await audits()).length;
    const r = await reveal(as(U.other, ["hr_admin"], OTHER_TENANT), body("pan"));
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain(PAN);
    await drain();
    expect((await audits()).length).toBe(before);
  });

  it("redelivery of the same command messageId writes the audit row once (markProcessed in the same transaction)", async () => {
    const before = (await audits()).length;
    const messageId = randomUUID();
    const msg = {
      messageId, type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: U.admin, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { op: EMPLOYEE_PII_REVEAL_OP, id: randomUUID(), tenantId: TENANT, params: { id: EMP_ID }, query: {}, body: { action: "employee_pii_revealed", field: "pan", reason: "redelivery check one" } },
    };
    await queue.publish(COMMANDS.f3RouteWrite, msg);
    await drain();
    await queue.publish(COMMANDS.f3RouteWrite, msg);
    await drain();
    expect((await audits()).length - before).toBe(1);
  });
});
