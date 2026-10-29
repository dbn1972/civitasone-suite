/**
 * UAT W6-A (P1 accept-nonexistent / P10) -- real DB.
 *
 * These hrms command routes answered 200/202 for a random id because they published (or
 * ran an UPDATE) without reading the target. Each now does a tenant-scoped existence read
 * first: random id -> 404 and nothing published; a real row -> 200/202 and the command is
 * published. Plus the two P10 GETs: a malformed / unknown path param is a 4xx, not 200.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

const ids = {
  employeeType: randomUUID(), leaveType: randomUUID(), leavePolicy: randomUUID(), employee: randomUUID(),
  propertyReturn: randomUUID(), onboardingTask: randomUUID(), jobOpening: randomUUID(), enrollment: randomUUID(),
};

const hdr = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["hr_admin", "super_admin"], sid: "s" }, SECRET, 3600)}`,
  "x-tenant-id": tenant,
});

async function asTenant(tenantId: string, statements: Array<[string, unknown[]]>): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    for (const [text, params] of statements) await sql.unsafe(text, params as never[]);
  });
}

let app: FastifyInstance;
const tag = ids.employee.slice(0, 8);

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await asTenant(TENANT, [
    ["INSERT INTO employee.hrms_employee_types (id, tenant_id, code, name, created_by) VALUES ($1, $2, $3, 'W6A type', $4)", [ids.employeeType, TENANT, `W6A${tag}`.slice(0, 24), ACTOR]],
    ["INSERT INTO leave.hrms_leave_types (id, tenant_id, code, name, created_by, updated_by) VALUES ($1, $2, $3, 'W6A leave', $4, $4)", [ids.leaveType, TENANT, `W6A${tag}`, ACTOR]],
    ["INSERT INTO leave.hrms_leave_policy_rules (id, tenant_id, leave_type_id, employee_type, created_by, updated_by) VALUES ($1, $2, $3, 'permanent', $4, $4)", [ids.leavePolicy, TENANT, ids.leaveType, ACTOR]],
    ["INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by) VALUES ($1, $2, $3, 'W6A Employee', $4, $5, '2020-01-01', $6, $6)", [ids.employee, TENANT, `W6A-${tag}`, randomUUID(), randomUUID(), ACTOR]],
    ["INSERT INTO lifecycle.hrms_property_returns (id, tenant_id, employee_id, item_description, created_by) VALUES ($1, $2, $3, 'laptop', $4)", [ids.propertyReturn, TENANT, ids.employee, ACTOR]],
    ["INSERT INTO lifecycle.hrms_onboarding_tasks (id, tenant_id, employee_id, title, due_by_day, created_by) VALUES ($1, $2, $3, 'W6A task', 1, $4)", [ids.onboardingTask, TENANT, ids.employee, ACTOR]],
    ["INSERT INTO recruitment.hrms_job_openings (id, tenant_id, title, department_id, ref_no, created_by, updated_by) VALUES ($1, $2, 'W6A opening', $3, $4, $5, $5)", [ids.jobOpening, TENANT, randomUUID(), `W6A/${tag}`, ACTOR]],
    ["INSERT INTO training.lms_enrollments (id, tenant_id, course_id, employee_id) VALUES ($1, $2, $3, $4)", [ids.enrollment, TENANT, randomUUID(), ids.employee]],
  ]);
});

afterAll(async () => {
  await asTenant(TENANT, [
    ["DELETE FROM training.lms_enrollments WHERE tenant_id = $1", [TENANT]],
    ["DELETE FROM recruitment.hrms_job_openings WHERE tenant_id = $1", [TENANT]],
    ["DELETE FROM lifecycle.hrms_onboarding_tasks WHERE tenant_id = $1", [TENANT]],
    ["DELETE FROM lifecycle.hrms_property_returns WHERE tenant_id = $1", [TENANT]],
    ["DELETE FROM employee.hrms_employees WHERE tenant_id = $1", [TENANT]],
    ["DELETE FROM leave.hrms_leave_policy_rules WHERE tenant_id = $1", [TENANT]],
    ["DELETE FROM leave.hrms_leave_types WHERE tenant_id = $1", [TENANT]],
    ["DELETE FROM employee.hrms_employee_types WHERE tenant_id = $1", [TENANT]],
  ]).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

type Method = "POST" | "PATCH" | "PUT";
type Case = { name: string; method: Method; url: (id: string) => string; realId: () => string; payload: Record<string, unknown>; ok: number; publishes: boolean };
const cases: Case[] = [
  { name: "employee-types PATCH", method: "PATCH", url: (id) => `/v1/hrms/employee-types/${id}`, realId: () => ids.employeeType, payload: { name: "W6A renamed" }, ok: 200, publishes: true },
  { name: "job-openings auto-screen", method: "POST", url: (id) => `/v1/hrms/job-openings/${id}/auto-screen`, realId: () => ids.jobOpening, payload: {}, ok: 200, publishes: true },
  { name: "job-openings shortlist freeze", method: "POST", url: (id) => `/v1/hrms/job-openings/${id}/shortlist/freeze`, realId: () => ids.jobOpening, payload: {}, ok: 200, publishes: true },
  { name: "job-openings qualification-requirement PUT", method: "PUT", url: (id) => `/v1/hrms/job-openings/${id}/qualification-requirement`, realId: () => ids.jobOpening, payload: { minTotalYears: 2 }, ok: 200, publishes: true },
  { name: "admin leave-policies PATCH", method: "PATCH", url: (id) => `/v1/hrms/admin/leave-policies/${id}`, realId: () => ids.leavePolicy, payload: {}, ok: 202, publishes: true },
  { name: "property-returns return", method: "PATCH", url: (id) => `/v1/hrms/property-returns/${id}/return`, realId: () => ids.propertyReturn, payload: {}, ok: 200, publishes: true },
  { name: "onboarding-tasks complete", method: "PATCH", url: (id) => `/v1/hrms/onboarding-tasks/${id}/complete`, realId: () => ids.onboardingTask, payload: {}, ok: 200, publishes: true },
  { name: "onboarding-documents mark-received", method: "PATCH", url: (id) => `/v1/hrms/employees/${id}/onboarding-documents/aadhaar/mark-received`, realId: () => ids.employee, payload: {}, ok: 200, publishes: true },
  { name: "onboarding-documents verify", method: "PATCH", url: (id) => `/v1/hrms/employees/${id}/onboarding-documents/aadhaar/verify`, realId: () => ids.employee, payload: {}, ok: 200, publishes: true },
  { name: "lms enrollment complete", method: "POST", url: (id) => `/v1/hrms/lms/enrollments/${id}/complete`, realId: () => ids.enrollment, payload: { score: 80 }, ok: 200, publishes: false },
];

describe("UAT W6-A: hrms command routes answer 404 for a record that does not exist", () => {
  for (const c of cases) {
    it(`${c.name}: random id -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: c.method, url: c.url(randomUUID()), headers: hdr(), payload: c.payload });
        expect(res.statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: another tenant's real id -> 404, nothing published`, async () => {
      const spy = vi.spyOn(queue, "publish");
      try {
        const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: hdr(OTHER_TENANT), payload: c.payload });
        expect(res.statusCode).toBe(404);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it(`${c.name}: real id -> ${c.ok}${c.publishes ? " and the command is published" : ""}`, async () => {
      const spy = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
      try {
        const res = await app.inject({ method: c.method, url: c.url(c.realId()), headers: hdr(), payload: c.payload });
        expect(res.statusCode).toBe(c.ok);
        if (c.publishes) {
          expect(spy).toHaveBeenCalledTimes(1);
          expect(spy.mock.calls[0]![1]).toMatchObject({ tenantId: TENANT });
        }
      } finally {
        spy.mockRestore();
      }
    });
  }
});

describe("UAT W6-A (P10): malformed / unknown path params on GET", () => {
  it("GET /ai/plugins/:pluginId/stats: malformed slug -> 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/ai/plugins/NOT%20A%20SLUG/stats", headers: hdr() });
    expect(res.statusCode).toBe(400);
  });

  it("GET /ai/plugins/:pluginId/stats: unknown plugin -> 404 (was 200 with empty stats)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/ai/plugins/not-a-uuid/stats", headers: hdr() });
    expect(res.statusCode).toBe(404);
  });

  it("GET /ai/plugins/:pluginId/stats: a registered plugin -> 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/ai/plugins/face-verification/stats", headers: hdr() });
    expect(res.statusCode).toBe(200);
  });

  it("GET /devices/:deviceId/activity: too-short id -> 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/devices/abc/activity", headers: hdr() });
    expect(res.statusCode).toBe(400);
  });

  it("GET /devices/:deviceId/activity: unregistered device -> 404 (was 200 [])", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/devices/not-a-uuid/activity", headers: hdr() });
    expect(res.statusCode).toBe(404);
  });
});
