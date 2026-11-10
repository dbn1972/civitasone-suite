/**
 * Section 8 G6 -- real database, end to end through the Fastify app and the in-memory queue (run as the
 * NOBYPASSRLS role hrms_svc with row-level security forced; seeds are written under runWithTenant):
 *
 *  - POST /v1/hrms/employees/bulk with PAN / bank account + IFSC / UAN (flag HRMS_S8_BULK_IMPORT_ENABLED):
 *    stored as "enc:v2:" envelopes (migration 0268 widened uan_number), readable back in clear through the column
 *    type, and the clear values appear NOWHERE in the outbox (audit events carry field NAMES only);
 *  - duplicates against employees already in the tenant are refused, the same value in another tenant is fine;
 *  - the UAN is masked on the detail read with HRMS_S8_UAN_MASK_ENABLED and revealable (audited) by HR / payroll only;
 *  - a 500-row batch end to end;
 *  - POST /v1/hrms/pay-profiles/bulk-request and bulk-decision (flag HRMS_S8_BULK_PAY_PROFILE_ENABLED): flag off is a
 *    404, dry run queues nothing, requests land PENDING, the requester cannot decide their own, a different user can,
 *    and an extra per-profile rule plugs in by data.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

const { lockedThroughMock } = vi.hoisted(() => ({ lockedThroughMock: vi.fn() }));
vi.mock("../src/shared/payroll-client.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  fetchPayrollLockedThrough: (...a: unknown[]) => lockedThroughMock(...a),
}));

import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerEmployeeConsumers } from "../src/modules/employee/consumer.js";
import { registerBulkImportConsumers } from "../src/modules/bulk-import/consumer.js";
import { registerPayProfileConsumers } from "../src/modules/pay-profile/consumer.js";
import { registerBulkProfileRule } from "../src/modules/pay-profile/bulk.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsPayProfiles } from "../src/modules/pay-profile/schema.js";
import { COMMANDS } from "../src/topics.js";
import { hrmsBulkImportBatches, hrmsBulkImportRows } from "../src/modules/bulk-import/schema.js";

registerEmployeeConsumers(queue);
registerBulkImportConsumers(queue);
registerPayProfileConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const deptId = randomUUID();
const desigId = randomUUID();
const hdr = (actor: string, roles: string[], tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid: tenant, roles, sid: "s" }, SECRET)}`,
  "content-type": "application/json",
});
const asTenant = <T>(tenant: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(tenant, () => db.transaction(fn));

let app: FastifyInstance;

const row = (employeeNo: string, over: Record<string, unknown> = {}) => ({
  employeeNo, fullName: `Imported ${employeeNo}`, departmentId: deptId, designationId: desigId,
  dateOfJoining: "2026-04-01", employeeType: "permanent", basicMinor: 4490050, ...over,
});
const bulk = (employees: unknown[], q = "", h = hdr(MAKER, ["hr_admin"])) =>
  app.inject({ method: "POST", url: `/v1/hrms/employees/bulk${q}`, headers: h, payload: { employees } });
const findByNo = async (no: string, tenant = TENANT) => (await asTenant(tenant, (tx) =>
  tx.select().from(hrmsEmployees).where(and(eq(hrmsEmployees.tenantId, tenant), eq(hrmsEmployees.employeeNo, no)))))[0];
const rawOf = async (id: string) => (await asTenant(TENANT, (tx) => tx.execute(sql`
  SELECT pan, bank_account_no, bank_ifsc, uan_number FROM employee.hrms_employees WHERE id = ${id}`)) as unknown as Array<Record<string, string | null>>)[0]!;
/** Every outbox payload of this tenant, as text. */
const outboxText = async () => (await asTenant(TENANT, (tx) => tx.execute(sql`
  SELECT payload::text AS t FROM _outbox.messages WHERE tenant_id = ${TENANT}`)) as unknown as Array<{ t: string }>).map((r) => r.t).join("\n");

const PAN1 = "BNZPK4821M", UAN1 = "101234567890", ACC1 = "31245678901", IFSC1 = "SBIN0001234";
const PAN2 = "AJWPR7732Q", UAN2 = "101234567891", ACC2 = "50100234567890", IFSC2 = "HDFC0000386";
const PAN3 = "CQRPS1145D", UAN3 = "101234567892", ACC3 = "917010012345678", IFSC3 = "UTIB0000129";

beforeAll(async () => {
  app = await buildApp();
  for (const t of [TENANT, OTHER_TENANT]) {
    await asTenant(t, async (tx) => {
      await tx.insert(hrmsDepartments).values({ id: t === TENANT ? deptId : randomUUID(), tenantId: t, code: `G${t.slice(0, 6)}`, name: "Programme Office", createdBy: MAKER, updatedBy: MAKER });
      if (t === TENANT) await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: t, code: `GD${t.slice(0, 6)}`, name: "Project Associate", createdBy: MAKER, updatedBy: MAKER });
    });
  }
});

beforeEach(() => {
  lockedThroughMock.mockReset();
  lockedThroughMock.mockResolvedValue(null);
  delete process.env.HRMS_S8_BULK_IMPORT_ENABLED;
  delete process.env.HRMS_S8_UAN_MASK_ENABLED;
  delete process.env.HRMS_S8_BULK_PAY_PROFILE_ENABLED;
});

afterAll(async () => {
  for (const t of [TENANT, OTHER_TENANT]) {
    await asTenant(t, async (tx) => {
      await tx.delete(hrmsPayProfiles).where(eq(hrmsPayProfiles.tenantId, t));
      await tx.delete(hrmsBulkImportRows).where(eq(hrmsBulkImportRows.tenantId, t));
      await tx.delete(hrmsBulkImportBatches).where(eq(hrmsBulkImportBatches.tenantId, t));
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, t));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, t));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, t));
    });
  }
  await app.close();
  await sqlClient.end();
});

describe("G6 bulk import of PAN / bank / UAN, end to end", () => {
  it("flag OFF: the columns are ignored, nothing sensitive is stored", async () => {
    const res = await bulk([row("DIC-OFF-1", { pan: PAN1, uanNumber: UAN1, bankAccountNo: ACC1, bankIfsc: IFSC1 })]);
    expect(res.statusCode).toBe(202);
    await drain();
    const e = (await rawOf((await findByNo("DIC-OFF-1"))!.id));
    expect(e).toMatchObject({ pan: null, bank_account_no: null, bank_ifsc: null, uan_number: null });
  });

  it("flag ON: stored as encrypted envelopes, readable back in clear, absent from the outbox", async () => {
    process.env.HRMS_S8_BULK_IMPORT_ENABLED = "true";
    const res = await bulk([
      row("DIC-001", { pan: PAN1, uanNumber: UAN1, bankAccountNo: ACC1, bankIfsc: IFSC1 }),
      row("DIC-002", { pan: PAN2, uanNumber: UAN2, bankAccountNo: ACC2, bankIfsc: IFSC2 }),
      row("DIC-003", { pan: PAN3, uanNumber: UAN3, bankAccountNo: ACC3, bankIfsc: IFSC3 }),
    ]);
    expect(res.statusCode).toBe(202);
    const batchId = res.json<{ id: string }>().id;
    await drain();

    const one = (await findByNo("DIC-001"))!;
    expect(one).toMatchObject({ pan: PAN1, uanNumber: UAN1, bankAccountNo: ACC1, bankIfsc: IFSC1 }); // decrypted by the column type
    const raw = await rawOf(one.id);
    for (const k of ["pan", "bank_account_no", "bank_ifsc", "uan_number"] as const) {
      expect(raw[k], k).toMatch(/^enc:v2:/);
    }
    for (const clear of [PAN1, UAN1, ACC1, IFSC1]) for (const k of Object.values(raw)) expect(k).not.toContain(clear);

    const status = await app.inject({ method: "GET", url: `/v1/hrms/employees/bulk/status/${batchId}`, headers: hdr(MAKER, ["hr_admin"]) });
    expect(status.json()).toMatchObject({ status: "completed", total: 3, created: 3, failed: 0 });

    // Audited, without values: the audit event names the sensitive columns; no clear value exists in any outbox row.
    const ob = await outboxText();
    expect(ob).toContain("bulk_import_requested");
    expect(ob).toContain('"sensitiveFields": ["pan", "uanNumber", "bankAccountNo", "bankIfsc"]');
    for (const clear of [PAN1, PAN2, PAN3, UAN1, UAN2, UAN3, ACC1, ACC2, ACC3]) expect(ob).not.toContain(clear);
  });

  it("refuses a PAN / UAN / account that another employee of the tenant already holds; another tenant's is unaffected", async () => {
    process.env.HRMS_S8_BULK_IMPORT_ENABLED = "true";
    const clash = await bulk([row("DIC-010", { pan: PAN1, uanNumber: "101234500001", bankAccountNo: ACC1, bankIfsc: IFSC1 })]);
    expect(clash.statusCode).toBe(400);
    const msgs = clash.json<{ fieldErrors: Array<{ field: string; message: string }> }>().fieldErrors;
    expect(msgs.map((m) => m.field)).toEqual(expect.arrayContaining(["employees.0.pan", "employees.0.bankAccountNo"]));
    expect(clash.body).not.toContain(PAN1);
    expect(await findByNo("DIC-010")).toBeUndefined();

    // The same PAN in a DIFFERENT tenant is not a duplicate (RLS + tenant filter).
    const other = await bulk([row("OTH-001", { pan: PAN1 })], "", hdr(MAKER, ["hr_admin"], OTHER_TENANT));
    expect(other.statusCode).toBe(202);
    await drain();
    expect((await findByNo("OTH-001", OTHER_TENANT))?.pan).toBe(PAN1);
  });

  it("dryRun reports the same errors and writes nothing", async () => {
    process.env.HRMS_S8_BULK_IMPORT_ENABLED = "true";
    const dryBad = await bulk([row("DIC-011", { pan: PAN2 })], "?dryRun=true");
    expect(dryBad.statusCode).toBe(400);
    const dryOk = await bulk([row("DIC-012", { pan: "DWKPT5521B" })], "?dryRun=true");
    expect(dryOk.statusCode).toBe(200);
    await drain();
    expect(await findByNo("DIC-011")).toBeUndefined();
    expect(await findByNo("DIC-012")).toBeUndefined();
  });

  it("UAN: clear by default (flag off), masked on the detail read with the mask flag, revealable by HR / payroll only", async () => {
    const id = (await findByNo("DIC-001"))!.id;
    const detail = () => app.inject({ method: "GET", url: `/v1/hrms/employees/${id}`, headers: hdr(MAKER, ["hr_admin"]) });
    expect((await detail()).json<{ uanNumber: string }>().uanNumber).toBe(UAN1);

    process.env.HRMS_S8_UAN_MASK_ENABLED = "true";
    const masked = (await detail()).json<{ uanNumber: string }>().uanNumber;
    expect(masked).toBe("********7890");

    const reveal = (roles: string[]) => app.inject({
      method: "POST", url: "/v1/hrms/pii/reveal", headers: hdr(MAKER, roles),
      payload: { resourceType: "employee", resourceId: id, field: "uanNumber", reason: "EPF ECR filing for the March wage month" },
    });
    expect((await reveal(["hr_admin"])).json<{ data: { value: string } }>().data.value).toBe(UAN1);
    expect((await reveal(["payroll_admin"])).statusCode).toBe(200);
    expect((await reveal(["manager"])).statusCode).toBe(403);
  });

  it("a 500-row batch with all four sensitive columns goes through end to end", async () => {
    process.env.HRMS_S8_BULK_IMPORT_ENABLED = "true";
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const rows = Array.from({ length: 500 }, (_, i) => row(`DIC-5${String(i).padStart(3, "0")}`, {
      pan: `DICPK${String(1000 + i)}${letters[i % letters.length]}`,
      uanNumber: `1020${String(10000000 + i)}`,
      bankAccountNo: `4010${String(1000000000 + i)}`,
      bankIfsc: "ICIC0000104",
    }));
    const res = await bulk(rows);
    expect(res.statusCode).toBe(202);
    await drain();
    const count = (await asTenant(TENANT, (tx) => tx.execute(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE pan LIKE 'enc:v2:%' AND uan_number LIKE 'enc:v2:%' AND bank_account_no LIKE 'enc:v2:%')::int AS sealed
      FROM employee.hrms_employees WHERE tenant_id = ${TENANT} AND employee_no LIKE 'DIC-5%'`)) as unknown as Array<{ n: number; sealed: number }>)[0]!;
    expect(count).toMatchObject({ n: 500, sealed: 500 });
  }, 120_000);
});

describe("G6 sealed payloads on the queue, legacy plaintext UAN", () => {
  it("the create command on the queue is sealed; a replay of it (DLQ redrive) after the fact still loads the employee", async () => {
    process.env.HRMS_S8_BULK_IMPORT_ENABLED = "true";
    const spy = vi.spyOn(queue, "publish");
    const res = await bulk([row("DIC-R01", { pan: "EKLPM3390H", uanNumber: "101234599001", bankAccountNo: "60234512345", bankIfsc: "KKBK0000958" })]);
    expect(res.statusCode).toBe(202);
    await drain();
    const sent = spy.mock.calls.filter((c) => c[0] === COMMANDS.employeeCreate).map((c) => c[1] as { messageId: string; payload: Record<string, string> });
    spy.mockRestore();
    expect(sent).toHaveLength(1);
    const wire = JSON.stringify(sent);
    for (const clear of ["EKLPM3390H", "101234599001", "60234512345", "KKBK0000958"]) expect(wire).not.toContain(clear);
    expect(sent[0]!.payload.pan).toMatch(/^enc:v2:/);

    // Remove the employee, then redeliver the SAME message (fresh messageId, as a DLQ redrive would).
    await asTenant(TENANT, (tx) => tx.delete(hrmsEmployees).where(and(eq(hrmsEmployees.tenantId, TENANT), eq(hrmsEmployees.employeeNo, "DIC-R01"))));
    await queue.publish(COMMANDS.employeeCreate, { ...sent[0]!, messageId: randomUUID(), type: COMMANDS.employeeCreate, tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0" } as never);
    await drain();
    expect(await findByNo("DIC-R01")).toMatchObject({ pan: "EKLPM3390H", uanNumber: "101234599001", bankAccountNo: "60234512345" });
  });

  it("a sealed value naming an unknown key id is refused with PII_KEY_UNKNOWN (not CREATE_FAILED)", async () => {
    process.env.HRMS_S8_BULK_IMPORT_ENABLED = "true";
    const orig = queue.publish.bind(queue);
    vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: never) => {
      const m = msg as { payload: { items?: Array<{ create: Record<string, unknown> }> } };
      if (topic === COMMANDS.employeeBulkImportRecord && m.payload.items) m.payload.items[0]!.create.pan = "enc:v2:retired9:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      return orig(topic, msg as never);
    });
    const res = await bulk([row("DIC-K01", { pan: "FHTPN6612J" })]);
    expect(res.statusCode).toBe(202);
    await drain();
    vi.restoreAllMocks();
    const status = await app.inject({ method: "GET", url: `/v1/hrms/employees/bulk/status/${res.json<{ id: string }>().id}`, headers: hdr(MAKER, ["hr_admin"]) });
    expect(status.json<{ failedRows: Array<{ code: string }> }>().failedRows[0]!.code).toBe("PII_KEY_UNKNOWN");
    expect(await findByNo("DIC-K01")).toBeUndefined();
  });

  it("a LEGACY plaintext uan_number still reads through the detail, the internal payroll projection and the reveal", async () => {
    const id = (await findByNo("DIC-002"))!.id;
    await asTenant(TENANT, (tx) => tx.execute(sql`UPDATE employee.hrms_employees SET uan_number = '100987654321' WHERE id = ${id}::uuid`));
    expect((await rawOf(id)).uan_number).toBe("100987654321");
    const detail = await app.inject({ method: "GET", url: `/v1/hrms/employees/${id}`, headers: hdr(MAKER, ["hr_admin"]) });
    expect(detail.json<{ uanNumber: string }>().uanNumber).toBe("100987654321");
    const feed = await app.inject({ method: "GET", url: "/v1/hrms/internal/payroll-input?month=2026-11", headers: hdr(MAKER, ["payroll_admin"]) });
    expect(feed.statusCode).toBe(200);
    const emp = feed.json<{ employees: Array<{ id: string; uan?: string }> }>().employees.find((e) => e.id === id);
    expect(emp?.uan).toBe("100987654321");
    const rev = await app.inject({ method: "POST", url: "/v1/hrms/pii/reveal", headers: hdr(MAKER, ["hr_admin"]),
      payload: { resourceType: "employee", resourceId: id, field: "uanNumber", reason: "Legacy plaintext row check for EPF ECR" } });
    expect(rev.json<{ data: { value: string } }>().data.value).toBe("100987654321");
  });
});

describe("G6 bulk pay-profile request / decision", () => {
  const bulkReq = (items: unknown[], q = "", h = hdr(MAKER, ["hr_admin"])) =>
    app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/bulk-request${q}`, headers: h, payload: { items } });
  const bulkDecide = (payload: unknown, h = hdr(CHECKER, ["hr_admin"]), q = "") =>
    app.inject({ method: "POST", url: `/v1/hrms/pay-profiles/bulk-decision${q}`, headers: h, payload: payload as object });
  const item = (employeeNo: string, over: Record<string, unknown> = {}) => ({
    employeeNo, payProfile: "consolidated_contract", effectiveFrom: "2027-01-01", consolidatedMonthlyMinor: "4500000", orderRef: "DIC/HR/2026/117", ...over,
  });
  const profilesOf = async () => asTenant(TENANT, (tx) => tx.select().from(hrmsPayProfiles).where(eq(hrmsPayProfiles.tenantId, TENANT)));
  const NOS = ["PP-001", "PP-002", "PP-003"];

  beforeAll(async () => {
    await asTenant(TENANT, async (tx) => {
      for (const no of NOS) {
        await tx.insert(hrmsEmployees).values({
          id: randomUUID(), tenantId: TENANT, employeeNo: no, fullName: `Contract ${no}`, departmentId: deptId, designationId: desigId,
          dateOfJoining: "2025-04-01", status: "confirmed", employeeType: "contractual", basicMinor: 4_000_000n, createdBy: MAKER, updatedBy: MAKER,
        });
      }
    });
  });

  it("flag OFF: both routes are 404", async () => {
    expect((await bulkReq([item("PP-001")])).statusCode).toBe(404);
    expect((await bulkDecide({ decision: "approve", profileIds: [randomUUID()] })).statusCode).toBe(404);
  });

  it("dry run reports row errors and queues nothing; a bad row blocks the whole request", async () => {
    process.env.HRMS_S8_BULK_PAY_PROFILE_ENABLED = "true";
    const ok = await bulkReq([item("PP-001"), item("PP-002")], "?dryRun=true");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ dryRun: true, ok: true, rowCount: 2 });

    const bad = await bulkReq([item("PP-001"), item("PP-002", { payProfile: "gold_plated" }), item("NOPE-9"),
      item("PP-003", { consolidatedMonthlyMinor: undefined }), item("PP-001")], "");
    expect(bad.statusCode).toBe(400);
    const fe = bad.json<{ fieldErrors: Array<{ field: string; message: string }> }>().fieldErrors;
    expect(fe).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "items.1.payProfile", message: expect.stringContaining("Unknown pay profile") }),
      expect.objectContaining({ field: "items.2.employeeNo", message: expect.stringContaining("Unknown employee") }),
      expect.objectContaining({ field: "items.3.payProfile", message: "CONSOLIDATED_AMOUNT_REQUIRED" }),
      expect.objectContaining({ field: "items.4.employeeNo", message: "This employee appears twice in the file" }),
    ]));
    await drain();
    expect(await profilesOf()).toHaveLength(0);
  });

  it("extra inputs are refused unless the profile's lane registered a rule (new types plug in by data)", async () => {
    process.env.HRMS_S8_BULK_PAY_PROFILE_ENABLED = "true";
    const refused = await bulkReq([item("PP-001", { terms: { annualFixedCtc: 960000 } })], "?dryRun=true");
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain("terms are not supported");
    registerBulkProfileRule("consolidated_contract", (r) => (typeof r.terms?.annualFixedCtc === "number" ? null : "annualFixedCtc required"));
    expect((await bulkReq([item("PP-001", { terms: { annualFixedCtc: 960000 } })], "?dryRun=true")).statusCode).toBe(200);
    expect((await bulkReq([item("PP-001", { terms: { x: 1 } })], "?dryRun=true")).body).toContain("annualFixedCtc required");
  });

  it("requests land PENDING; the requester cannot decide, another user can; per-row results", async () => {
    process.env.HRMS_S8_BULK_PAY_PROFILE_ENABLED = "true";
    const res = await bulkReq([item("PP-001"), item("PP-002"), item("PP-003")]);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ accepted: 3 });
    await drain();
    const pending = await profilesOf();
    expect(pending).toHaveLength(3);
    expect(pending.every((p) => p.status === "pending" && p.requestedBy === MAKER)).toBe(true);
    const ids = pending.map((p) => p.id);

    // A second request while pending is refused row by row.
    expect((await bulkReq([item("PP-001", { effectiveFrom: "2027-02-01" })], "?dryRun=true")).body).toContain("PROFILE_REQUEST_PENDING");

    // Maker-checker: the maker cannot decide any of them.
    const self = await bulkDecide({ decision: "approve", profileIds: ids }, hdr(MAKER, ["hr_admin"]));
    expect(self.json<{ accepted: number; results: Array<{ code?: string }> }>()).toMatchObject({ accepted: 0 });
    expect(self.json<{ results: Array<{ code?: string }> }>().results.every((r) => r.code === "SELF_APPROVAL_FORBIDDEN")).toBe(true);

    // Another user: approve two, reject one (separate calls, one note each); an unknown id is skipped, not fatal.
    const unknown = randomUUID();
    const approve = await bulkDecide({ decision: "approve", profileIds: [ids[0], ids[1], unknown], note: "Approved per DIC HR order dated 02/11/2026" });
    expect(approve.statusCode).toBe(202);
    expect(approve.json()).toMatchObject({ accepted: 2, skipped: 1 });
    expect(approve.json<{ results: Array<{ profileId: string; code?: string }> }>().results.find((r) => r.profileId === unknown)?.code).toBe("NOT_FOUND");
    const reject = await bulkDecide({ decision: "reject", profileIds: [ids[2]], note: "Amount to be revised" });
    expect(reject.json()).toMatchObject({ accepted: 1 });
    await drain();

    const after = await profilesOf();
    expect(after.filter((p) => p.status === "active")).toHaveLength(2);
    expect(after.filter((p) => p.status === "rejected")).toHaveLength(1);
    expect(after.every((p) => p.decidedBy === CHECKER)).toBe(true);

    // Deciding again: already decided -> skipped with NOT_PENDING.
    const again = await bulkDecide({ decision: "approve", profileIds: [ids[0]] });
    expect(again.json<{ results: Array<{ code?: string }> }>().results[0]!.code).toBe("NOT_PENDING");
  });

  it("queue failing part-way: 503 BULK_PARTIAL names the rows already accepted (batch is not atomic)", async () => {
    process.env.HRMS_S8_BULK_PAY_PROFILE_ENABLED = "true";
    await asTenant(TENANT, async (tx) => {
      for (const no of ["PP-101", "PP-102"]) await tx.insert(hrmsEmployees).values({
        id: randomUUID(), tenantId: TENANT, employeeNo: no, fullName: `Contract ${no}`, departmentId: deptId, designationId: desigId,
        dateOfJoining: "2025-04-01", status: "confirmed", employeeType: "contractual", basicMinor: 4_000_000n, createdBy: MAKER, updatedBy: MAKER });
    });
    const orig = queue.publish.bind(queue);
    let n = 0;
    vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: never) => {
      if (topic === COMMANDS.payProfileRequest && ++n === 2) throw new Error("sqs down");
      return orig(topic, msg);
    });
    const res = await bulkReq([item("PP-101"), item("PP-102")]);
    vi.restoreAllMocks();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "BULK_PARTIAL", atomic: false, notQueued: 1 });
    expect(res.json<{ accepted: unknown[] }>().accepted).toHaveLength(1);
  });

  it("bulk-decision reads the locked period once, not per row", async () => {
    process.env.HRMS_S8_BULK_PAY_PROFILE_ENABLED = "true";
    await drain();
    const pend = (await profilesOf()).filter((p) => p.status === "pending").map((p) => p.id);
    expect(pend.length).toBeGreaterThanOrEqual(1);
    lockedThroughMock.mockClear();
    await bulkDecide({ decision: "reject", profileIds: pend }, hdr(CHECKER, ["hr_admin"]), "?dryRun=true");
    const rejectCalls = lockedThroughMock.mock.calls.length;
    await bulkDecide({ decision: "approve", profileIds: [...pend, ...pend.map(() => randomUUID())] }, hdr(CHECKER, ["hr_admin"]), "?dryRun=true");
    expect(rejectCalls).toBe(0);
    // one read up front for the batch; per-row assertAssignable reuses it
    expect(lockedThroughMock.mock.calls.length).toBe(1);
  });

  it("limits: more than 100 decisions or 500 requests is a 400", async () => {
    process.env.HRMS_S8_BULK_PAY_PROFILE_ENABLED = "true";
    const ids = Array.from({ length: 101 }, () => randomUUID());
    expect((await bulkDecide({ decision: "approve", profileIds: ids })).statusCode).toBe(400);
    expect((await bulkReq(Array.from({ length: 501 }, () => item("PP-001")))).statusCode).toBe(400);
  });
});
