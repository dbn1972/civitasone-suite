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
const publishPosted = (postings: unknown[], opts: { asOf?: string; minCohort?: number } = {}, tenantId = TENANT, messageId = randomUUID()) =>
  queue.publish(CONSUMED_EVENTS.projectCostPosted, { messageId, type: CONSUMED_EVENTS.projectCostPosted, tenantId, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { asOf: opts.asOf ?? new Date().toISOString(), minCohort: opts.minCohort ?? 3, postings } } as never);
const posting = (projectId: string, month: string, gross: string, employer: string, cohort: number) =>
  ({ projectId, costMonth: month, grossMinor: gross, employerCostMinor: employer, totalCostMinor: (BigInt(gross) + BigInt(employer)).toString(), cohort });

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
  const T0 = "2026-11-01T00:00:00.000Z", T1 = "2026-11-02T00:00:00.000Z", T2 = "2026-11-03T00:00:00.000Z";

  it("shows months with >= 3 people, hides months with 1 or 2 (no amounts, no headcount), and totals add up the visible months only", async () => {
    await publishPosted([
      posting(P1, "2026-09", "1000000", "120000", 4),   // visible
      posting(P1, "2026-10", "777777", "0", 1),         // ONE person: hidden
      posting(P1, "2026-11", "500000", "60000", 2),     // two people: hidden
      posting(P1, "2026-12", "3000000", "360000", 3),   // exactly 3: visible
      posting(P2, "2026-10", "500", "0", 1),
    ], { asOf: T0 });
    await mq().drain();
    const r = await app.inject({ method: "GET", url: URL(P1), headers: as.pm1 });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.periods).toEqual([
      { period: "2026-09", suppressed: false, grossMinor: "1000000", employerCostMinor: "120000", totalCostMinor: "1120000", headcount: 4 },
      { period: "2026-10", suppressed: true, reason: "MIN_COHORT" },
      { period: "2026-11", suppressed: true, reason: "MIN_COHORT" },
      { period: "2026-12", suppressed: false, grossMinor: "3000000", employerCostMinor: "360000", totalCostMinor: "3360000", headcount: 3 },
    ]);
    // the range total covers the visible months only, so (total - visible months) is 0, never a hidden month
    expect(b.totals).toEqual({ scope: "visible_periods", grossMinor: "4000000", employerCostMinor: "480000", totalCostMinor: "4480000" });
    expect(b.suppressedPeriods).toBe(2);
    expect(Object.keys(b).sort()).toEqual(["currency", "from", "periods", "projectCode", "projectId", "suppressedPeriods", "to", "totals"]);
    expect(r.body).not.toContain("777777");
    expect(r.body).not.toMatch(NEVER);
    expect(r.body).not.toContain(EMP_A);
  });

  it("asking for just the hidden month shows nothing about it", async () => {
    const b = (await app.inject({ method: "GET", url: URL(P1, "from=2026-10&to=2026-10"), headers: as.pm1 })).json();
    expect(b.periods).toEqual([{ period: "2026-10", suppressed: true, reason: "MIN_COHORT" }]);
    expect(b.totals).toEqual({ scope: "visible_periods", grossMinor: "0", employerCostMinor: "0", totalCostMinor: "0" });
  });

  it("the threshold travels with the snapshot: 4 hides a 3-person month, 2 shows a 2-person month, and it is never below 2", async () => {
    await publishPosted([posting(P2, "2026-09", "900", "100", 3)], { asOf: T1, minCohort: 4 });
    await publishPosted([posting(P2, "2026-11", "800", "100", 2)], { asOf: T1, minCohort: 2 });
    await publishPosted([posting(P2, "2026-12", "700", "100", 1)], { asOf: T1, minCohort: 2 });
    await mq().drain();
    const b = (await app.inject({ method: "GET", url: URL(P2), headers: as.fin })).json();
    const by = (m: string) => b.periods.find((x: Row) => x.period === m);
    expect(by("2026-09").suppressed).toBe(true);
    expect(by("2026-11")).toMatchObject({ suppressed: false, headcount: 2 });
    expect(by("2026-12").suppressed).toBe(true); // 1 person is hidden whatever the setting says
    // a snapshot that tries to lower the threshold below 2 is refused whole
    const before = (await q(sql`SELECT count(*)::int AS n FROM project.project_staff_cost_postings`))[0]!.n;
    await publishPosted([posting(P2, "2026-08", "5", "5", 1)], { asOf: T2, minCohort: 1 });
    await mq().drain();
    expect((await q(sql`SELECT count(*)::int AS n FROM project.project_staff_cost_postings`))[0]!.n).toBe(before);
    // and the database floor is 2 as well
    await expect(q(sql`UPDATE project.project_staff_cost_postings SET min_cohort = 1`)).rejects.toThrow();
  });

  it("a snapshot replaces the previous one, an older one is ignored, a repeat changes nothing", async () => {
    await publishPosted([posting(P2, "2026-07", "100", "10", 5)], { asOf: T1 });
    await publishPosted([posting(P2, "2026-07", "999", "1", 5)], { asOf: T0 }); // older: ignored
    await publishPosted([posting(P2, "2026-07", "100", "10", 5)], { asOf: T1 }); // repeat
    await mq().drain();
    expect((await app.inject({ method: "GET", url: URL(P2, "from=2026-07&to=2026-07"), headers: as.admin })).json().totals.totalCostMinor).toBe("110");
    await publishPosted([posting(P2, "2026-07", "300", "30", 5)], { asOf: T2 });  // newer: replaces (a reclass moved money)
    await mq().drain();
    expect((await app.inject({ method: "GET", url: URL(P2, "from=2026-07&to=2026-07"), headers: as.admin })).json().totals.totalCostMinor).toBe("330");
  });

  it("pay-detail roles are exempt: super_admin sees the hidden month", async () => {
    const b = (await app.inject({ method: "GET", url: URL(P1, "from=2026-10&to=2026-10"), headers: as.admin })).json();
    expect(b.periods[0]).toMatchObject({ suppressed: false, grossMinor: "777777", headcount: 1 });
  });

  it("only the project's own manager (member with role project_manager) can open it; a global role is not enough", async () => {
    expect((await app.inject({ method: "GET", url: URL(P1), headers: as.pm1 })).statusCode).toBe(200);   // PM1 is P1's manager
    expect((await app.inject({ method: "GET", url: URL(P2), headers: as.pm1 })).statusCode).toBe(403);   // ... not P2's
    expect((await app.inject({ method: "GET", url: URL(P1), headers: as.pm2 })).statusCode).toBe(403);   // PM2 manages nothing
    expect((await app.inject({ method: "GET", url: URL(P1), headers: as.officer })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: URL(P1), headers: as.employee })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: URL(P1), headers: as.payroll })).statusCode).toBe(403);
    const eng = randomUUID();
    await addMember(P1, { userId: eng, role: "engineer" }); await mq().drain();
    expect((await app.inject({ method: "GET", url: URL(P1), headers: auth(eng, ["project_officer"]) })).statusCode).toBe(403);
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

  it("the table cannot hold a person: a payload carrying employee data, or an inconsistent total, is rejected whole", async () => {
    const before = (await q(sql`SELECT count(*)::int AS n FROM project.project_staff_cost_postings`))[0]!.n;
    await publishPosted([{ ...posting(P1, "2026-06", "9", "1", 5), employeeId: EMP_A }], { asOf: T2 });
    await publishPosted([{ ...posting(P1, "2026-06", "9", "9", 5), totalCostMinor: "1" }], { asOf: T2 });
    await mq().drain();
    expect((await q(sql`SELECT count(*)::int AS n FROM project.project_staff_cost_postings`))[0]!.n).toBe(before);
    const cols = (await q(sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'project' AND table_name = 'project_staff_cost_postings'`)).map((c) => c.column_name as string);
    expect(cols.some((c) => NEVER.test(c))).toBe(false);
  });
});

describe("appointing a project manager (self-promotion is closed)", () => {
  const OFFICER2 = randomUUID(), SOMEONE = randomUUID(), SOMEONE2 = randomUUID();
  const actions = async (action: string) => q(sql`SELECT actor_id, payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = 'audit.event.record' AND payload->>'action' = ${action} ORDER BY created_at`);
  let P3 = "";

  it("a project officer cannot make THEMSELVES manager, nor appoint anyone else as manager", async () => {
    P3 = await createProject("MYGOV");
    const officer = auth(OFFICER2, ["project_officer"]);
    expect((await addMember(P3, { userId: OFFICER2, role: "project_manager" }, officer)).statusCode).toBe(403);
    expect((await addMember(P3, { userId: SOMEONE, role: "project_manager" }, officer)).statusCode).toBe(403);
    await mq().drain();
    expect(await q(sql`SELECT 1 FROM project.project_members WHERE project_id = ${P3}::uuid AND role = 'project_manager'`)).toHaveLength(0);
    // and therefore the cost totals stay closed to them
    expect((await app.inject({ method: "GET", url: `/v1/projects/${P3}/staff-cost?from=2026-04&to=2026-12`, headers: officer })).statusCode).toBe(403);
  });

  it("a super admin can appoint someone else, but not themselves", async () => {
    expect((await addMember(P3, { userId: ADMIN, role: "project_manager" }, as.admin)).statusCode).toBe(403);
    expect((await addMember(P3, { userId: PM2, role: "project_manager" }, as.admin)).statusCode).toBe(202);
    await mq().drain();
    expect((await app.inject({ method: "GET", url: `/v1/projects/${P3}/staff-cost?from=2026-04&to=2026-12`, headers: as.pm2 })).statusCode).toBe(200);
    const a = await actions("add");
    expect(a.some((x) => (x.payload as Row).role === "project_manager" && x.actor_id === ADMIN)).toBe(true);
  });

  it("the project's manager can appoint another manager; a plain member cannot change anyone's role; nobody changes their own", async () => {
    expect((await addMember(P3, { userId: SOMEONE, role: "engineer" }, as.pm2)).statusCode).toBe(202);
    expect((await addMember(P3, { userId: OFFICER2, role: "project_officer" }, as.pm2)).statusCode).toBe(202);
    await mq().drain();
    const memberId = async (u: string) => (await q(sql`SELECT id FROM project.project_members WHERE project_id = ${P3}::uuid AND user_id = ${u}::uuid`))[0]!.id as string;
    const patch = (mid: string, role: string, headers: typeof as.pm2) => app.inject({ method: "PATCH", url: `/v1/projects/${P3}/members/${mid}`, headers, payload: { role } });
    // a project officer: cannot promote the engineer, cannot promote themselves
    expect((await patch(await memberId(SOMEONE), "project_manager", auth(OFFICER2, ["project_officer"]))).statusCode).toBe(403);
    expect((await patch(await memberId(OFFICER2), "project_manager", auth(OFFICER2, ["project_officer"]))).statusCode).toBe(403);
    // the manager cannot change their own role either
    expect((await patch(await memberId(PM2), "viewer", as.pm2)).json().code).toBe("SELF_ROLE_CHANGE");
    // ... but can promote someone else, and it is audited with before and after
    expect((await patch(await memberId(SOMEONE), "project_manager", as.pm2)).statusCode).toBe(202);
    await mq().drain();
    expect((await q(sql`SELECT role FROM project.project_members WHERE project_id = ${P3}::uuid AND user_id = ${SOMEONE}::uuid`))[0]!.role).toBe("project_manager");
    const ch = await actions("role_change");
    expect(ch).toHaveLength(1);
    expect(ch[0]!.actor_id).toBe(PM2);
    expect(ch[0]!.payload).toMatchObject({ from: "engineer", to: "project_manager", userId: SOMEONE });
    // an ordinary role change by a non-manager is fine for non-manager roles
    expect((await patch(await memberId(OFFICER2), "viewer", auth(randomUUID(), ["project_officer"]))).statusCode).toBe(202);
    // demoting a manager is a manager decision too
    expect((await patch(await memberId(SOMEONE), "viewer", auth(randomUUID(), ["project_officer"]))).statusCode).toBe(403);
  });

  it("a member without a login cannot become the manager by role change", async () => {
    await addMember(P3, { employeeId: EMP_A, role: "engineer" }, as.pm2); await mq().drain();
    const mid = (await q(sql`SELECT id FROM project.project_members WHERE project_id = ${P3}::uuid AND employee_id = ${EMP_A}::uuid`))[0]!.id as string;
    expect((await app.inject({ method: "PATCH", url: `/v1/projects/${P3}/members/${mid}`, headers: as.pm2, payload: { role: "project_manager" } })).statusCode).toBe(400);
  });

  it("commands that skip the route are refused by the consumer and audited as denied", async () => {
    const forged = SOMEONE2;
    await queue.publish("project.member.add", { messageId: randomUUID(), type: "project.member.add", tenantId: TENANT, actorId: forged, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), projectId: P3, tenantId: TENANT, userId: forged, employeeId: null, role: "project_manager", viaSuperAdmin: false } } as never);
    await mq().drain();
    expect(await q(sql`SELECT 1 FROM project.project_members WHERE project_id = ${P3}::uuid AND user_id = ${forged}::uuid`)).toHaveLength(0);
    const denied = await actions("member_add_denied");
    expect(denied.length).toBeGreaterThan(0);
    expect((denied[0]!.payload as Row).outcome).toBe("failure");
  });
});
