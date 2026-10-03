/**
 * GAP-HR-ONBOARDING-02 -- apply an onboarding template: tasks are created,
 * the joinee then shows on the tracker, applying twice (or concurrently)
 * never duplicates, and the audit event records what happened. Real DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withRawTenantGuc } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerOnboardingTemplateConsumers, DEFAULT_TEMPLATE_STEPS, stepsToTasks, stepsToAdd } from "../src/modules/lifecycle/onboarding-template.js";
import { registerF3_lifecycle_Consumers } from "../src/modules/lifecycle/f3-consumer.js";
import { hrmsOnboardingTasks } from "../src/modules/lifecycle/schema.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";

registerOnboardingTemplateConsumers(queue);
registerF3_lifecycle_Consumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const HR = randomUUID();
const deptId = randomUUID();
const desigId = randomUUID();
const TEMPLATE = randomUUID();
const OTHER_TEMPLATE = randomUUID();
const h = (roles: string[], extra: Record<string, string> = {}) => ({ authorization: `Bearer ${signToken({ sub: HR, tid: TENANT, roles, sid: "s" }, SECRET)}`, "content-type": "application/json", ...extra });
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) => runWithTenant(TENANT, () => db.transaction(fn));

let app: FastifyInstance;

async function seedEmployee(name: string, status = "probation"): Promise<string> {
  const id = randomUUID();
  await asTenant((tx) => tx.insert(hrmsEmployees).values({
    id, tenantId: TENANT, employeeNo: `OB-${id.slice(0, 8)}`, fullName: name, departmentId: deptId, designationId: desigId,
    dateOfJoining: "2026-03-01", status, employeeType: "permanent", basicMinor: 5_000_000n, createdBy: HR, updatedBy: HR,
  }));
  return id;
}
const tasks = (emp: string) => asTenant((tx) => tx.select().from(hrmsOnboardingTasks).where(and(eq(hrmsOnboardingTasks.tenantId, TENANT), eq(hrmsOnboardingTasks.employeeId, emp))));
const apply = (emp: string, payload: Record<string, unknown> = {}, headers = h(["hr_officer"])) =>
  app.inject({ method: "POST", url: `/v1/hrms/employees/${emp}/onboarding/apply-template`, headers, payload });
async function audits(emp: string) {
  const rows = await withRawTenantGuc(sqlClient, TENANT, (s) => s`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND payload->>'resourceType' = 'onboarding' AND payload->>'resourceId' = ${emp} ORDER BY created_at`);
  return rows.map((r) => r.payload as { action: string; metadata: Record<string, number | string> });
}

beforeAll(async () => {
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: `O${TENANT.slice(0, 6)}`, name: "Dept", createdBy: HR, updatedBy: HR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: `OD${TENANT.slice(0, 6)}`, name: "Desig", createdBy: HR, updatedBy: HR });
  });
  const steps = JSON.stringify([
    { title: "Collect laptop", dueDays: 2 },
    { title: "collect laptop", dueDays: 9 },               // duplicate of the first (case-insensitive)
    { title: "Sign the secrecy undertaking", dueDays: 9999 }, // out-of-range due day -> default 7
    { title: "   " },                                       // blank -> dropped
    { title: "Visit the accounts section" },                // no due day -> default 7
  ]);
  await withRawTenantGuc(sqlClient, TENANT, (s) => s`INSERT INTO employee.onboarding_templates (id, tenant_id, name, steps, created_by) VALUES (${TEMPLATE}, ${TENANT}, 'IT joiners', ${steps}::jsonb, ${HR})`);
  await withRawTenantGuc(sqlClient, OTHER, (s) => s`INSERT INTO employee.onboarding_templates (id, tenant_id, name, steps, created_by) VALUES (${OTHER_TEMPLATE}, ${OTHER}, 'Other tenant', '[{"title":"x"}]'::jsonb, ${HR})`);
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(hrmsOnboardingTasks).where(eq(hrmsOnboardingTasks.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  });
  await withRawTenantGuc(sqlClient, TENANT, (s) => s`DELETE FROM employee.onboarding_templates WHERE tenant_id = ${TENANT}`);
  await withRawTenantGuc(sqlClient, OTHER, (s) => s`DELETE FROM employee.onboarding_templates WHERE tenant_id = ${OTHER}`);
  await app.close();
  await sqlClient.end();
});

describe("pure template shaping", () => {
  it("clamps due days, drops blanks and case-insensitive duplicates", () => {
    expect(stepsToTasks([{ title: " A ", dueDays: 3 }, { title: "a" }, { title: "" }, { title: "B", dueDays: 0 }, { title: "C", dueDays: 400 }, { title: "D", dueDays: 365 }, "x", null]))
      .toEqual([{ title: "A", dueByDay: 3 }, { title: "B", dueByDay: 7 }, { title: "C", dueByDay: 7 }, { title: "D", dueByDay: 365 }]);
    expect(stepsToTasks("nope")).toEqual([]);
  });
  it("only adds steps the employee does not already have", () => {
    expect(stepsToAdd([{ title: "A", dueByDay: 1 }, { title: "B", dueByDay: 2 }], ["a "])).toEqual([{ title: "B", dueByDay: 2 }]);
  });
});

describe("GET /v1/hrms/onboarding/templates", () => {
  it("lists the platform default plus this tenant's templates only", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/onboarding/templates", headers: h(["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    const data = (r.json() as { data: Array<{ id: string; name: string; stepCount: number; isDefault: boolean }> }).data;
    expect(data[0]).toMatchObject({ id: "default", isDefault: true, stepCount: DEFAULT_TEMPLATE_STEPS.length });
    expect(data.find((d) => d.id === TEMPLATE)).toMatchObject({ name: "IT joiners", stepCount: 3 });
    expect(data.some((d) => d.id === OTHER_TEMPLATE)).toBe(false);
    expect((await app.inject({ method: "GET", url: "/v1/hrms/onboarding/templates", headers: h(["employee"]) })).statusCode).toBe(403);
  });
});

describe("apply-template", () => {
  it("default template: creates the checklist, and the joinee then appears on the tracker with that many tasks", async () => {
    const emp = await seedEmployee("New Joiner");
    expect((await tasks(emp)).length).toBe(0);
    const r = await apply(emp);
    expect(r.statusCode).toBe(202);
    expect((r.json() as { stepCount: number }).stepCount).toBe(DEFAULT_TEMPLATE_STEPS.length);
    await drain();
    expect((await tasks(emp)).length).toBe(DEFAULT_TEMPLATE_STEPS.length);
    const tracker = (await app.inject({ method: "GET", url: "/v1/hrms/onboarding", headers: h(["hr_officer"]) })).json() as { data: Array<{ id: string; totalSteps: string }> };
    expect(tracker.data.find((x) => x.id === emp)?.totalSteps).toBe(String(DEFAULT_TEMPLATE_STEPS.length));
  });

  it("applying the SAME template again adds nothing (no duplicates) and the audit says so", async () => {
    const emp = await seedEmployee("Twice");
    await apply(emp); await drain();
    await apply(emp); await drain();
    expect((await tasks(emp)).length).toBe(DEFAULT_TEMPLATE_STEPS.length);
    const a = await audits(emp);
    expect(a.map((x) => x.action)).toEqual(["apply_template", "apply_template"]);
    expect(a[0]!.metadata).toMatchObject({ tasksAdded: DEFAULT_TEMPLATE_STEPS.length, tasksSkipped: 0 });
    expect(a[1]!.metadata).toMatchObject({ tasksAdded: 0, tasksSkipped: DEFAULT_TEMPLATE_STEPS.length });
  });

  it("a stored template creates its (cleaned) steps with clamped due days; overlap with existing tasks is skipped", async () => {
    const emp = await seedEmployee("Custom");
    expect((await apply(emp, { templateId: TEMPLATE })).statusCode).toBe(202);
    await drain();
    const rows = (await tasks(emp)).sort((a, b) => a.title.localeCompare(b.title));
    expect(rows.map((t) => [t.title, t.dueByDay])).toEqual([["Collect laptop", 2], ["Sign the secrecy undertaking", 7], ["Visit the accounts section", 7]]);
    expect(rows.every((t) => t.status === "pending")).toBe(true);
  });

  it("concurrent applications (an HR double click, two officers at once) still create each task exactly once", async () => {
    const emp = await seedEmployee("Racer");
    const rs = await Promise.all(Array.from({ length: 6 }, () => apply(emp, { templateId: TEMPLATE })));
    expect(rs.every((r) => r.statusCode === 202)).toBe(true);
    await drain();
    const titles = (await tasks(emp)).map((t) => t.title);
    expect(titles.length).toBe(3);
    expect(new Set(titles).size).toBe(3);
  });

  it("the same x-idempotency-key twice is one command", async () => {
    const emp = await seedEmployee("Idem");
    const hh = h(["hr_officer"], { "x-idempotency-key": `k-${randomUUID()}` });
    await apply(emp, {}, hh); await apply(emp, {}, hh);
    await drain();
    expect((await audits(emp)).length).toBe(1);
  });

  it("refuses: an exited employee (409), an unknown employee (404), another tenant's template (404), a non-HR role (403), a malformed id (400)", async () => {
    const gone = await seedEmployee("Gone", "separated");
    expect((await apply(gone)).statusCode).toBe(409);
    expect((await apply(randomUUID())).statusCode).toBe(404);
    const emp = await seedEmployee("Scope");
    expect((await apply(emp, { templateId: OTHER_TEMPLATE })).statusCode).toBe(404);
    expect((await apply(emp, {}, h(["manager"]))).statusCode).toBe(403);
    expect((await apply(emp, { templateId: "nope" })).statusCode).toBe(400);
    expect((await tasks(emp)).length).toBe(0);
  });
});
