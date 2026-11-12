/**
 * UAN backfill-encrypt + blind index, real database (run as the NOBYPASSRLS role hrms_svc, RLS forced; seeds are
 * written under runWithTenant). Covers: index maintained on create (bulk import) and update; the backfill (dry run
 * writes nothing, batched, resumable, idempotent, never prints a value); GET /v1/hrms/employees/by-uan (flag off = 404,
 * roles, index path vs legacy path, tenant isolation); the bulk-import duplicate check through the index.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

vi.mock("../src/shared/payroll-client.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  fetchPayrollLockedThrough: () => Promise.resolve(null),
}));

import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerEmployeeConsumers } from "../src/modules/employee/consumer.js";
import { registerBulkImportConsumers } from "../src/modules/bulk-import/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsBulkImportBatches, hrmsBulkImportRows } from "../src/modules/bulk-import/schema.js";
import { uanBlindIndex } from "../src/shared/blind-index.js";
import { backfillUanEncryption, parseArgs } from "../scripts/backfill-uan-encryption.js";

registerEmployeeConsumers(queue);
registerBulkImportConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const deptId = randomUUID();
const desigId = randomUUID();
const hdr = (roles: string[], tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`,
  "content-type": "application/json",
});
const asTenant = <T>(tenant: string, fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(tenant, () => db.transaction(fn));

const UANS = Array.from({ length: 7 }, (_, i) => `1030${String(20000000 + i)}`);
const PAN_LEGACY = "BNZPK4821M";
let app: FastifyInstance;

const row = (no: string, over: Record<string, unknown> = {}) => ({
  employeeNo: no, fullName: `Imported ${no}`, departmentId: deptId, designationId: desigId,
  dateOfJoining: "2026-04-01", employeeType: "permanent", basicMinor: 4490050, ...over,
});
const bulk = (employees: unknown[], q = "") => app.inject({ method: "POST", url: `/v1/hrms/employees/bulk${q}`, headers: hdr(["hr_admin"]), payload: { employees } });
const idOf = async (no: string, tenant = TENANT) => (await asTenant(tenant, (tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
  .where(and(eq(hrmsEmployees.tenantId, tenant), eq(hrmsEmployees.employeeNo, no)))))[0]!.id;
const raw = async (id: string, tenant = TENANT) => (await asTenant(tenant, (tx) => tx.execute(sql`
  SELECT uan_number, uan_bidx, pan, version FROM employee.hrms_employees WHERE id = ${id}::uuid`)) as unknown as Array<Record<string, string | null>>)[0]!;
/** Make a row look like it did before migration 0268 / this PR: plaintext identifiers, no index. */
const makeLegacy = (id: string, uan: string | null, pan: string | null = null, tenant = TENANT) => asTenant(tenant, (tx) => tx.execute(sql`
  UPDATE employee.hrms_employees SET uan_number = ${uan}, uan_bidx = NULL, pan = ${pan} WHERE id = ${id}::uuid`));
const byUan = (uan: string, roles = ["hr_admin"], tenant = TENANT) => app.inject({ method: "GET", url: `/v1/hrms/employees/by-uan?uan=${uan}`, headers: hdr(roles, tenant) });

beforeAll(async () => {
  app = await buildApp();
  for (const t of [TENANT, OTHER]) {
    await asTenant(t, async (tx) => {
      await tx.insert(hrmsDepartments).values({ id: t === TENANT ? deptId : randomUUID(), tenantId: t, code: `U${t.slice(0, 6)}`, name: "Programme Office", createdBy: ACTOR, updatedBy: ACTOR });
      if (t === TENANT) await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: t, code: `UD${t.slice(0, 6)}`, name: "Project Associate", createdBy: ACTOR, updatedBy: ACTOR });
    });
  }
});
beforeEach(() => {
  delete process.env.HRMS_S8_BULK_IMPORT_ENABLED;
  delete process.env.HRMS_UAN_BLIND_INDEX_ENABLED;
});
afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await asTenant(t, async (tx) => {
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

describe("the index is maintained on every write path", () => {
  it("bulk import (create) seals the UAN and stores the keyed index; update and clear keep it in step", async () => {
    process.env.HRMS_S8_BULK_IMPORT_ENABLED = "true";
    expect((await bulk([row("BX-001", { uanNumber: UANS[0] })])).statusCode).toBe(202);
    await drain();
    const id = await idOf("BX-001");
    const r = await raw(id);
    expect(r["uan_number"]).toMatch(/^enc:v2:/);
    expect(r["uan_bidx"]).toBe(uanBlindIndex(TENANT, UANS[0]));
    expect(r["uan_bidx"]).not.toContain(UANS[0]!);

    const patch = (uanNumber: string | null) => app.inject({ method: "PATCH", url: `/v1/hrms/employees/${id}`, headers: hdr(["hr_admin"]), payload: { uanNumber, reason: "Corrected against the EPFO passbook" } });
    expect((await patch(UANS[1]!)).statusCode).toBe(202);
    await drain();
    expect((await raw(id))["uan_bidx"]).toBe(uanBlindIndex(TENANT, UANS[1]));
    expect((await patch(null)).statusCode).toBe(202);
    await drain();
    expect(await raw(id)).toMatchObject({ uan_number: null, uan_bidx: null });
  });
});

describe("backfill command", () => {
  const ids: string[] = [];
  beforeAll(async () => {
    process.env.HRMS_S8_BULK_IMPORT_ENABLED = "false";
    expect((await bulk(UANS.map((_, i) => row(`BF-${i}`)))).statusCode).toBe(202);
    await drain();
    for (let i = 0; i < UANS.length; i++) ids.push(await idOf(`BF-${i}`));
    for (let i = 0; i < UANS.length; i++) await makeLegacy(ids[i]!, UANS[i]!, i === 0 ? PAN_LEGACY : null);
  });

  it("dry run counts the work and writes nothing", async () => {
    const before = await Promise.all(ids.map((i) => raw(i)));
    const rep = await backfillUanEncryption(parseArgs(["--tenant", TENANT]));
    expect(rep.mode).toBe("dry-run");
    expect(rep.totals.scanned).toBe(7);
    expect(rep.tenants[0]!.sealed).toMatchObject({ uan_number: 7, pan: 1 });
    expect(rep.totals.indexed).toBe(7);
    expect(await Promise.all(ids.map((i) => raw(i)))).toEqual(before);
    expect(before.every((b) => b["uan_bidx"] === null && !b["uan_number"]!.startsWith("enc:"))).toBe(true);
  });

  it("applies in batches, is resumable (--max-rows then --after), keeps version, and never prints a value", async () => {
    const printed: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => { printed.push(a.join(" ")); });
    const err = vi.spyOn(console, "error").mockImplementation((...a) => { printed.push(a.join(" ")); });
    const versions = await Promise.all(ids.map(async (i) => (await raw(i))["version"]));

    // first run stops after 3 rows ...
    const first = await backfillUanEncryption(parseArgs(["--apply", "--tenant", TENANT, "--batch-size", "2", "--max-rows", "3"]));
    expect(first.totals.scanned).toBe(3);
    expect(first.totals.indexed).toBe(3);
    const lastId = first.tenants[0]!.lastId!;
    // ... and a second run, told where to resume, finishes the other four (state-based selection means --after is optional)
    const second = await backfillUanEncryption(parseArgs(["--apply", "--tenant", TENANT, "--batch-size", "2", "--after", lastId]));
    expect(second.totals.scanned).toBe(4);
    expect(first.totals.scanned + second.totals.scanned).toBe(7);

    for (let i = 0; i < ids.length; i++) {
      const r = await raw(ids[i]!);
      expect(r["uan_number"]).toMatch(/^enc:v2:/);
      expect(r["uan_bidx"]).toBe(uanBlindIndex(TENANT, UANS[i]));
      expect(r["version"]).toBe(versions[i]);
    }
    expect((await raw(ids[0]!))["pan"]).toMatch(/^enc:v2:/);
    // the column type still reads the clear value
    expect((await asTenant(TENANT, (tx) => tx.select({ u: hrmsEmployees.uanNumber }).from(hrmsEmployees).where(eq(hrmsEmployees.id, ids[3]!))))[0]!.u).toBe(UANS[3]);

    log.mockRestore(); err.mockRestore();
    const out = printed.join("\n");
    expect(out.length).toBeGreaterThan(0);
    for (const secret of [...UANS, PAN_LEGACY]) expect(out).not.toContain(secret);
    expect(out).not.toContain("enc:v");
  });

  it("is idempotent: a second apply does nothing", async () => {
    const snapshot = await Promise.all(ids.map((i) => raw(i)));
    const rep = await backfillUanEncryption(parseArgs(["--apply", "--tenant", TENANT]));
    expect(rep.totals).toMatchObject({ scanned: 0, sealed: 0, indexed: 0, conflicts: 0, failed: 0 });
    expect(await Promise.all(ids.map((i) => raw(i)))).toEqual(snapshot);
  });

  it("fills only the index for an already sealed UAN, and --reindex leaves a current index alone", async () => {
    await asTenant(TENANT, (tx) => tx.execute(sql`UPDATE employee.hrms_employees SET uan_bidx = NULL WHERE id = ${ids[2]!}::uuid`));
    const rep = await backfillUanEncryption(parseArgs(["--apply", "--tenant", TENANT, "--reindex"]));
    expect(rep.totals).toMatchObject({ scanned: 1, sealed: 0, indexed: 1, reindexed: 0 });
    expect((await raw(ids[2]!))["uan_bidx"]).toBe(uanBlindIndex(TENANT, UANS[2]));
  });

  it("does not touch another tenant", async () => {
    const other = (await asTenant(OTHER, (tx) => tx.insert(hrmsEmployees).values({
      tenantId: OTHER, employeeNo: "OT-1", fullName: "Other", departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2026-04-01",
      createdBy: ACTOR, updatedBy: ACTOR,
    }).returning({ id: hrmsEmployees.id })))[0]!.id;
    await asTenant(OTHER, (tx) => tx.execute(sql`UPDATE employee.hrms_employees SET uan_number = ${UANS[0]} WHERE id = ${other}::uuid`));
    await backfillUanEncryption(parseArgs(["--apply", "--tenant", TENANT]));
    expect((await raw(other, OTHER))["uan_number"]).toBe(UANS[0]); // still plaintext: not in scope
    const rep = await backfillUanEncryption(parseArgs(["--apply", "--tenant", OTHER]));
    expect(rep.totals.sealed).toBe(1);
    expect((await raw(other, OTHER))["uan_bidx"]).toBe(uanBlindIndex(OTHER, UANS[0]));
  });
});

describe("GET /v1/hrms/employees/by-uan", () => {
  it("flag off: 404", async () => {
    expect((await byUan(UANS[3]!)).statusCode).toBe(404);
  });

  it("flag on: HR / payroll roles only, strict input, exact match, no UAN in the response", async () => {
    process.env.HRMS_UAN_BLIND_INDEX_ENABLED = "true";
    expect((await byUan(UANS[3]!, ["hr_officer"])).statusCode).toBe(403);
    expect((await byUan(UANS[3]!, ["employee"])).statusCode).toBe(403);
    expect((await byUan("12345")).statusCode).toBe(400);
    const res = await byUan(UANS[3]!, ["payroll_officer"]);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ count: number; data: Array<Record<string, unknown>> }>();
    expect(body.count).toBe(1);
    expect(body.data[0]).toMatchObject({ employeeNo: "BF-3" });
    expect(res.body).not.toContain(UANS[3]!);
    expect((await byUan("999999999999")).json<{ count: number }>().count).toBe(0);
  });

  it("is tenant scoped: the same UAN in another tenant is not a match", async () => {
    process.env.HRMS_UAN_BLIND_INDEX_ENABLED = "true";
    // OTHER holds UANS[0] (backfilled above); TENANT also holds it on BF-0, each only sees its own
    expect((await byUan(UANS[0]!, ["hr_admin"], OTHER)).json<{ data: Array<{ employeeNo: string }> }>().data.map((d) => d.employeeNo)).toEqual(["OT-1"]);
    expect((await byUan(UANS[0]!)).json<{ data: Array<{ employeeNo: string }> }>().data.map((d) => d.employeeNo)).toEqual(["BF-0"]);
  });

  it("a tenant that is not fully backfilled is answered by the legacy scan, so nothing is hidden", async () => {
    process.env.HRMS_UAN_BLIND_INDEX_ENABLED = "true";
    const id = await idOf("BF-4");
    await makeLegacy(id, UANS[4]!);
    const res = await byUan(UANS[4]!);
    expect(res.json<{ count: number; data: Array<{ employeeNo: string }> }>().data.map((d) => d.employeeNo)).toEqual(["BF-4"]);
    // the index path would have missed it (no index value on that row)
    expect((await raw(id))["uan_bidx"]).toBeNull();
    await backfillUanEncryption(parseArgs(["--apply", "--tenant", TENANT]));
    expect((await byUan(UANS[4]!)).json<{ count: number }>().count).toBe(1);
  });
});

describe("bulk-import duplicate check through the index", () => {
  it("refuses a UAN already held in the tenant (masked in the message), with the flag on", async () => {
    process.env.HRMS_S8_BULK_IMPORT_ENABLED = "true";
    process.env.HRMS_UAN_BLIND_INDEX_ENABLED = "true";
    const res = await bulk([row("NEW-1", { uanNumber: UANS[5] })], "?dryRun=true");
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("UAN");
    expect(res.body).not.toContain(UANS[5]!);
    const ok = await bulk([row("NEW-2", { uanNumber: "104999999999" })], "?dryRun=true");
    expect(ok.statusCode).toBe(200);
  });

  it("gives the same answer with the flag off (legacy decrypt-and-compare)", async () => {
    process.env.HRMS_S8_BULK_IMPORT_ENABLED = "true";
    const res = await bulk([row("NEW-3", { uanNumber: UANS[5] })], "?dryRun=true");
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("UAN");
  });
});
