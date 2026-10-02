/**
 * Test-triage "bugs found in passing" -- three hrms endpoints whose SQL
 * disagreed with the real schema and 500'd / failed on every call (real DB,
 * no mocks; each case below fails on the pre-fix code):
 *
 *  - /v1/hrms/visiting-card/me* selected columns employee.hrms_employees never
 *    had (first_name, last_name, designation, department, phone,
 *    employee_code, photo_url, branch, user_id) and joined a non-existent
 *    public.tenants -> 500 `column ... does not exist`.
 *  - GET /v1/hrms/ai/alerts selected created_by/updated_by, which the Drizzle
 *    model declared but no migration ever created -> 500.
 *  - PATCH /v1/hrms/devices/policy, on a tenant's first partial update,
 *    inserted explicit NULLs into NOT NULL columns -> 500
 *    `null value in column "min_os_version_android"`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const EMP_USER = randomUUID();
const ADMIN_USER = randomUUID();
const EMP_ID = randomUUID();
const DEPT_ID = randomUUID();
const DESG_ID = randomUUID();
const EMP_NO = `VC-${EMP_ID.slice(0, 8)}`;

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-triage-schema" }, SECRET, 3600)}` };
}

// Every table touched here is FORCE RLS: seed/verify under the tenant GUC.
function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await asTenant(async (tx) => {
    await tx`INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
             VALUES (${DEPT_ID}, ${TENANT}, 'DIC', 'Digital India Corporation', ${ADMIN_USER}, ${ADMIN_USER})`;
    await tx`INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
             VALUES (${DESG_ID}, ${TENANT}, 'DIR', 'Director', ${ADMIN_USER}, ${ADMIN_USER})`;
    await tx`INSERT INTO employee.hrms_employees
               (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining,
                mobile, email, user_ref, created_by, updated_by)
             VALUES (${EMP_ID}, ${TENANT}, ${EMP_NO}, 'Asha Verma', ${DEPT_ID}, ${DESG_ID}, '2020-01-15',
                     '9800000001', 'asha@example.gov.in', ${EMP_USER}, ${ADMIN_USER}, ${ADMIN_USER})`;
    await tx`INSERT INTO employee.hrms_fraud_alerts (id, tenant_id, alert_type, severity, employee_id, description, risk_score)
             VALUES (${randomUUID()}, ${TENANT}, 'duplicate_bank', 'high', ${EMP_ID}, 'Shared bank account', 0.9)`;
  });
  app = await buildApp();
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx`DELETE FROM hrms.device_policies WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM employee.hrms_fraud_alerts WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM hrms.visiting_cards WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`;
  });
  await app.close();
  await sqlClient.end();
});

describe("visiting-card /me* -- queries match the real employee schema", () => {
  it("GET /v1/hrms/visiting-card/me returns 200 with name/designation/department resolved from the real columns", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/visiting-card/me", headers: auth(EMP_USER, ["employee"]) });
    expect(r.statusCode).toBe(200);
    const d = r.json().data;
    expect(d.id).toBe(EMP_ID);
    expect(d.name).toBe("Asha Verma");
    expect(d.designation).toBe("Director");
    expect(d.department).toBe("Digital India Corporation");
    expect(d.orgName).toBe("Digital India Corporation");
    expect(d.employeeCode).toBe(EMP_NO);
    expect(d.phone).toBe("9800000001");
    expect(d.cardTier).toBe("silver");
    expect(d.vcardText).toContain("FN:Asha Verma");
  });

  it("PATCH /v1/hrms/visiting-card/me (first, partial) returns 200 and creates the card with table defaults for omitted fields", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/v1/hrms/visiting-card/me", headers: auth(EMP_USER, ["employee"]),
      payload: { suffix: "IAS", tagline: "MeitY" },
    });
    expect(r.statusCode).toBe(200);
    const [row] = await asTenant((tx) => tx`
      SELECT suffix, tagline, show_personal_phone, card_tier FROM hrms.visiting_cards WHERE tenant_id = ${TENANT} AND employee_id = ${EMP_ID}`);
    expect(row).toEqual({ suffix: "IAS", tagline: "MeitY", show_personal_phone: false, card_tier: "indigo" });
  });

  it("POST /v1/hrms/visiting-card/me/share returns 200 and increments share_count", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/visiting-card/me/share", headers: auth(EMP_USER, ["employee"]),
      payload: { method: "qr" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("shared");
    const [row] = await asTenant((tx) => tx`SELECT share_count FROM hrms.visiting_cards WHERE tenant_id = ${TENANT} AND employee_id = ${EMP_ID}`);
    expect(row?.share_count).toBe(1);
  });

  it("GET /v1/hrms/visiting-card/me/signature returns 200 with the real name and department", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/visiting-card/me/signature", headers: auth(EMP_USER, ["employee"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().plainText).toContain("Asha Verma, IAS\nDirector\nDigital India Corporation");
  });
});

describe("visiting-card /me/signature -- stored-XSS hardening", () => {
  it("escapes a markup-bearing tagline instead of emitting it as HTML", async () => {
    const p = await app.inject({
      method: "PATCH", url: "/v1/hrms/visiting-card/me", headers: auth(EMP_USER, ["employee"]),
      payload: { tagline: "<img src=x onerror=alert(1)>" },
    });
    expect(p.statusCode).toBe(200);
    const r = await app.inject({ method: "GET", url: "/v1/hrms/visiting-card/me/signature", headers: auth(EMP_USER, ["employee"]) });
    expect(r.statusCode).toBe(200);
    const html: string = r.json().html;
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });

  it("rejects a javascript: website on PATCH with 400", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/v1/hrms/visiting-card/me", headers: auth(EMP_USER, ["employee"]),
      payload: { website: "javascript:alert(1)" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("renders no link for a non-http(s) URL already stored in the DB", async () => {
    await asTenant((tx) => tx`
      UPDATE hrms.visiting_cards SET website = 'javascript:alert(1)', linkedin = 'javascript:alert(2)'
      WHERE tenant_id = ${TENANT} AND employee_id = ${EMP_ID}`);
    const r = await app.inject({ method: "GET", url: "/v1/hrms/visiting-card/me/signature", headers: auth(EMP_USER, ["employee"]) });
    expect(r.statusCode).toBe(200);
    const html: string = r.json().html;
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("LinkedIn");
  });
});

describe("GET /v1/hrms/ai/alerts -- Drizzle model matches employee.hrms_fraud_alerts", () => {
  it("returns 200 with the tenant's alerts", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/ai/alerts", headers: auth(ADMIN_USER, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0]).toMatchObject({ alertType: "duplicate_bank", employeeId: EMP_ID });
  });
});

describe("PATCH /v1/hrms/devices/policy -- first partial update on a tenant with no policy row", () => {
  it("returns 200 and inserts the row: supplied field applied, omitted fields keep the migration defaults", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/v1/hrms/devices/policy", headers: auth(ADMIN_USER, ["hr_admin"]),
      payload: { maxInactiveDays: 30 },
    });
    expect(r.statusCode).toBe(200);
    const [row] = await asTenant((tx) => tx`
      SELECT min_os_version_android, min_os_version_ios, min_app_version, block_rooted, max_inactive_days
      FROM hrms.device_policies WHERE tenant_id = ${TENANT}`);
    expect(row).toEqual({
      min_os_version_android: "12", min_os_version_ios: "16", min_app_version: "0.1.0",
      block_rooted: true, max_inactive_days: 30,
    });
  });

  it("a second partial PATCH updates only the supplied field", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/v1/hrms/devices/policy", headers: auth(ADMIN_USER, ["hr_admin"]),
      payload: { minOsVersionAndroid: "13" },
    });
    expect(r.statusCode).toBe(200);
    const [row] = await asTenant((tx) => tx`
      SELECT min_os_version_android, max_inactive_days FROM hrms.device_policies WHERE tenant_id = ${TENANT}`);
    expect(row).toEqual({ min_os_version_android: "13", max_inactive_days: 30 });
  });
});
