/**
 * S8 G7 - small-cohort suppression, on a REAL migrated Postgres. Owner rule:
 * a project manager never sees individual pay, and a one- or two-person total
 * is individual pay. A reader who may see totals but not people
 * (finance_officer) gets { suppressed: true } and NO amounts for any cell that
 * fewer than `minCohort` (default 3, never below 2) distinct people stand
 * behind - per month, per project, per cost centre, in JSON and CSV, on both
 * bases - and a hidden cell cannot be recovered by subtracting the visible ones.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";

vi.mock("../src/shared/hrms-client.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  verifyEmployeeExists: vi.fn(async () => true),
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerProjectCostingConsumers } from "../src/modules/project-costing/consumer.js";

const SECRET = process.env.JWT_SECRET as string; // set by the service vitest.config.ts
const TENANT = randomUUID();
const ADMIN = randomUUID(), OFFICER = randomUUID(), FINADMIN = randomUUID(), FINOFF = randomUUID(), PM = randomUUID();
const E = Array.from({ length: 10 }, () => randomUUID());
const [E1, E2, E3, E4, E5, E6, E7, E8, E9] = E as [string, string, string, string, string, string, string, string, string];
const P1 = randomUUID(), P2 = randomUUID(), P3 = randomUUID(), P4 = randomUUID();
const CC1 = randomUUID(), CC2 = randomUUID(), CC3 = randomUUID(), CC4 = randomUUID();
const BASE = "/v1/payroll/project-costing";
const auth = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "g7c" }, SECRET)}` });
const as = { admin: auth(ADMIN, ["payroll_admin"]), officer: auth(OFFICER, ["payroll_officer"]), finadmin: auth(FINADMIN, ["finance_admin"]), finoff: auth(FINOFF, ["finance_officer"]), pm: auth(PM, ["project_manager"]) };

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);
const q = (text: ReturnType<typeof sql>) => withTenantScope(db as never, TENANT, async (tx: { execute: (x: unknown) => Promise<unknown> }) => rowsOf(await tx.execute(text)));
const drain = () => (queue as unknown as MemoryQueue).drain();
let app: Awaited<ReturnType<typeof buildApp>>;
const get = (url: string, headers = as.finoff) => app.inject({ method: "GET", url, headers });
const post = (url: string, payload: unknown, headers = as.admin) => app.inject({ method: "POST", url, headers, payload: payload as never });

const UNIQUE_GROSS = 7_777_777n; // E1's pay: must never appear for a reader without pay-detail access

async function allocate(employeeId: string, projectId: string, cc: string, pct = 100) {
  await q(sql`INSERT INTO payroll.employee_cost_allocations (tenant_id, employee_id, target_type, project_id, cost_center_id, split_pct, effective_from, status, requested_by, decided_by, decided_at)
    VALUES (${TENANT}::uuid, ${employeeId}::uuid, 'project', ${projectId}::uuid, ${cc}::uuid, ${pct}, '2026-01-01', 'active', ${ADMIN}::uuid, ${FINADMIN}::uuid, now())`);
}
async function seedRun(month: string, slips: Array<{ employeeId: string; gross: bigint }>) {
  const runId = randomUUID();
  await q(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by)
    VALUES (${runId}::uuid, ${TENANT}::uuid, ${`R-${month}-${runId.slice(0, 4)}`}, ${month}, ${randomUUID()}::uuid, 'approved', ${ADMIN}::uuid, ${ADMIN}::uuid)`);
  for (const s of slips) {
    const id = randomUUID();
    await q(sql`INSERT INTO payroll.payroll_slips (id, tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, created_by, updated_by)
      VALUES (${id}::uuid, ${TENANT}::uuid, ${runId}::uuid, ${s.employeeId}::uuid, ${`E-${id.slice(0, 4)}`}, ${s.gross.toString()}::bigint, ${s.gross.toString()}::bigint, ${ADMIN}::uuid, ${ADMIN}::uuid)`);
    await q(sql`INSERT INTO statutory.payroll_pf (tenant_id, slip_id, employee_id, run_id, er_contrib_minor, period, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${id}::uuid, ${s.employeeId}::uuid, ${runId}::uuid, ${(s.gross / 10n).toString()}::bigint, ${month}, ${ADMIN}::uuid, ${ADMIN}::uuid)`);
  }
  expect((await post(`${BASE}/runs/${runId}/generate`, {})).statusCode).toBe(202);
  await drain();
  return runId;
}
const byProject = async (headers = as.finoff, qs = "from=2026-09&to=2026-10") =>
  (await get(`${BASE}/by-project?${qs}`, headers)).json() as { minCohort: number | null; data: Array<Row> };
const cell = (b: { data: Array<Row> }, project: string, period: string) => b.data.find((r) => r.projectId === project && r.period === period)!;

beforeAll(async () => {
  const raw = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    raw(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerProjectCostingConsumers(queue);
  app = await buildApp();
  expect((await app.inject({ method: "PUT", url: `${BASE}/settings`, headers: as.admin, payload: { enabled: true } })).statusCode).toBe(202);
  await drain();
  // P1: 1 person, P2: 2 people, P3: 3 people, everyone 100% on their project; E7-E9 are unallocated
  await allocate(E1, P1, CC1); await allocate(E2, P2, CC2); await allocate(E3, P2, CC2);
  for (const e of [E4, E5, E6]) await allocate(e, P3, CC3);
  await seedRun("2026-09", [{ employeeId: E1, gross: UNIQUE_GROSS }, ...[E2, E3, E4, E5, E6, E7, E8, E9].map((employeeId, i) => ({ employeeId, gross: 1_000_000n + BigInt(i) * 1_111n }))]);
  // October: only P1 (1 person) and P3 (3 people) are costed
  await seedRun("2026-10", [E1, E4, E5, E6].map((employeeId) => ({ employeeId, gross: 2_000_000n })));
  // November: P2 (2 people) and P3 (3 people) only, no single-person cell
  await seedRun("2026-11", [E2, E3, E4, E5, E6].map((employeeId) => ({ employeeId, gross: 1_500_000n })));
});
afterAll(async () => { await app?.close(); await sqlClient.end(); });

describe("headcount 1, 2 and 3 (default threshold 3)", () => {
  it("hides the 1- and 2-person projects, shows the 3-person one with its headcount", async () => {
    const b = await byProject(as.finoff, "from=2026-09&to=2026-09");
    expect(b.minCohort).toBe(3);
    for (const p of [P1, P2]) {
      const c = cell(b, p, "2026-09");
      expect(c).toEqual({ period: "2026-09", projectId: p, suppressed: true, reason: "MIN_COHORT" }); // no amounts, no headcount, nothing else
    }
    const c3 = cell(b, P3, "2026-09");
    expect(c3).toMatchObject({ suppressed: false, headcount: 3 });
    expect(BigInt(c3.grossMinor as string)).toBeGreaterThan(0n);
  });

  it("the hidden person's pay appears nowhere in the response", async () => {
    const res = await get(`${BASE}/by-project?from=2026-09&to=2026-10`, as.finoff);
    expect(res.body).not.toContain(UNIQUE_GROSS.toString());
    expect(res.body).not.toContain(E1);
  });

  it("pay-detail roles are unaffected: every cell visible with its true headcount", async () => {
    for (const h of [as.admin, as.officer, as.finadmin]) {
      const b = await byProject(h, "from=2026-09&to=2026-09");
      expect(b.minCohort).toBeNull();
      expect([P1, P2, P3].map((p) => cell(b, p, "2026-09")).map((c) => [c.suppressed, c.headcount])).toEqual([[false, 1], [false, 2], [false, 3]]);
      expect(cell(b, P1, "2026-09").grossMinor).toBe(UNIQUE_GROSS.toString());
    }
  });

  it("a project manager still gets 403 here (the role is not in any totals list)", async () => {
    expect((await get(`${BASE}/by-project?from=2026-09&to=2026-09`, as.pm)).statusCode).toBe(403);
  });
});

describe("the subtraction attack", () => {
  it("a lone hidden cell drags the smallest visible neighbour with it, so the hidden remainder covers >= 3 people", async () => {
    // October: P1 has 1 person, P3 has 3. Hiding P1 alone would let (known payroll total - P3) reveal E1's pay.
    const b = await byProject(as.finoff, "from=2026-10&to=2026-10");
    expect(cell(b, P1, "2026-10").suppressed).toBe(true);
    expect(cell(b, P3, "2026-10").suppressed).toBe(true);
    expect(JSON.stringify(b.data)).not.toMatch(/grossMinor/);
    // the people behind everything hidden in October
    const hidden = await q(sql`SELECT COUNT(DISTINCT employee_id)::int AS n FROM payroll.slip_cost_lines WHERE tenant_id = ${TENANT}::uuid AND cost_month = '2026-10' AND target_type = 'project'`);
    expect(hidden[0]!.n).toBeGreaterThanOrEqual(3);
  });

  it("September: the hidden P1 + P2 cover exactly 3 people, so P3 may stay visible", async () => {
    const b = await byProject(as.finoff, "from=2026-09&to=2026-09");
    expect(cell(b, P3, "2026-09").suppressed).toBe(false);
    const hiddenPeople = await q(sql`SELECT COUNT(DISTINCT employee_id)::int AS n FROM payroll.slip_cost_lines WHERE tenant_id = ${TENANT}::uuid AND cost_month = '2026-09' AND project_id IN (${P1}::uuid, ${P2}::uuid)`);
    expect(hiddenPeople[0]!.n).toBe(3);
  });

  it("cost-centre roll-ups follow the project cells: a cost centre with a hidden leaf is hidden; the unallocated bucket has its own rule", async () => {
    const r = (await get(`${BASE}/by-cost-center?from=2026-09&to=2026-09`, as.finoff)).json() as { data: Array<Row>; unallocated: Array<Row> };
    const by = (id: string) => r.data.find((x) => x.costCenterId === id)!;
    expect(by(CC1).suppressed).toBe(true);
    expect(by(CC2).suppressed).toBe(true);
    expect(by(CC3)).toMatchObject({ suppressed: false, headcount: 3 });
    expect(r.unallocated[0]).toMatchObject({ suppressed: false, headcount: 3 }); // E7, E8, E9
    // a cost centre cannot be differenced against a project report to expose a leaf: CC3 == P3 exactly
    const p3 = cell(await byProject(as.finoff, "from=2026-09&to=2026-09"), P3, "2026-09");
    expect(by(CC3).grossMinor).toBe(p3.grossMinor);
  });
});

describe("export and basis", () => {
  it("CSV: hidden rows have blank amounts and the figure is not in the file", async () => {
    const res = await get(`${BASE}/by-project?from=2026-09&to=2026-10&format=csv`, as.finoff);
    expect(res.statusCode).toBe(200);
    const lines = res.body.trim().split("\r\n");
    expect(lines[0]).toBe("period,projectId,suppressed,grossMinor,employerCostMinor,totalCostMinor,headcount");
    expect(lines.some((l) => l.startsWith("2026-09,") && l.includes(P1) && l.endsWith(",yes,,,,"))).toBe(true);
    expect(res.body).not.toContain(UNIQUE_GROSS.toString());
    const cc = await get(`${BASE}/by-cost-center?from=2026-09&to=2026-09&format=csv`, as.finoff);
    expect(cc.body).not.toContain(UNIQUE_GROSS.toString());
    // the exempt roles still get the amount in their export
    expect((await get(`${BASE}/by-project?from=2026-09&to=2026-09&format=csv`, as.finadmin)).body).toContain(UNIQUE_GROSS.toString());
  });

  it("basis=booked is closed to readers without pay-detail access (JSON and CSV); pay-detail roles still have it", async () => {
    for (const url of [`${BASE}/by-project?from=2026-09&to=2026-10&basis=booked`, `${BASE}/by-cost-center?from=2026-09&to=2026-10&basis=booked`, `${BASE}/by-project?from=2026-09&to=2026-10&basis=booked&format=csv`]) {
      const res = await get(url, as.finoff);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().code).toBe("BASIS_RESTRICTED");
    }
    expect((await get(`${BASE}/by-project?from=2026-09&to=2026-10&basis=booked`, as.finadmin)).statusCode).toBe(200);
  });

  it("filtering by project does not change what is hidden (suppression runs before the filter)", async () => {
    const one = (await get(`${BASE}/by-project?from=2026-10&to=2026-10&projectId=${P3}`, as.finoff)).json() as { data: Array<Row> };
    expect(one.data).toEqual([{ period: "2026-10", projectId: P3, suppressed: true, reason: "MIN_COHORT" }]);
  });
});

describe("the threshold is a setting: default 3, never below 2", () => {
  it("rejects 1 and 0, accepts 2, and a lower threshold reveals the 2-person project", async () => {
    for (const bad of [1, 0, -3, 2.5, 1000]) {
      expect((await app.inject({ method: "PUT", url: `${BASE}/settings`, headers: as.admin, payload: { minCohort: bad } })).statusCode, String(bad)).toBe(400);
    }
    expect((await app.inject({ method: "PUT", url: `${BASE}/settings`, headers: as.officer, payload: { minCohort: 2 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: `${BASE}/settings`, headers: as.admin, payload: { minCohort: 2 } })).statusCode).toBe(202);
    await drain();
    expect((await get(`${BASE}/settings`, as.admin)).json().data).toEqual({ enabled: true, minCohort: 2 });
    const nov = await byProject(as.finoff, "from=2026-11&to=2026-11");
    expect(cell(nov, P2, "2026-11")).toMatchObject({ suppressed: false, headcount: 2 });
    expect(cell(nov, P3, "2026-11")).toMatchObject({ suppressed: false, headcount: 3 });
    const sep = await byProject(as.finoff, "from=2026-09&to=2026-09");
    expect(cell(sep, P1, "2026-09").suppressed).toBe(true); // 1 person is always hidden, whatever the setting
    // the database floor is also 2
    await expect(q(sql`UPDATE payroll.payroll_settings SET project_cost_min_cohort = 1 WHERE tenant_id = ${TENANT}::uuid`)).rejects.toThrow();
    // a higher threshold hides the 3-person project
    await app.inject({ method: "PUT", url: `${BASE}/settings`, headers: as.admin, payload: { minCohort: 4 } });
    await drain();
    expect(cell(await byProject(as.finoff, "from=2026-09&to=2026-09"), P3, "2026-09").suppressed).toBe(true);
    // with the default 3, November hides the 2-person P2 and drags P3 along (hidden remainder must cover >= 3 people)
    // changing the threshold re-publishes the snapshots so project-service applies it too
    const last = await q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = 'payroll.project_cost.posted' ORDER BY created_at DESC LIMIT 1`);
    expect((last[0]!.payload as { minCohort: number }).minCohort).toBe(4);
    await app.inject({ method: "PUT", url: `${BASE}/settings`, headers: as.admin, payload: { minCohort: 3 } });
    await drain();
  });
});

describe("reclass deltas are inside the cohort rule", () => {
  it("a back-dated allocation of ONE person to a new project makes that project's delta a hidden 1-person cell", async () => {
    // E9 was unallocated in September; charge 100% to P4 from 2026-09-01
    const req = await post(`${BASE}/allocations`, { employeeId: E9, targetType: "project", projectId: P4, costCenterId: CC4, splitPct: 100, effectiveFrom: "2026-09-01" }, as.officer);
    expect(req.statusCode).toBe(202);
    await drain();
    expect((await post(`${BASE}/allocations/${req.json().id}/decision`, { decision: "approve" }, as.finadmin)).statusCode).toBe(202);
    await drain();
    // P4 only exists through the reclass delta, built from one person
    const b = await byProject(as.finoff, "from=2026-09&to=2026-09");
    expect(cell(b, P4, "2026-09")).toEqual({ period: "2026-09", projectId: P4, suppressed: true, reason: "MIN_COHORT" });
    // E9 is gone from the unallocated bucket (net zero), leaving E7 and E8: 2 people, now hidden as well
    const cc = (await get(`${BASE}/by-cost-center?from=2026-09&to=2026-09`, as.finoff)).json() as { unallocated: Array<Row>; data: Array<Row> };
    expect(cc.unallocated[0], JSON.stringify(cc.unallocated)).toEqual({ period: "2026-09", suppressed: true, reason: "MIN_COHORT" });
    // the exempt role sees the delta as it is
    expect(cell(await byProject(as.finadmin, "from=2026-09&to=2026-09"), P4, "2026-09")).toMatchObject({ suppressed: false, headcount: 1 });
  });

  it("a delta that brings a 4th person onto a visible project keeps it visible, with the new headcount", async () => {
    const req = await post(`${BASE}/allocations`, { employeeId: E7, targetType: "project", projectId: P3, costCenterId: CC3, splitPct: 100, effectiveFrom: "2026-09-01" }, as.officer);
    await drain();
    await post(`${BASE}/allocations/${req.json().id}/decision`, { decision: "approve" }, as.finadmin);
    await drain();
    expect(cell(await byProject(as.finoff, "from=2026-09&to=2026-09"), P3, "2026-09")).toMatchObject({ suppressed: false, headcount: 4 });
  });
});
