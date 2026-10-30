/**
 * HRMS medical insurance — real DB, no mocks (migration 0254).
 *
 * Covers: table shape + ENABLE/FORCE RLS as the hrms_svc service role
 * (cross-tenant rows invisible, no-GUC reads empty, WITH CHECK rejects a
 * foreign tenant_id); HR upsert (202) -> consumer -> read round trip with the
 * card number, scheme id AND dependant names / dates of birth ENCRYPTED at
 * rest and on the command; masking per role (self in full; HR, finance and
 * manager masked; dependants relation-only for manager / finance); the
 * insurance write tier (finance_officer 403); bare-employee self-scope (IDOR);
 * 404 unknown employee; 400 bad bodies; idempotent replay; the audited HR
 * reveal (SF-05a pattern); audit events present and free of plaintext; no
 * plaintext name / DOB / card in the table, outbox or logs; decrypt failures
 * (card and per dependant) returned masked with a flag instead of a 500; delete.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
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
const HRO_SUB = "1a5e0254-0000-4000-8000-0000000000b5";
const UNKNOWN_EMP = "1a5e0254-0000-4000-8000-0000000000e9";

// Synthetic test identifiers (not real people / cards).
const CARD = "CGHS-TEST-77881234";
const CARD_2 = "CGHS-TEST-99005678";
const SCHEME_ID = "BEN-TEST-445566";
const DEP_NAME = "Zephyrine Testdependant";
const DEP_DOB = "1990-05-01";
const DEP_NAME_2 = "Quillon Testchild";
const mask = (v: string) => `${"*".repeat(v.length - 4)}${v.slice(-4)}`;

const headers = (roles: string[], sub: string, tid = TENANT) => ({
  authorization: `Bearer ${signToken({ sub, tid, roles, sid: "sess-med-ins" }, SECRET)}`,
  "content-type": "application/json",
});
const HR = headers(["hr_admin"], HR_SUB);
const HRO = headers(["hr_officer"], HRO_SUB);
const FIN = headers(["finance_officer"], FIN_SUB);
const MGR = headers(["manager"], M_SUB);
const EMP_SELF = headers(["employee"], R_SUB);
const HR_OTHER_TENANT = headers(["hr_admin"], HR_SUB, OTHER_TENANT);

const asTenant = <T>(t: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> => withRawTenantGuc(sqlClient, t, fn);

let app: Awaited<ReturnType<typeof buildApp>>;

// Everything the process writes to stdout/stderr (pino writes to fd 1 via
// sonic-boom's fs.writeSync / fs.write; the runner's console via process.stdout.write).
const captured: string[] = [];
const origWriteSync = fs.writeSync;
const origWrite = fs.write;
const origStdout = process.stdout.write.bind(process.stdout);
const origStderr = process.stderr.write.bind(process.stderr);

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER_TENANT]) {
    await asTenant(t, (tx) => tx`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.medical_insurance WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${t}`);
    await asTenant(t, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${t}`);
  }
}

async function outboxRows() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await withTenantScope(db, TENANT, async (tx: any) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  return rows as Array<{ actorId: string; payload: Record<string, unknown> }>;
}
const insuranceAudits = async () => (await outboxRows()).filter((r) => r.payload?.resourceType === "medical_insurance");

const storedRow = async (employeeId: string) =>
  (await asTenant(TENANT, (tx) => tx`
    SELECT id, card_number, scheme_id, scheme_type, tier, version, dependants, dependants::text AS dependants_text,
           annual_limit_minor::text AS limit
    FROM employee.medical_insurance WHERE tenant_id = ${TENANT} AND employee_id = ${employeeId}`))[0];

const put = (employeeId: string, body: unknown, h: Record<string, string> = HR) =>
  app.inject({ method: "PUT", url: `/v1/hrms/medical/insurance/${employeeId}`, headers: h, body: JSON.stringify(body) });
const del = (employeeId: string, h: Record<string, string> = HR) =>
  app.inject({ method: "DELETE", url: `/v1/hrms/medical/insurance/${employeeId}`, headers: h });
const get = (employeeId: string, h: Record<string, string>) =>
  app.inject({ method: "GET", url: `/v1/hrms/medical/insurance?employeeId=${employeeId}`, headers: h });
const reveal = (employeeId: string, field: string, h: Record<string, string> = HR, over: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST", url: `/v1/hrms/medical/insurance/${employeeId}/reveal`, headers: h,
    body: JSON.stringify({ resourceType: "medical_insurance", resourceId: employeeId, field, reason: "verifying card at hospital desk", ...over }),
  });

const fullBody = {
  schemeType: "cghs",
  schemeId: SCHEME_ID,
  cardNumber: CARD,
  validityFrom: "2026-04-01",
  validityTo: "2027-03-31",
  tier: "Ward entitlement: semi-private",
  dependants: [{ name: DEP_NAME, relation: "spouse", dateOfBirth: DEP_DOB }, { name: DEP_NAME_2, relation: "child" }],
  annualLimitMinor: 50000000,
};
const withoutCard = (b: Record<string, unknown>) => {
  const copy: Record<string, unknown> = { ...b };
  delete copy.cardNumber;
  return copy;
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

  (fs as unknown as { writeSync: (...a: unknown[]) => number }).writeSync = (...a: unknown[]) => {
    if (a[0] === 1 || a[0] === 2) captured.push(String(a[1]));
    return (origWriteSync as unknown as (...x: unknown[]) => number)(...a);
  };
  (fs as unknown as { write: (...a: unknown[]) => void }).write = (...a: unknown[]) => {
    if (a[0] === 1 || a[0] === 2) captured.push(String(a[1]));
    (origWrite as unknown as (...x: unknown[]) => void)(...a);
  };
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => { captured.push(String(chunk)); return (origStdout as (...x: unknown[]) => boolean)(chunk, ...rest); }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => { captured.push(String(chunk)); return (origStderr as (...x: unknown[]) => boolean)(chunk, ...rest); }) as typeof process.stderr.write;
});

afterAll(async () => {
  (fs as unknown as { writeSync: typeof origWriteSync }).writeSync = origWriteSync;
  (fs as unknown as { write: typeof origWrite }).write = origWrite;
  process.stdout.write = origStdout as typeof process.stdout.write;
  process.stderr.write = origStderr as typeof process.stderr.write;
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
  it("400 for bad bodies (unknown scheme, bad date, to < from, negative limit, bad relation, unknown field, masked card number)", async () => {
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
      expect(r.body).not.toContain("1234");
    }
  });

  it("400 CARD_NUMBER_REQUIRED when creating a record without a card number", async () => {
    const r = await put(EMP_R, withoutCard(fullBody));
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("CARD_NUMBER_REQUIRED");
  });

  it("404 for an employee that does not exist in the tenant (unknown id, or another tenant's employee)", async () => {
    expect((await put(UNKNOWN_EMP, fullBody)).statusCode).toBe(404);
    expect((await put(EMP_R, fullBody, HR_OTHER_TENANT)).statusCode).toBe(404);
    expect((await del(UNKNOWN_EMP)).statusCode).toBe(404);
  });

  it("only the insurance write tier may write: manager, employee AND finance_officer get 403", async () => {
    expect((await put(EMP_R, fullBody, MGR)).statusCode).toBe(403);
    expect((await put(EMP_R, fullBody, EMP_SELF)).statusCode).toBe(403);
    expect((await put(EMP_R, fullBody, FIN)).statusCode).toBe(403);
    expect((await del(EMP_R, MGR)).statusCode).toBe(403);
    expect((await del(EMP_R, FIN)).statusCode).toBe(403);
    await drain();
    expect(await storedRow(EMP_R)).toBeUndefined();
  });
});

describe("upsert -> read round trip, encryption at rest, masking, audit", () => {
  it("HR upsert is 202; card number, scheme id and dependant names / DOBs are stored ENCRYPTED, relation in clear", async () => {
    const r = await put(EMP_R, fullBody);
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await drain();
    const row = await storedRow(EMP_R);
    expect(row).toBeDefined();
    expect(r.json().id).toBe(row!.id);
    expect(row!.card_number).toMatch(/^enc:v2:/);
    expect(row!.scheme_id).toMatch(/^enc:v2:/);
    expect(row!.version).toBe(1);
    expect(row!.limit).toBe("50000000");
    const deps = row!.dependants as Array<Record<string, string>>;
    expect(deps.map((d) => d.relation)).toEqual(["spouse", "child"]);
    expect(deps[0]!.name).toMatch(/^enc:v2:/);
    expect(deps[0]!.dateOfBirth).toMatch(/^enc:v2:/);
    expect(deps[1]!.name).toMatch(/^enc:v2:/);
    for (const plain of [CARD, "77881234", SCHEME_ID, DEP_NAME, "Zephyrine", DEP_NAME_2, DEP_DOB]) {
      expect(JSON.stringify(row)).not.toContain(plain);
    }
  });

  it("the employee themself reads their own record in full (card, scheme id, dependants)", async () => {
    const r = await get(EMP_R, EMP_SELF);
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.card_number).toBe(CARD);
    expect(d.scheme_id).toBe(SCHEME_ID);
    expect(d.card_number_masked).toBe(false);
    expect(d.dependants).toEqual([
      { relation: "spouse", name: DEP_NAME, dateOfBirth: DEP_DOB },
      { relation: "child", name: DEP_NAME_2, dateOfBirth: null },
    ]);
  });

  it("HR (hr_admin, hr_officer) gets card number and scheme id MASKED by default, dependants decrypted", async () => {
    for (const h of [HR, HRO]) {
      const r = await get(EMP_R, h);
      expect(r.statusCode).toBe(200);
      const d = r.json().data;
      expect(d.card_number).toBe(mask(CARD));
      expect(d.scheme_id).toBe(mask(SCHEME_ID));
      expect(d.card_number_masked).toBe(true);
      expect(d.decrypt_failed).toBe(false);
      expect(d.validity_from).toBe("2026-04-01");
      expect(d.annual_limit_minor).toBe("50000000");
      expect(d.dependants[0]).toEqual({ relation: "spouse", name: DEP_NAME, dateOfBirth: DEP_DOB });
      expect(r.body).not.toContain("77881234");
    }
  });

  it("finance_officer can still read, but only masked values and relation-only dependants", async () => {
    const r = await get(EMP_R, FIN);
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.card_number).toBe(mask(CARD));
    expect(d.dependants).toEqual([{ relation: "spouse" }, { relation: "child" }]);
    expect(d.dependants_count).toBe(2);
    expect(r.body).not.toContain(DEP_NAME);
  });

  it("a manager reading a direct report sees last 4 only and relation-only dependants", async () => {
    const r = await get(EMP_R, MGR);
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.card_number).toBe(mask(CARD));
    expect(d.scheme_id).toBe(mask(SCHEME_ID));
    expect(d.card_number_masked).toBe(true);
    expect(d.dependants).toEqual([{ relation: "spouse" }, { relation: "child" }]);
    expect(r.body).not.toContain(DEP_NAME);
    expect(r.body).not.toContain("77881234");
  });

  it("a manager asking for a non-report is 403; reading their own record is in full", async () => {
    expect((await get(EMP_O, MGR)).statusCode).toBe(403);
    await put(EMP_M, { ...fullBody, cardNumber: CARD_2, schemeId: null, dependants: [] });
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

  it("the write is audited, and no audit payload carries the card number, scheme id or dependant PII", async () => {
    const audits = await insuranceAudits();
    const forR = audits.filter((a) => (a.payload.metadata as Record<string, unknown>)?.employeeId === EMP_R);
    expect(forR.length).toBeGreaterThanOrEqual(1);
    expect(forR[0]!.actorId).toBe(HR_SUB);
    expect(forR[0]!.payload.action).toBe("create");
    expect((forR[0]!.payload.metadata as Record<string, unknown>).cardNumberChanged).toBe(true);
    expect((forR[0]!.payload.metadata as Record<string, unknown>).dependantsCount).toBe(2);
    const all = JSON.stringify(audits);
    for (const secret of [CARD, CARD_2, SCHEME_ID, "77881234", "99005678", "445566", "enc:v", DEP_NAME, DEP_NAME_2, DEP_DOB]) {
      expect(all).not.toContain(secret);
    }
  });

  it("an update without cardNumber keeps the stored one, bumps version; schemeId null clears it", async () => {
    const r = await put(EMP_R, { ...withoutCard(fullBody), schemeType: "group_mediclaim", tier: null, schemeId: null });
    expect(r.statusCode).toBe(202);
    await drain();
    const row = await storedRow(EMP_R);
    expect(row!.version).toBe(2);
    expect(row!.scheme_type).toBe("group_mediclaim");
    expect(row!.scheme_id).toBeNull();
    const d = (await get(EMP_R, EMP_SELF)).json().data;
    expect(d.card_number).toBe(CARD);
    expect(d.tier).toBeNull();
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
        schemeId: { action: "keep" }, validityFrom: "2026-04-01", validityTo: null, tier: null,
        dependants: before!.dependants, annualLimitMinor: null,
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

describe("audited reveal — POST /v1/hrms/medical/insurance/:employeeId/reveal (SF-05a pattern)", () => {
  it("hr_admin gets the clear card number (no-store) and an audit row with who / whom / field / reason, never the value", async () => {
    await drain();
    const before = (await outboxRows()).filter((r) => r.payload?.action === "medical_insurance_pii_revealed").length;
    const r = await reveal(EMP_R, "cardNumber");
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.json().data).toEqual({ resourceType: "medical_insurance", resourceId: EMP_R, field: "cardNumber", value: CARD });
    await drain();
    const audits = (await outboxRows()).filter((x) => x.payload?.action === "medical_insurance_pii_revealed");
    expect(audits).toHaveLength(before + 1);
    const a = audits[audits.length - 1]!;
    expect(a.actorId).toBe(HR_SUB);
    expect(a.payload).toMatchObject({
      resourceType: "medical_insurance", resourceId: EMP_R, field: "cardNumber",
      reason: "verifying card at hospital desk", subject: EMP_R,
    });
    expect(JSON.stringify(audits)).not.toContain("77881234");
  });

  it("super_admin may reveal; scheme id reveal returns null once cleared", async () => {
    const r = await reveal(EMP_R, "schemeId", headers(["super_admin"], HR_SUB));
    expect(r.statusCode).toBe(200);
    expect(r.json().data.value).toBeNull();
  });

  it("hr_officer, finance_officer, manager and the employee themself are 403 (and nothing is audited)", async () => {
    await drain();
    const before = (await outboxRows()).filter((x) => x.payload?.action === "medical_insurance_pii_revealed").length;
    for (const h of [HRO, FIN, MGR, EMP_SELF]) {
      expect((await reveal(EMP_R, "cardNumber", h)).statusCode).toBe(403);
    }
    await drain();
    expect((await outboxRows()).filter((x) => x.payload?.action === "medical_insurance_pii_revealed")).toHaveLength(before);
  });

  it("cross-tenant 404; unknown field 422; short reason 400; resourceId mismatch 400; no record 404", async () => {
    expect((await reveal(EMP_R, "cardNumber", HR_OTHER_TENANT)).statusCode).toBe(404);
    expect((await reveal(EMP_R, "tier")).statusCode).toBe(422);
    expect((await reveal(EMP_R, "cardNumber", HR, { reason: "short" })).statusCode).toBe(400);
    expect((await reveal(EMP_R, "cardNumber", HR, { resourceId: EMP_M })).statusCode).toBe(400);
    expect((await reveal(EMP_O, "cardNumber")).statusCode).toBe(404);
  });
});

describe("no plaintext dependant PII / card number in table, outbox or logs", () => {
  it("across write, read and reveal, the table, every outbox row and every log line are free of names, DOBs and card numbers", async () => {
    await drain();
    const tableText = JSON.stringify(await asTenant(TENANT, (tx) => tx`SELECT * FROM employee.medical_insurance WHERE tenant_id = ${TENANT}`));
    const outboxText = JSON.stringify(await outboxRows());
    // The capture really saw this process's logs (request lines are logged).
    const logs = captured.join("");
    expect(logs).toContain("/v1/hrms/medical/insurance");
    for (const plain of [DEP_NAME, "Zephyrine", DEP_NAME_2, "Quillon", DEP_DOB, CARD, "77881234", CARD_2, SCHEME_ID]) {
      expect(tableText, `table: ${plain}`).not.toContain(plain);
      expect(outboxText, `outbox: ${plain}`).not.toContain(plain);
      expect(logs, `logs: ${plain}`).not.toContain(plain);
    }
  });
});

describe("decrypt failure and delete", () => {
  it("a dependant whose ciphertext cannot be decrypted is masked with a flag (200), the rest still decrypt", async () => {
    await asTenant(TENANT, (tx) => tx`
      UPDATE employee.medical_insurance
      SET dependants = jsonb_set(dependants, '{0,name}', '"enc:v2:k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"')
      WHERE tenant_id = ${TENANT} AND employee_id = ${EMP_R}`);
    for (const h of [HR, EMP_SELF]) {
      const r = await get(EMP_R, h);
      expect(r.statusCode).toBe(200);
      const d = r.json().data;
      expect(d.decrypt_failed).toBe(true);
      expect(d.dependants[0]).toEqual({ relation: "spouse", name: null, dateOfBirth: null, decrypt_failed: true });
      expect(d.dependants[1]).toEqual({ relation: "child", name: DEP_NAME_2, dateOfBirth: null });
      expect(r.body).not.toContain("enc:v2");
    }
    // A manager never decrypts dependants, so the relation-only view is unaffected.
    expect((await get(EMP_R, MGR)).json().data.dependants).toEqual([{ relation: "spouse" }, { relation: "child" }]);
  });

  it("a card number that cannot be decrypted is returned masked with a flag (not a 500), and cannot be revealed", async () => {
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
    const rv = await reveal(EMP_R, "cardNumber");
    expect(rv.statusCode).toBe(422);
    expect(rv.json().code).toBe("PII_DECRYPT_FAILED");
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
