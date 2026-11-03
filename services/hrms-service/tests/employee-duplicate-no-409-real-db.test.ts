/**
 * UAT follow-up: creating an employee with an Employee ID that already exists
 * answered 500, and the error log carried the whole insert (employee name,
 * sealed PAN, every other value) via postgres-js PostgresError.parameters /
 * query / args. Pins, against the real DB:
 *   - the duplicate answers 409 EMPLOYEE_NO_EXISTS with a readable message;
 *   - the serializer every hrms logger uses (shared/safe-error-log.ts) logs the
 *     REAL unique-violation error as code + constraint only: no name, no PAN
 *     (plain or sealed), no number, no query, no parameters;
 *   - the Fastify request logger and every module pino logger use it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { eq, sql } from "drizzle-orm";
import { pino } from "pino";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { SAFE_LOG_SERIALIZERS, safeErr, isUniqueViolation } from "../src/shared/safe-error-log.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const HR = randomUUID();
const deptId = randomUUID();
const desigId = randomUUID();
const NAME = "Duplicate Joiner Kumari";
const PAN = "QWERT6789Z";
const headers = () => ({
  authorization: `Bearer ${signToken({ sub: HR, tid: TENANT, roles: ["hr_admin"], sid: "s-dup" }, SECRET)}`,
  "content-type": "application/json",
});
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: `U${TENANT.slice(0, 6)}`, name: "Dept", createdBy: HR, updatedBy: HR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: `UD${TENANT.slice(0, 6)}`, name: "Desig", createdBy: HR, updatedBy: HR });
  });
});
afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid`);
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  });
  await app.close();
  await sqlClient.end();
});

const body = (employeeNo: string) => ({
  employeeNo, fullName: NAME, departmentId: deptId, designationId: desigId, dateOfJoining: "2026-11-01", pan: PAN,
  mobile: "9876543210", bankAccountNo: "001122334455",
});

function capture() {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _e, cb) { lines.push(String(chunk)); cb(); } });
  return { log: pino({ serializers: SAFE_LOG_SERIALIZERS }, stream), lines };
}

describe("duplicate Employee ID (UAT follow-up)", () => {
  it("answers 409 EMPLOYEE_NO_EXISTS instead of 500, and creates nothing", async () => {
    const no = `DUP-${randomUUID().slice(0, 8)}`;
    expect((await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: headers(), payload: body(no) })).statusCode).toBe(202);
    const dup = await app.inject({ method: "POST", url: "/v1/hrms/employees", headers: headers(), payload: body(no) });
    expect(dup.statusCode).toBe(409);
    const j = dup.json() as { code: string; message: string };
    expect(j.code).toBe("EMPLOYEE_NO_EXISTS");
    expect(j.message).toMatch(/already exists/);
    const rows = await asTenant((tx) => tx.select().from(hrmsEmployees).where(eq(hrmsEmployees.employeeNo, no)));
    expect(rows).toHaveLength(1);
  });

  it("the logged form of the real unique-violation error carries no PII, only code and constraint", async () => {
    const no = `DUPLOG-${randomUUID().slice(0, 6)}`;
    const values = { tenantId: TENANT, employeeNo: no, fullName: NAME, departmentId: deptId, designationId: desigId, dateOfJoining: "2026-11-01", pan: PAN, createdBy: HR, updatedBy: HR };
    await asTenant((tx) => tx.insert(hrmsEmployees).values(values));
    let caught: unknown;
    try { await asTenant((tx) => tx.insert(hrmsEmployees).values(values)); } catch (e) { caught = e; }
    expect(isUniqueViolation(caught, "hrms_employees_tenant_id_employee_no_key")).toBe(true);
    // Control: the raw error really does carry the values (that is the leak being closed).
    expect(JSON.stringify(caught)).toContain(NAME);

    const { log, lines } = capture();
    log.error({ err: caught, employeeNo: no }, "employee create failed");
    log.error({ err: new Error("wrapped", { cause: caught }) }, "wrapped failure");
    const out = lines.join("\n");
    for (const forbidden of [NAME, PAN, "enc:", '"parameters"', '"query"', '"args"', '"detail"', "9876543210", "insert into"]) {
      expect(out).not.toContain(forbidden);
    }
    const first = JSON.parse(lines[0]!) as { err: Record<string, unknown> };
    expect(first.err).toEqual({ type: "PostgresError", message: "database error 23505 on hrms_employees_tenant_id_employee_no_key", stack: "", code: "23505", constraint_name: "hrms_employees_tenant_id_employee_no_key", table_name: "hrms_employees", schema_name: "employee", routine: expect.any(String), severity: "ERROR" });
    expect(safeErr("plain")).toEqual({ type: "string", message: "non-Error value thrown", stack: "" });
  });

  it("the Fastify request logger and every hrms module pino logger use the safe serializer", () => {
    const sers = (app.log as unknown as Record<symbol, Record<string, unknown>>)[pino.symbols.serializersSym];
    expect(sers?.err).toBe(safeErr);
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) { if (f !== "__tests__") walk(p); continue; }
        if (!p.endsWith(".ts") || p.endsWith(".test.ts")) continue;
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/pino\(\{[^)]*\}\)/g)) if (!m[0].includes("SAFE_LOG_SERIALIZERS")) offenders.push(p);
      }
    };
    walk(join(__dirname, "../src"));
    expect(offenders).toEqual([]);
  });
});
