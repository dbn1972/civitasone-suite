/**
 * S8 G7 on a REAL migrated Postgres (project migrations through 0029), through
 * buildApp() and the real consumers on the memory queue. Covers employee
 * membership (with / without a login, userId membership unchanged) and the
 * project-manager access rule: totals only, never individual pay.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";

const H = vi.hoisted(() => ({ exists: true, down: false }));
vi.mock("../src/shared/hrms-client.js", () => ({
  HrmsUnavailableError: class HrmsUnavailableError extends Error {},
  verifyEmployeeExists: vi.fn(async () => {
    if (H.down) { const { HrmsUnavailableError } = await import("../src/shared/hrms-client.js"); throw new HrmsUnavailableError("down"); }
    return H.exists;
  }),
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerProjectConsumers } from "../src/modules/project/consumer.js";
import { registerStaffCostConsumers } from "../src/modules/staff-cost/consumer.js";
import { CONSUMED_EVENTS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string; // set by the service vitest.config.ts
const TENANT = randomUUID(), OTHER = randomUUID();
const ADMIN = randomUUID(), PM1 = randomUUID(), PM2 = randomUUID(), FIN = randomUUID(), OFFICER = randomUUID(), EMP_USER = randomUUID(), AUD = randomUUID();
const EMP_A = randomUUID(), EMP_B = randomUUID();
const CC = randomUUID();
const auth = (sub: string, roles: string[], tenant = TENANT) => ({ authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "g7" }, SECRET)}` });
const as = {
  admin: auth(ADMIN, ["project_manager", "super_admin"]), pm1: auth(PM1, ["project_manager"]), pm2: auth(PM2, ["project_manager"]),
  fin: auth(FIN, ["finance_officer"]), officer: auth(OFFICER, ["project_officer"]), employee: auth(EMP_USER, ["employee"]), aud: auth(AUD, ["audit_officer"]),
  payroll: auth(randomUUID(), ["payroll_officer"]),
};
type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);
const q = (text: ReturnType<typeof sql>, tenant = TENANT) =>
  withTenantScope(db as never, tenant, async (tx: { execute: (x: unknown) => Promise<unknown> }) => rowsOf(await tx.execute(text)));
const mq = () => queue as unknown as MemoryQueue;
let app: Awaited<ReturnType<typeof buildApp>>;
let P1 = "", P2 = "";

async function createProject(code: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/v1/projects", headers: as.admin, payload: { code, name: `Project ${code}`, ...extra } });
  expect(r.statusCode).toBe(202);
  await mq().drain();
  return r.json().id as string;
}
const addMember = (projectId: string, body: Record<string, unknown>, headers = as.admin) =>
  app.inject({ method: "POST", url: `/v1/projects/${projectId}/members`, headers, payload: body });
const publishPosted = (payload: unknown, tenantId = TENANT, messageId = randomUUID()) =>
  queue.publish(CONSUMED_EVENTS.projectCostPosted, { messageId, type: CONSUMED_EVENTS.projectCostPosted, tenantId, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0", payload } as never);
const posting = (projectId: string, month: string, gross: string, employer: string, heads: number) =>
  ({ projectId, costMonth: month, grossMinor: gross, employerCostMinor: employer, totalCostMinor: (BigInt(gross) + BigInt(employer)).toString(), headcount: heads });

beforeAll(async () => {
  const raw = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    raw(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerProjectConsumers(queue);
  registerStaffCostConsumers(queue);
  app = await buildApp();
  P1 = await createProject("DIGILOCKER", { costCenterId: CC });
  P2 = await createProject("UMANG");
});
afterAll(async () => { await app?.close(); await sqlClient.end(); });

describe("project membership by employee (with or without a login)", () => {
  it("userId-only membership works exactly as before (existing tenants)", async () => {
    const u = randomUUID();
    const r = await addMember(P1, { userId: u, role: "engineer" });
    expect(r.statusCode).toBe(202);
    await mq().drain();
    expect((await addMember(P1, { userId: u, role: "engineer" })).statusCode).toBe(409);
    const list = (await app.inject({ method: "GET", url: `/v1/projects/${P1}/members`, headers: as.admin })).json().data as Row[];
    expect(list.find((m) => m.userId === u)).toMatchObject({ employeeId: null, role: "engineer" });
  });

  it("an HRMS employee with NO login can be a member; the same employee twice is a 409", async () => {
    const r = await addMember(P1, { employeeId: EMP_A, role: "engineer" });
    expect(r.statusCode).toBe(202);
    await mq().drain();
    const list = (await app.inject({ method: "GET", url: `/v1/projects/${P1}/members`, headers: as.admin })).json().data as Row[];
    expect(list.find((m) => m.employeeId === EMP_A)).toMatchObject({ userId: null, role: "engineer" });
    expect((await addMember(P1, { employeeId: EMP_A, role: "viewer" })).statusCode).toBe(409);
    // the same employee may sit on another project
    expect((await addMember(P2, { employeeId: EMP_A, role: "engineer" })).statusCode).toBe(202);
    await mq().drain();
  });

  it("an employee WITH a login can carry both ids", async () => {
    expect((await addMember(P1, { userId: PM1, employeeId: EMP_B, role: "project_manager" })).statusCode).toBe(202);
    await mq().drain();
    const m = (await q(sql`SELECT user_id, employee_id FROM project.project_members WHERE project_id = ${P1}::uuid AND employee_id = ${EMP_B}::uuid`))[0]!;
    expect(m).toMatchObject({ user_id: PM1, employee_id: EMP_B });
  });

  it("validation: needs an id; a member without a login cannot be the project manager; unknown employee 404; HRMS down 503", async () => {
    expect((await addMember(P1, { role: "viewer" })).statusCode).toBe(400);
    expect((await addMember(P1, { employeeId: randomUUID(), role: "project_manager" })).statusCode).toBe(400);
    H.exists = false;
    expect((await addMember(P1, { employeeId: randomUUID(), role: "viewer" })).statusCode).toBe(404);
    H.exists = true; H.down = true;
    expect((await addMember(P1, { employeeId: randomUUID(), role: "viewer" })).statusCode).toBe(503);
    H.down = false;
    // roles: a viewer cannot add members
    expect((await addMember(P1, { employeeId: randomUUID() }, as.employee)).statusCode).toBe(403);
  });

  it("the database refuses a member with neither id", async () => {
    await expect(q(sql`INSERT INTO project.project_members (project_id, tenant_id, role, created_by, updated_by)
      VALUES (${P1}::uuid, ${TENANT}::uuid, 'viewer', ${ADMIN}::uuid, ${ADMIN}::uuid)`)).rejects.toThrow();
  });

  it("an employee member can be removed", async () => {
    const id = (await q(sql`SELECT id FROM project.project_members WHERE project_id = ${P2}::uuid AND employee_id = ${EMP_A}::uuid`))[0]!.id as string;
    expect((await app.inject({ method: "DELETE", url: `/v1/projects/${P2}/members/${id}`, headers: as.admin })).statusCode).toBe(202);
    await mq().drain();
    expect(await q(sql`SELECT 1 FROM project.project_members WHERE id = ${id}::uuid`)).toHaveLength(0);
  });
});

describe("project -> cost centre", () => {
  it("a project carries its cost centre (create and update) and the costing index lists it without any pay data", async () => {
    expect((await app.inject({ method: "PATCH", url: `/v1/projects/${P2}`, headers: as.admin, payload: { costCenterId: CC } })).statusCode).toBe(202);
    await mq().drain();
    for (const h of [as.payroll, as.officer, as.fin]) {
      const r = await app.inject({ method: "GET", url: "/v1/projects/costing-index", headers: h });
      expect(r.statusCode).toBe(200);
      const byCode = Object.fromEntries((r.json().data as Row[]).map((x) => [x.code as string, x]));
      expect(byCode.DIGILOCKER).toMatchObject({ projectId: P1, costCenterId: CC });
      expect(byCode.UMANG).toMatchObject({ costCenterId: CC });
      expect(Object.keys(byCode.UMANG!).sort()).toEqual(["code", "costCenterId", "name", "projectId", "status"]);
    }
    expect((await app.inject({ method: "GET", url: "/v1/projects/costing-index", headers: as.employee })).statusCode).toBe(403);
  });
});

describe("project manager: cost TOTALS only, never individual pay", () => {
  const URL = (id: string, q = "from=2026-04&to=2026-12") => `/v1/projects/${id}/staff-cost?${q}`;
  const NEVER = /employee|salary|slip|userId|pan|bank/i;

  it("totals come from payroll's aggregate feed, summed by month; a reclass adds money but no people", async () => {
    const run1 = randomUUID(), run2 = randomUUID(), rc = randomUUID();
    await publishPosted({ kind: "run", sourceId: run1, postings: [posting(P1, "2026-09", "1000000", "120000", 4)] });
    await publishPosted({ kind: "run", sourceId: run2, postings: [posting(P1, "2026-10", "2000000", "240000", 5), posting(P2, "2026-10", "500", "0", 1)] });
    await publishPosted({ kind: "reclass", sourceId: rc, postings: [posting(P1, "2026-09", "250000", "30000", 0)] });
    await mq().drain();
    const r = await app.inject({ method: "GET", url: URL(P1), headers: as.pm1 });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.periods).toEqual([
      { period: "2026-09", grossMinor: "1250000", employerCostMinor: "150000", totalCostMinor: "1400000", headcount: 4 },
      { period: "2026-10", grossMinor: "2000000", employerCostMinor: "240000", totalCostMinor: "2240000", headcount: 5 },
    ]);
    expect(b.totals).toEqual({ grossMinor: "3250000", employerCostMinor: "390000", totalCostMinor: "3640000" });
    // the response has exactly these fields: nothing that could carry a person's pay
    expect(Object.keys(b).sort()).toEqual(["currency", "from", "periods", "projectCode", "projectId", "to", "totals"]);
    expect(Object.keys(b.periods[0]).sort()).toEqual(["employerCostMinor", "grossMinor", "headcount", "period", "totalCostMinor"]);
    expect(JSON.stringify(b)).not.toMatch(NEVER);
    expect(JSON.stringify(b)).not.toContain(EMP_A);
    // another project's postings are not mixed in
    expect((await app.inject({ method: "GET", url: URL(P2), headers: as.admin })).json().totals.totalCostMinor).toBe("500");
  });

  it("is idempotent: redelivery of the same posting does not double count", async () => {
    const src = randomUUID();
    await publishPosted({ kind: "run", sourceId: src, postings: [posting(P2, "2026-11", "100", "10", 1)] });
    await publishPosted({ kind: "run", sourceId: src, postings: [posting(P2, "2026-11", "100", "10", 1)] });
    await mq().drain();
    expect((await app.inject({ method: "GET", url: URL(P2, "from=2026-11&to=2026-11"), headers: as.admin })).json().totals.totalCostMinor).toBe("110");
  });

  it("only the project's own manager (member with role project_manager) can open it; a global role alone is not enough", async () => {
    expect((await app.inject({ method: "GET", url: URL(P1), headers: as.pm1 })).statusCode).toBe(200);   // PM1 is P1's manager
    expect((await app.inject({ method: "GET", url: URL(P2), headers: as.pm1 })).statusCode).toBe(403);   // ... not P2's
    expect((await app.inject({ method: "GET", url: URL(P1), headers: as.pm2 })).statusCode).toBe(403);   // PM2 manages nothing
    expect((await app.inject({ method: "GET", url: URL(P1), headers: as.officer })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: URL(P1), headers: as.employee })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: URL(P1), headers: as.payroll })).statusCode).toBe(403);
    // an engineer member of the project is a member, not its manager
    const eng = randomUUID();
    await addMember(P1, { userId: eng, role: "engineer" }); await mq().drain();
    expect((await app.inject({ method: "GET", url: URL(P1), headers: auth(eng, ["project_officer"]) })).statusCode).toBe(403);
    // finance and audit read any project's totals; unknown project 404
    expect((await app.inject({ method: "GET", url: URL(P2), headers: as.fin })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: URL(P2), headers: as.aud })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: URL(randomUUID()), headers: as.admin })).statusCode).toBe(404);
  });

  it("validates the period; tenant isolation holds", async () => {
    expect((await app.inject({ method: "GET", url: URL(P1, "from=2026-13&to=2026-12"), headers: as.admin })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: URL(P1, "from=2026-12&to=2026-01"), headers: as.admin })).statusCode).toBe(400);
    const other = auth(randomUUID(), ["super_admin"], OTHER);
    expect((await app.inject({ method: "GET", url: URL(P1), headers: other })).statusCode).toBe(404);
    expect(await q(sql`SELECT 1 FROM project.project_staff_cost_postings`, OTHER)).toHaveLength(0);
  });

  it("the table cannot hold a person: a payload with employee data is rejected whole, nothing stored", async () => {
    const before = (await q(sql`SELECT count(*)::int AS n FROM project.project_staff_cost_postings`))[0]!.n;
    await publishPosted({ kind: "run", sourceId: randomUUID(), postings: [{ ...posting(P1, "2026-12", "9", "1", 1), employeeId: EMP_A }] });
    await publishPosted({ kind: "run", sourceId: randomUUID(), postings: [posting(P1, "2026-12", "9", "9", 1)] }); // total != gross + employer -> not ours
    await mq().drain();
    expect((await q(sql`SELECT count(*)::int AS n FROM project.project_staff_cost_postings`))[0]!.n).toBe(before + 1);
    const cols = (await q(sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'project' AND table_name = 'project_staff_cost_postings'`)).map((c) => c.column_name as string);
    expect(cols.some((c) => NEVER.test(c))).toBe(false);
  });
});
