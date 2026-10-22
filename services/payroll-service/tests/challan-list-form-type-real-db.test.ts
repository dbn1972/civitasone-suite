/**
 * GAP-PAYROLL-STATUTORY-CHALLANS-04 (real Postgres, FORCE RLS, no mocks): the challans list
 * filters by form type (24Q default / 26Q) AND names the form on every row, so the UI can show a
 * "Form" column. Rows are seeded directly under the tenant scope; the route is the real one.
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

// vitest.config.ts sets JWT_SECRET for every suite.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const PERIOD = "2026-08";

function auth(roles: string[], tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "challan-form" }, SECRET)}` };
}

let app: Awaited<ReturnType<typeof buildApp>>;

async function seed(tenant: string, formType: "24Q" | "26Q", serial: string, tdsMinor: string) {
  await withTenantScope(db as never, tenant, async (tx: { execute: (x: unknown) => Promise<unknown> }) => {
    await tx.execute(sql`
      INSERT INTO statutory.payroll_tds_challan
        (tenant_id, period, section, form_type, bsr_code, challan_serial, deposit_date, cin,
         tds_amount_minor, total_amount_minor, created_by)
      VALUES (${tenant}::uuid, ${PERIOD}, ${formType === "26Q" ? "194" : "192"}, ${formType}, '0510308', ${serial}, '2026-09-05',
              ${"0510308" + "05092026" + serial.padStart(5, "0") + formType}, ${tdsMinor}::bigint, ${tdsMinor}::bigint, ${ACTOR}::uuid)`);
  });
}

beforeAll(async () => {
  app = await buildApp();
  await seed(TENANT, "24Q", "101", "1234500");
  await seed(TENANT, "24Q", "102", "2000000");
  await seed(TENANT, "26Q", "201", "999999");
  await seed(OTHER_TENANT, "26Q", "301", "5555555");
});

afterAll(async () => {
  await app?.close();
  await sqlClient.end();
});

type ListBody = { period: string; formType: string; count: number; challans: Array<{ cin: string; formType: string; tdsAmountMinor: string }> };

describe("GET /v1/payroll/statutory/challans -- form type filter and per-row formType (real DB)", () => {
  it("defaults to 24Q: only the 24Q challans, each row naming formType 24Q", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/statutory/challans?period=${PERIOD}`, headers: auth(["payroll_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListBody;
    expect(body.formType).toBe("24Q");
    expect(body.count).toBe(2);
    expect(body.challans.map((c) => c.formType)).toEqual(["24Q", "24Q"]);
    expect(body.challans.map((c) => c.tdsAmountMinor).sort()).toEqual(["1234500", "2000000"]);
  });

  it("formType=26Q returns only the 26Q challan (and none of the 24Q ones), row labelled 26Q", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/statutory/challans?period=${PERIOD}&formType=26Q`, headers: auth(["payroll_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ListBody;
    expect(body.formType).toBe("26Q");
    expect(body.count).toBe(1);
    expect(body.challans).toHaveLength(1);
    expect(body.challans[0]).toMatchObject({ formType: "26Q", tdsAmountMinor: "999999" });
  });

  it("an unrecognised formType falls back to 24Q, never a mixed list", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/statutory/challans?period=${PERIOD}&formType=27Q`, headers: auth(["payroll_admin"]) });
    const body = res.json() as ListBody;
    expect(body.formType).toBe("24Q");
    expect(body.challans.every((c) => c.formType === "24Q")).toBe(true);
  });

  it("is tenant-scoped: another tenant's 26Q challan never appears", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/statutory/challans?period=${PERIOD}&formType=26Q`, headers: auth(["payroll_admin"]) });
    const body = res.json() as ListBody;
    expect(body.challans.map((c) => c.tdsAmountMinor)).not.toContain("5555555");
    const other = await app.inject({ method: "GET", url: `/v1/payroll/statutory/challans?period=${PERIOD}&formType=26Q`, headers: auth(["payroll_admin"], OTHER_TENANT) });
    expect((other.json() as ListBody).challans.map((c) => c.tdsAmountMinor)).toEqual(["5555555"]);
  });

  it("is role-gated: an employee gets 403", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/statutory/challans?period=${PERIOD}`, headers: auth(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});
