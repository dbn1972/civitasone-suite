/**
 * Section 8 G6 -- POST /v1/hrms/employees/bulk with the sensitive columns (flag HRMS_S8_BULK_IMPORT_ENABLED).
 *
 * Owner decision 5: PAN, bank account + IFSC and UAN are allowed, Aadhaar is not; values are never echoed in an
 * error and never reach the queue in clear. Same harness as bulk-import-routes.test.ts (DB mocked, queue spied); the
 * persisted / encrypted half is covered against Postgres in tests/s8-g6-bulk-import-real-db.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const H = vi.hoisted(() => {
  process.env.PII_ENC_KEY ??= "civitasone-hrms-pii-dev-key-not-for-prod";
  return { queryResults: [] as unknown[][], callCount: { n: 0 } };
});

vi.mock("../modules/bulk-import/repo.js", () => ({
  insertBatch: vi.fn(async () => true), markRowFailed: vi.fn(async () => {}), markRowCreated: vi.fn(async () => {}),
  getBatchStatus: vi.fn(async () => null),
}));

vi.mock("../shared/db.js", () => {
  const sqlClientFn = (..._args: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._args: unknown[]) => Promise.resolve([]));
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));
  return {
    db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) },
    sqlClient: sqlClientFn,
    scopedRead: (fn: (tx: unknown) => unknown) => {
      const rows = H.queryResults[H.callCount.n] ?? [];
      H.callCount.n++;
      const thenableRows = { then: (res: (v: unknown) => unknown) => Promise.resolve(res(rows)) };
      const tx = { select: () => ({ from: () => ({ ...thenableRows, where: () => thenableRows }) }) };
      return Promise.resolve(fn(tx));
    },
  };
});

import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { decryptPii } from "../shared/pii-crypto.js";
import { COMMANDS } from "../topics.js";
import type { BulkImportRecordPayload } from "../modules/bulk-import/command.js";

afterAll(async () => { await sqlClient.end(); });

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000011";
const tok = (roles: string[]) => signToken({ sub: "g6-user", tid: TENANT, roles, sid: "sess-g6" }, SECRET);
const hr = { authorization: `Bearer ${tok(["hr_admin"])}` };

type Published = { messageId: string; payload: unknown };
type Spy = { mock: { calls: unknown[][] } };
const records = (spy: Spy) => spy.mock.calls.filter((c) => c[0] === COMMANDS.employeeBulkImportRecord)
  .map((c) => (c[1] as Published).payload as BulkImportRecordPayload);
const creates = (spy: Spy) => records(spy).flatMap((r) => r.items.map((i) => i.create));

const CANON = [{ c: "permanent" }, { c: "contractual" }];
const row = (o: Record<string, unknown> = {}) => ({
  employeeNo: "DIC1001", fullName: "Rajesh Kumar Sharma",
  departmentId: "11111111-1111-4111-8111-111111111111", designationId: "22222222-2222-4222-8222-222222222222",
  dateOfJoining: "2026-04-01", employeeType: "contractual", ...o,
});
const PAN = "BNZPK4821M", UAN = "101234567890", ACC = "31245678901", IFSC = "SBIN0001234";
const sensitive = (o: Record<string, unknown> = {}) => row({ pan: PAN, uanNumber: UAN, bankAccountNo: ACC, bankIfsc: IFSC, ...o });

/** [types canon, tenant types, existing employee nos, (flag on) held identifiers]. */
function setDb(held: Array<Record<string, string>> = []) {
  H.queryResults = [CANON, [], [], held];
  H.callCount.n = 0;
}

async function post(payload: unknown, opts: { url?: string; headers?: Record<string, string> } = {}) {
  const app: FastifyInstance = await buildApp();
  const res = await app.inject({ method: "POST", url: opts.url ?? "/v1/hrms/employees/bulk", headers: opts.headers ?? hr, payload: payload as object });
  await app.close();
  return res;
}

beforeEach(() => { setDb(); vi.restoreAllMocks(); });
afterEach(() => { delete process.env.HRMS_S8_BULK_IMPORT_ENABLED; });

describe("flag OFF (default): the route is exactly the 11-field contract", () => {
  it("strips the sensitive columns and queues the same payload as before", async () => {
    const spy = vi.spyOn(queue, "publish");
    const res = await post({ employees: [sensitive()] });
    expect(res.statusCode).toBe(202);
    const c = creates(spy)[0]!;
    for (const k of ["pan", "uanNumber", "bankAccountNo", "bankIfsc"]) expect(c).not.toHaveProperty(k);
    expect(records(spy)[0]).not.toHaveProperty("sensitiveFields");
  });

  it("does not reject an aadhaar key (unchanged behaviour: unknown keys are ignored)", async () => {
    const spy = vi.spyOn(queue, "publish");
    const res = await post({ employees: [row({ aadhaar: "234567890123" })] });
    expect(res.statusCode).toBe(202);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("234567890123");
  });
});

describe("flag ON: sensitive columns", () => {
  beforeEach(() => { process.env.HRMS_S8_BULK_IMPORT_ENABLED = "true"; });

  it("202 -- queues the values SEALED (never clear) and audits which fields were present, names only", async () => {
    const spy = vi.spyOn(queue, "publish");
    setDb();
    const res = await post({ employees: [sensitive({ pan: "bnzpk4821m", bankIfsc: "sbin0001234" })] });
    expect(res.statusCode).toBe(202);
    const c = creates(spy)[0]! as Record<string, string>;
    for (const k of ["pan", "uanNumber", "bankAccountNo", "bankIfsc"]) expect(c[k]).toMatch(/^enc:v2:/);
    expect(decryptPii(c.pan!)).toBe(PAN);               // upper-cased
    expect(decryptPii(c.bankIfsc!)).toBe(IFSC);
    expect(decryptPii(c.bankAccountNo!)).toBe(ACC);
    expect(decryptPii(c.uanNumber!)).toBe(UAN);
    expect(records(spy)[0]!.sensitiveFields).toEqual(["pan", "uanNumber", "bankAccountNo", "bankIfsc"]);
    const wire = JSON.stringify(spy.mock.calls);
    for (const clear of [PAN, UAN, ACC, IFSC]) expect(wire).not.toContain(clear);
  });

  it("400 -- an Aadhaar column is refused by name, whatever the spelling, and nothing is queued or echoed", async () => {
    const spy = vi.spyOn(queue, "publish");
    for (const key of ["aadhaar", "aadhaarNo", "Aadhar Number", "aadhaar_ref", "uid"]) {
      setDb();
      const res = await post({ employees: [row({ [key]: "234567890123" })] });
      expect(res.statusCode, key).toBe(400);
      expect(JSON.stringify(res.json().fieldErrors)).toContain("Aadhaar");
      expect(res.body).not.toContain("234567890123");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["PAN with wrong shape", { pan: "ABCDE12345" }, "employees.0.pan", "ABCDE12345"],
    ["PAN too short", { pan: "ABCDE1234" }, "employees.0.pan", "ABCDE1234"],
    ["IFSC with non-zero fifth character", { bankIfsc: "SBIN1001234" }, "employees.0.bankIfsc", "SBIN1001234"],
    ["IFSC too short", { bankIfsc: "HDFC00012" }, "employees.0.bankIfsc", "HDFC00012"],
    ["UAN of 11 digits", { uanNumber: "10123456789" }, "employees.0.uanNumber", "10123456789"],
    ["UAN with letters", { uanNumber: "10123456789A" }, "employees.0.uanNumber", "10123456789A"],
    ["account number with letters", { bankAccountNo: "3124567890A" }, "employees.0.bankAccountNo", "3124567890A"],
    ["account number too short", { bankAccountNo: "12345678" }, "employees.0.bankAccountNo", "12345678"],
  ])("400 -- %s: field error, value not echoed, nothing queued", async (_l, o, field, bad) => {
    const spy = vi.spyOn(queue, "publish");
    const res = await post({ employees: [sensitive(o)] });
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors.map((e: { field: string }) => e.field)).toContain(field);
    expect(res.body).not.toContain(bad);
    expect(spy).not.toHaveBeenCalled();
  });

  it("400 -- IFSC without an account number and the reverse", async () => {
    const a = await post({ employees: [row({ bankIfsc: IFSC })] });
    expect(a.json().fieldErrors).toEqual([{ field: "employees.0.bankAccountNo", message: "bank account number is required with an IFSC" }]);
    setDb();
    const b = await post({ employees: [row({ bankAccountNo: ACC })] });
    expect(b.json().fieldErrors).toEqual([{ field: "employees.0.bankIfsc", message: "IFSC is required with a bank account number" }]);
  });

  it("400 -- same PAN, UAN and account number twice in one file: masked, names the first row", async () => {
    const res = await post({ employees: [sensitive({ employeeNo: "DIC1001" }), sensitive({ employeeNo: "DIC1002" })] });
    expect(res.statusCode).toBe(400);
    const msgs = res.json().fieldErrors.map((e: { field: string; message: string }) => `${e.field}|${e.message}`);
    expect(msgs).toContain("employees.1.pan|Duplicate PAN ******821M (also on row 1 of this file)");
    expect(msgs).toContain("employees.1.uanNumber|Duplicate UAN ********7890 (also on row 1 of this file)");
    expect(msgs).toContain("employees.1.bankAccountNo|Duplicate bank account number *******8901 (also on row 1 of this file)");
    for (const clear of [PAN, UAN, ACC]) expect(res.body).not.toContain(clear);
  });

  it("400 -- PAN / UAN / account already held by another employee of the tenant", async () => {
    setDb([{ pan: PAN, uanNumber: UAN, bankAccountNo: ACC }]);
    const res = await post({ employees: [sensitive()] });
    expect(res.statusCode).toBe(400);
    const fields = res.json().fieldErrors.map((e: { field: string }) => e.field);
    expect(fields).toEqual(expect.arrayContaining(["employees.0.pan", "employees.0.uanNumber", "employees.0.bankAccountNo"]));
    expect(res.body).toContain("already belongs to another employee");
    for (const clear of [PAN, UAN, ACC]) expect(res.body).not.toContain(clear);
  });

  it("dryRun=true -- a clean file answers 200 and queues nothing", async () => {
    const spy = vi.spyOn(queue, "publish");
    const res = await post({ employees: [sensitive()] }, { url: "/v1/hrms/employees/bulk?dryRun=true" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ dryRun: true, ok: true, rowCount: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("dryRun=true -- reports the SAME errors as the real run", async () => {
    const payload = { employees: [sensitive({ pan: "BAD" })] };
    const dry = await post(payload, { url: "/v1/hrms/employees/bulk?dryRun=true" });
    setDb();
    const real = await post(payload);
    expect(dry.statusCode).toBe(400);
    expect(dry.json().fieldErrors).toEqual(real.json().fieldErrors);
  });

  it("403 -- a non-HR role cannot import", async () => {
    const res = await post({ employees: [sensitive()] }, { headers: { authorization: `Bearer ${tok(["manager"])}` } });
    expect(res.statusCode).toBe(403);
  });
});
