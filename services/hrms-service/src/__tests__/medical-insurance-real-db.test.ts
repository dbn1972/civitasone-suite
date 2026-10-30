/**
 * HRMS medical insurance — real DB, no mocks (migration 0254).
 *
 * Covers: table shape + ENABLE/FORCE RLS as the hrms_svc service role
 * (cross-tenant rows invisible, no-GUC reads empty, WITH CHECK rejects a
 * foreign tenant_id); HR upsert (202) -> consumer -> read round trip with the
 * card number / scheme id ENCRYPTED at rest; masking per role; bare-employee
 * self-scope (IDOR); 404 unknown employee; 400 bad bodies; HR-only writes;
 * idempotent replay; audit event present and free of plaintext; a row that
 * fails to decrypt is returned masked with a flag instead of a 500; delete.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc, withTenantScope } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { registerMedicalConsumers } from "../modules/medical/consumer.js";
import { COMMANDS } from "../topics.js";

registerMedicalConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as { drain: () => Promise<void> }).drain();

const SECRET = String(process.env.JWT_SECRET);
const TENANT       = "1a5e0254-0000-4000-8000-0000000000a1";
const OTHER_TENANT = "1a5e0254-0000-4000-8000-0000000000a2";
const SEED_ACTOR   = "1a5e0254-0000-4000-8000-0000000000ff";
const DEPT_ID      = "1a5e0254-0000-4000-8000-0000000000d1";
const DESIG_ID     = "1a5e0254-0000-4000-8000-0000000000d2";
const EMP_M = "1a5e0254-0000-4000-8000-0000000000e1"; const M_SUB = "1a5e0254-0000-4000-8000-0000000000b1";
const EMP_R = "1a5e0254-0000-4000-8000-0000000000e2"; const R_SUB = "1a5e0254-0000-4000-8000-0000000000b2";
const EMP_O = "1a5e0254-0000-4000-8000-0000000000e3";
const HR_SUB = "1a5e0254-0000-4000-8000-0000000000b3";
const FIN_SUB = "1a5e0254-0000-4000-8000-0000000000b4";
const UNKNOWN_EMP = "1a5e0254-0000-4000-8000-0000000000e9";

// Synthetic test identifiers (not real cards).
const CARD = "CGHS-TEST-77881234";
const CARD_2 = "CGHS-TEST-99005678";
const SCHEME_ID = "BEN-TEST-445566";

const headers = (roles: string[], sub: string, tid = TENANT) => ({
  authorization: `Bearer ${signToken({ sub, tid, roles, sid: "sess-med-ins" }, SECRET)}`,
  "content-type": "application/json",
});
const HR = headers(["hr_admin"], HR_SUB);
const FIN = headers(["finance_officer"], FIN_SUB);
const MGR = headers(["manager"], M_SUB);
const EMP_SELF = headers(["employee"], R_SUB);
const HR_OTHER_TENANT = headers(["hr_admin"], HR_SUB, OTHER_TENANT);

const asTenant = <T>(t: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, t, fn);

let app: Awaited<ReturnType<typeof buildApp>>;

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER_TENANT]) {
    await asTenant(t, (tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.medical_insurance WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${t}`);
  }
}

async function insuranceAudits() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, async (tx: any) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return (rows as Array<{ actorId: string; payload: Record<string, unknown> }>)
    .filter((r) => r.payload?.resourceType === "medical_insurance");
}

const storedRow = async (employeeId: string) =>
  (await asTenant(TENANT, (tx) => tx`
    SELECT id, card_number, scheme_id, scheme_type, tier, version, dependants, annual_limit_minor::text AS limit
    FROM employee.medical_insurance WHERE tenant_id = ${TENANT} AND employee_id = ${employeeId}`))[0];

const put = (employeeId: string, body: unknown, h: Record<string, string> = HR) =>
  app.inject({ method: "PUT", url: `/v1/hrms/medical/insurance/${employeeId}`, headers: h, body: JSON.stringify(body) });
const del = (employeeId: string, h: Record<string, string> = HR) =>
  app.inject({ method: "DELETE", url: `/v1/hrms/medical/insurance/${employeeId}`, headers: h });
const get = (employeeId: string, h: Record<string, string>) =>
  app.inject({ method: "GET", url: `/v1/hrms/medical/insurance?employeeId=${employeeId}`, headers: h });

const fullBody = {
  schemeType: "cghs",
  schemeId: SCHEME_ID,
  cardNumber: CARD,
  validityFrom: "2026-04-01",
  validityTo: "2027-03-31",
  tier: "Ward entitlement: semi-private",
  dependants: [{ name: "Test Spouse", relation: "spouse", dateOfBirth: "1990-05-01" }, { name: "Test Child", relation: "child" }],
  annualLimitMinor: 50000000,
};

beforeAll(async () => {
  await cleanup();
  await asTenant(TENANT, (tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'MEDINS', 'Med Ins Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await asTenant(TENANT, (tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'MEDINS', 'Med Ins Desig', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  for (const [id, no, name, sub, mgr] of [
    [EMP_M, "MI-M", "Med Ins Manager", M_SUB, null],
    [EMP_R, "MI-R", "Med Ins Report", R_SUB, EMP_M],
    [EMP_O, "MI-O", "Med Ins Other", null, null],
  ] as const) {
    await asTenant(TENANT, (tx) => tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, manager_id, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${name}, ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${sub}, ${mgr}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  }
  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("migration 0254 — table, constraints, RLS as hrms_svc", () => {
  it("runs as the hrms_svc service role, and the table has ENABLE + FORCE row level security", async () => {
    const [who] = await sqlClient`SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass`;
    expect(who).toEqual({ u: "hrms_svc", bypass: false });
    const [r] = await sqlClient`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'employee.medical_insurance'::regclass`;
    expect(r).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const idx = await sqlClient`SELECT indexdef FROM pg_indexes WHERE schemaname = 'employee' AND indexname = 'medical_insurance_tenant_employee_uniq'`;
    expect(idx[0]!.indexdef).toMatch(/UNIQUE INDEX .*\(tenant_id, employee_id\)/);
  });

  it("CHECK constraints reject a bad scheme type, validity_from > validity_to and a negative limit", async () => {
    const ins = (over: { scheme?: string; from?: string; to?: string; limit?: number }) => asTenant(TENANT, (tx) => tx`
      INSERT INTO employee.medical_insurance
        (id, tenant_id, employee_id, scheme_type, card_number, validity_from, validity_to, annual_limit_minor, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, ${EMP_O}, ${over.scheme ?? "cghs"}, 'enc:v2:k1:x',
              ${over.from ?? "2026-01-01"}, ${over.to ?? "2026-12-31"}, ${over.limit ?? 0}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
    await expect(ins({ scheme: "platinum" })).rejects.toThrow(/medical_insurance_scheme_type_check/);
    await expect(ins({ from: "2027-01-01", to: "2026-01-01" })).rejects.toThrow(/medical_insurance_validity_check/);
    await expect(ins({ limit: -1 })).rejects.toThrow(/medical_insurance_annual_limit_check/);
  });

  it("a row is invisible to another tenant and to a session with no tenant GUC; WITH CHECK rejects a foreign tenant_id", async () => {
    const id = randomUUID();
    await asTenant(TENANT, (tx) => tx`
      INSERT INTO employee.medical_insurance (id, tenant_id, employee_id, scheme_type, card_number, validity_from, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${EMP_O}, 'esic', 'enc:v2:k1:x', '2026-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})`);
    expect(await asTenant(TENANT, (tx) => tx`SELECT 1 FROM employee.medical_insurance WHERE id = ${id}`)).toHaveLength(1);
    expect(await asTenant(OTHER_TENANT, (tx) => tx`SELECT 1 FROM employee.medical_insurance WHERE id = ${id}`)).toHaveLength(0);
    expect(await sqlClient`SELECT 1 FROM employee.medical_insurance WHERE id = ${id}`).toHaveLength(0);
    await expect(asTenant(OTHER_TENANT, (tx) => tx`
      INSERT INTO employee.medical_insurance (id, tenant_id, employee_id, scheme_type, card_number, validity_from, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, ${EMP_O}, 'esic', 'enc:v2:k1:x', '2026-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})`))
      .rejects.toThrow(/row-level security/);
    await asTenant(TENANT, (tx) => tx`DELETE FROM employee.medical_insurance WHERE id = ${id}`);
  });
});

describe("PUT /v1/hrms/medical/insurance/:employeeId — validation and access", () => {
  it("400 for bad bodies (unknown scheme, bad date, to < from, negative limit, unknown field, masked card number)", async () => {
    for (const bad of [
      { ...fullBody, schemeType: "platinum" },
      { ...fullBody, validityFrom: "2026-02-30" },
      { ...fullBody, validityFrom: "2027-01-01", validityTo: "2026-01-01" },
      { ...fullBody, annualLimitMinor: -5 },
      { ...fullBody, dependants: [{ name: "X", relation: "cousin" }] },
      { ...fullBody, surprise: true },
      { ...fullBody, cardNumber: "**************1234" },
    ]) {
      const r = await put(EMP_R, bad);
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe("VALIDATION_FAILED");
      // The rejected value is never echoed back.
      expect(r.body).not.toContain("1234");
    }
  });

  it("400 CARD_NUMBER_REQUIRED when creating a record without a card number", async () => {
    const noCard: Record<string, unknown> = { ...fullBody };
    delete noCard.cardNumber;
    const r = await put(EMP_R, noCard);
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("CARD_NUMBER_REQUIRED");
  });

  it("404 for an employee that does not exist in the tenant (unknown id, or another tenant's employee)", async () => {
    expect((await put(UNKNOWN_EMP, fullBody)).statusCode).toBe(404);
    expect((await put(EMP_R, fullBody, HR_OTHER_TENANT)).statusCode).toBe(404);
    expect((await del(UNKNOWN_EMP)).statusCode).toBe(404);
  });

  it("only HR roles may write: manager and employee get 403", async () => {
    expect((await put(EMP_R, fullBody, MGR)).statusCode).toBe(403);
    expect((await put(EMP_R, fullBody, EMP_SELF)).statusCode).toBe(403);
    expect((await del(EMP_R, MGR)).statusCode).toBe(403);
    await drain();
    expect(await storedRow(EMP_R)).toBeUndefined();
  });
});

describe("upsert -> read round trip, encryption at rest, masking, audit", () => {
  it("HR upsert is 202; the consumer stores card number and scheme id ENCRYPTED", async () => {
    const r = await put(EMP_R, fullBody);
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await drain();
    const row = await storedRow(EMP_R);
    expect(row).toBeDefined();
    expect(r.json().id).toBe(row!.id);
    expect(row!.card_number).toMatch(/^enc:v2:/);
    expect(row!.scheme_id).toMatch(/^enc:v2:/);
    expect(row!.card_number).not.toContain("77881234");
    expect(row!.scheme_id).not.toContain("445566");
    expect(row!.scheme_type).toBe("cghs");
    expect(row!.limit).toBe("50000000");
    expect(row!.version).toBe(1);
  });

  it("HR and finance_officer read the full card number", async () => {
    for (const h of [HR, FIN]) {
      const r = await get(EMP_R, h);
      expect(r.statusCode).toBe(200);
      const d = r.json().data;
      expect(d.card_number).toBe(CARD);
      expect(d.scheme_id).toBe(SCHEME_ID);
      expect(d.card_number_masked).toBe(false);
      expect(d.decrypt_failed).toBe(false);
      expect(d.validity_from).toBe("2026-04-01");
      expect(d.validity_to).toBe("2027-03-31");
      expect(d.annual_limit_minor).toBe("50000000");
      expect(d.dependants).toEqual(fullBody.dependants);
      expect(d.dependants_count).toBe(2);
    }
  });

  it("the employee themself reads the full card number", async () => {
    const r = await get(EMP_R, EMP_SELF);
    expect(r.statusCode).toBe(200);
    expect(r.json().data.card_number).toBe(CARD);
    expect(r.json().data.card_number_masked).toBe(false);
  });

  it("a manager reading a direct report sees only the last 4 (and dependants without names)", async () => {
    const r = await get(EMP_R, MGR);
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.card_number).toBe(`${"*".repeat(CARD.length - 4)}1234`);
    expect(d.scheme_id).toBe(`${"*".repeat(SCHEME_ID.length - 4)}5566`);
    expect(d.card_number_masked).toBe(true);
    expect(d.dependants).toEqual([{ relation: "spouse" }, { relation: "child" }]);
    expect(d.dependants_count).toBe(2);
    expect(r.body).not.toContain("Test Spouse");
    expect(r.body).not.toContain("77881234");
  });

  it("a manager asking for a non-report is 403; reading their own record is unmasked", async () => {
    expect((await get(EMP_O, MGR)).statusCode).toBe(403);
    await put(EMP_M, { ...fullBody, cardNumber: CARD_2, schemeId: null });
    await drain();
    const own = await get(EMP_M, MGR);
    expect(own.statusCode).toBe(200);
    expect(own.json().data.card_number).toBe(CARD_2);
    expect(own.json().data.scheme_id).toBeNull();
  });

  it("IDOR: a bare employee asking for someone else's record gets their own", async () => {
    const r = await get(EMP_M, EMP_SELF);
    expect(r.statusCode).toBe(200);
    expect(r.json().data.employee_id).toBe(EMP_R);
    expect(r.json().data.card_number).toBe(CARD);
  });

  it("another tenant's HR cannot read it (404)", async () => {
    expect((await get(EMP_R, HR_OTHER_TENANT)).statusCode).toBe(404);
  });

  it("the write is audited, and no audit payload carries the card number or scheme id in any form", async () => {
    const audits = await insuranceAudits();
    const forR = audits.filter((a) => (a.payload.metadata as Record<string, unknown>)?.employeeId === EMP_R);
    expect(forR.length).toBeGreaterThanOrEqual(1);
    expect(forR[0]!.actorId).toBe(HR_SUB);
    expect(forR[0]!.payload.action).toBe("create");
    expect((forR[0]!.payload.metadata as Record<string, unknown>).cardNumberChanged).toBe(true);
    const all = JSON.stringify(audits);
    for (const secret of [CARD, CARD_2, SCHEME_ID, "77881234", "99005678", "445566", "enc:v"]) {
      expect(all).not.toContain(secret);
    }
  });

  it("an update without cardNumber keeps the stored one, bumps version; schemeId null clears it", async () => {
    const noCard: Record<string, unknown> = { ...fullBody };
    delete noCard.cardNumber;
    const r = await put(EMP_R, { ...noCard, schemeType: "group_mediclaim", tier: null, schemeId: null, dependants: [] });
    expect(r.statusCode).toBe(202);
    await drain();
    const row = await storedRow(EMP_R);
    expect(row!.version).toBe(2);
    expect(row!.scheme_type).toBe("group_mediclaim");
    expect(row!.scheme_id).toBeNull();
    const d = (await get(EMP_R, HR)).json().data;
    expect(d.card_number).toBe(CARD);
    expect(d.tier).toBeNull();
    expect(d.dependants).toEqual([]);
    const last = (await insuranceAudits()).filter((a) => a.payload.action === "update").pop();
    expect((last!.payload.metadata as Record<string, unknown>).cardNumberChanged).toBe(false);
  });

  it("a replayed command (same messageId) is a no-op", async () => {
    const before = await storedRow(EMP_R);
    const cmd = {
      messageId: randomUUID(), type: COMMANDS.medicalInsuranceUpsert, tenantId: TENANT, actorId: HR_SUB,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: before!.id, tenantId: TENANT, employeeId: EMP_R, schemeType: "esic", cardNumberEnc: null,
        schemeId: { action: "keep" }, validityFrom: "2026-04-01", validityTo: null, tier: null, dependants: [], annualLimitMinor: null,
      },
    };
    await queue.publish(COMMANDS.medicalInsuranceUpsert, cmd);
    await queue.publish(COMMANDS.medicalInsuranceUpsert, cmd);
    await drain();
    const after = await storedRow(EMP_R);
    expect(after!.version).toBe(before!.version + 1);
    expect(after!.scheme_type).toBe("esic");
  });
});

describe("decrypt failure and delete", () => {
  it("a row whose ciphertext cannot be decrypted is returned masked with a flag, not a 500", async () => {
    await asTenant(TENANT, (tx) => tx`
      UPDATE employee.medical_insurance SET card_number = 'enc:v2:k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      WHERE tenant_id = ${TENANT} AND employee_id = ${EMP_R}`);
    for (const h of [HR, EMP_SELF, MGR]) {
      const r = await get(EMP_R, h);
      expect(r.statusCode).toBe(200);
      const d = r.json().data;
      expect(d.decrypt_failed).toBe(true);
      expect(d.card_number_masked).toBe(true);
      expect(d.card_number).toBeNull();
      expect(r.body).not.toContain("enc:v2");
    }
  });

  it("HR delete is 202, removes the record (then 404), and is audited", async () => {
    const r = await del(EMP_R);
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await storedRow(EMP_R)).toBeUndefined();
    expect((await get(EMP_R, HR)).statusCode).toBe(404);
    expect((await del(EMP_R)).statusCode).toBe(404);
    const deletes = (await insuranceAudits()).filter((a) => a.payload.action === "delete");
    expect(deletes).toHaveLength(1);
    expect((deletes[0]!.payload.metadata as Record<string, unknown>).employeeId).toBe(EMP_R);
  });
});
