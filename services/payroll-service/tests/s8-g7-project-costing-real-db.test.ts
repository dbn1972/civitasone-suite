/**
 * S8 G7 - project costing against a REAL migrated Postgres (through 0166), via
 * buildApp() and the real consumers on the memory queue. Only the HRMS
 * employee-exists check is stubbed. Requires DATABASE_URL pointing at your own
 * disposable Postgres (see vitest.config.ts REL-035).
 *
 * Covers: flag default off (no-op), allocation validation and maker-checker,
 * the 100% rule (route AND consumer), cost lines from a run (employer costs
 * from the statutory ledgers, to-the-paisa, idempotent), back-dated reclass,
 * immutability, tenant isolation, and the access matrix: a project manager
 * never reaches individual pay.
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
import { COMMANDS } from "../src/topics.js";
import { registerProjectCostingConsumers } from "../src/modules/project-costing/consumer.js";
import { recordRunCostLinesTx } from "../src/modules/project-costing/service.js";

const SECRET = process.env.JWT_SECRET as string; // set by the service vitest.config.ts
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ADMIN = randomUUID(), OFFICER = randomUUID(), FINADMIN = randomUUID(), FINOFF = randomUUID(), PM = randomUUID(), EMPLOGIN = randomUUID();
const E1 = randomUUID(), E2 = randomUUID(), E3 = randomUUID();
const P1 = randomUUID(), P2 = randomUUID(), CC1 = randomUUID(), CC2 = randomUUID(), CC_CORP = randomUUID();
const BASE = "/v1/payroll/project-costing";

const auth = (sub: string, roles: string[], tenant = TENANT) =>
  ({ authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "g7" }, SECRET)}` });
const as = {
  admin: auth(ADMIN, ["payroll_admin"]), officer: auth(OFFICER, ["payroll_officer"]), finadmin: auth(FINADMIN, ["finance_admin"]),
  finoff: auth(FINOFF, ["finance_officer"]), pm: auth(PM, ["project_manager"]), pmOfficer: auth(PM, ["project_manager", "project_officer"]),
  emp: auth(EMPLOGIN, ["employee"]),
};

type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);
const q = (text: ReturnType<typeof sql>, tenant = TENANT) =>
  withTenantScope(db as never, tenant, async (tx: { execute: (x: unknown) => Promise<unknown> }) => rowsOf(await tx.execute(text)));
const mq = () => queue as unknown as MemoryQueue;
const drain = () => mq().drain();
let app: Awaited<ReturnType<typeof buildApp>>;
let run1: { runId: string; slipIds: string[] };

async function post(url: string, payload: unknown, headers = as.admin) {
  return app.inject({ method: "POST", url, headers, payload: payload as never });
}
async function get(url: string, headers = as.admin) {
  return app.inject({ method: "GET", url, headers });
}
const alloc = (employeeId: string, projectId: string, costCenterId: string, splitPct: number, effectiveFrom: string, effectiveTo?: string) =>
  ({ employeeId, targetType: "project", projectId, costCenterId, splitPct, effectiveFrom, ...(effectiveTo ? { effectiveTo } : {}) });

/** Request as OFFICER and approve as FINADMIN; returns the allocation id. */
async function requestAndApprove(body: ReturnType<typeof alloc>): Promise<string> {
  const res = await post(`${BASE}/allocations`, body, as.officer);
  expect(res.statusCode).toBe(202);
  const id = res.json().id as string;
  await drain();
  const dec = await post(`${BASE}/allocations/${id}/decision`, { decision: "approve" }, as.finadmin);
  expect(dec.statusCode).toBe(202);
  await drain();
  return id;
}

/** An approved run with slips and statutory ledger rows. Amounts in paise. */
async function seedRun(month: string, slips: Array<{ employeeId: string; gross: bigint; pfEr: bigint; esiEr?: bigint; npsEr?: bigint; edli?: bigint; admin?: bigint; status?: string }>) {
  const runId = randomUUID();
  await q(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by)
    VALUES (${runId}::uuid, ${TENANT}::uuid, ${`R-${month}-${runId.slice(0, 4)}`}, ${month}, ${randomUUID()}::uuid, 'approved', ${ADMIN}::uuid, ${ADMIN}::uuid)`);
  const slipIds: string[] = [];
  for (const s of slips) {
    const id = randomUUID();
    slipIds.push(id);
    await q(sql`INSERT INTO payroll.payroll_slips (id, tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, status, created_by, updated_by)
      VALUES (${id}::uuid, ${TENANT}::uuid, ${runId}::uuid, ${s.employeeId}::uuid, ${`E-${id.slice(0, 4)}`}, ${s.gross.toString()}::bigint, ${s.gross.toString()}::bigint, ${s.status ?? "computed"}, ${ADMIN}::uuid, ${ADMIN}::uuid)`);
    await q(sql`INSERT INTO statutory.payroll_pf (tenant_id, slip_id, employee_id, run_id, er_contrib_minor, edli_contrib_minor, epf_admin_minor, period, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${id}::uuid, ${s.employeeId}::uuid, ${runId}::uuid, ${s.pfEr.toString()}::bigint, ${(s.edli ?? 0n).toString()}::bigint, ${(s.admin ?? 0n).toString()}::bigint, ${month}, ${ADMIN}::uuid, ${ADMIN}::uuid)`);
    if (s.esiEr) await q(sql`INSERT INTO statutory.payroll_esi (tenant_id, slip_id, employee_id, run_id, er_contrib_minor, period, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${id}::uuid, ${s.employeeId}::uuid, ${runId}::uuid, ${s.esiEr.toString()}::bigint, ${month}, ${ADMIN}::uuid, ${ADMIN}::uuid)`);
    if (s.npsEr) await q(sql`INSERT INTO statutory.payroll_nps (tenant_id, slip_id, employee_id, run_id, er_contrib_minor, period, created_by, updated_by)
      VALUES (${TENANT}::uuid, ${id}::uuid, ${s.employeeId}::uuid, ${runId}::uuid, ${s.npsEr.toString()}::bigint, ${month}, ${ADMIN}::uuid, ${ADMIN}::uuid)`);
  }
  return { runId, slipIds };
}

const lines = (runId: string) => q(sql`SELECT employee_id, kind, line_key, target_type, project_id, cost_center_id, split_bps,
  gross_minor::text AS gross, employer_pf_minor::text AS pf, employer_esi_minor::text AS esi, employer_nps_minor::text AS nps,
  other_employer_minor::text AS other, total_cost_minor::text AS total, booked_run_id
  FROM payroll.slip_cost_lines WHERE tenant_id = ${TENANT}::uuid AND run_id = ${runId}::uuid ORDER BY employee_id, kind, line_key`);
const sumOf = (rows: Row[], key: string, pred: (r: Row) => boolean = () => true) => rows.filter(pred).reduce((s, r) => s + BigInt(r[key] as string), 0n);

beforeAll(async () => {
  const raw = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    raw(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerProjectCostingConsumers(queue);
  app = await buildApp();
});
afterAll(async () => { await app?.close(); await sqlClient.end(); });

describe("flag default OFF: a no-op for existing tenants", () => {
  it("allocation writes are refused (409), settings read false, the run hook writes nothing", async () => {
    expect((await get(`${BASE}/settings`)).json().data.enabled).toBe(false);
    const res = await post(`${BASE}/allocations`, alloc(E1, P1, CC1, 60, "2026-04-01"), as.officer);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PROJECT_COSTING_DISABLED");
    const { runId } = await seedRun("2026-08", [{ employeeId: E1, gross: 100_000_00n, pfEr: 12_000_00n }]);
    const out = await runWithTenant(TENANT, () => db.transaction((tx) =>
      recordRunCostLinesTx(tx as never, { tenantId: TENANT, actorId: ADMIN, correlationId: randomUUID() }, { id: runId, month: "2026-08" })));
    expect(out.skipped).toBe("disabled");
    expect(await lines(runId)).toHaveLength(0);
    expect(await q(sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = 'payroll.project_cost.posted'`)).toHaveLength(0);
  });

  it("only payroll_admin / super_admin may switch it on", async () => {
    for (const h of [as.officer, as.finadmin, as.pm, as.emp]) {
      expect((await app.inject({ method: "PUT", url: `${BASE}/settings`, headers: h, payload: { enabled: true } })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "PUT", url: `${BASE}/settings`, headers: as.admin, payload: { enabled: true } })).statusCode).toBe(202);
    await drain();
    expect((await get(`${BASE}/settings`)).json().data.enabled).toBe(true);
  });
});

describe("allocations: validation and maker-checker", () => {
  it("validates the body at the boundary", async () => {
    const bad = [
      { ...alloc(E1, P1, CC1, 0, "2026-04-01") },
      { ...alloc(E1, P1, CC1, 100.5, "2026-04-01") },
      { ...alloc(E1, P1, CC1, 12.345, "2026-04-01") },
      { ...alloc(E1, P1, CC1, 50, "2026-13-01") },
      { ...alloc(E1, P1, CC1, 50, "2026-04-10", "2026-04-09") },
      { employeeId: E1, targetType: "project", costCenterId: CC1, splitPct: 50, effectiveFrom: "2026-04-01" }, // project without projectId
      { employeeId: E1, targetType: "cost_center", projectId: P1, costCenterId: CC1, splitPct: 50, effectiveFrom: "2026-04-01" },
      { ...alloc(E1, P1, CC1, 50, "2026-04-01"), extra: 1 },
    ];
    for (const b of bad) expect((await post(`${BASE}/allocations`, b, as.officer)).statusCode).toBe(400);
  });

  it("roles: request = payroll/hr; approve = payroll_admin/finance_admin; a project manager gets 403 on everything", async () => {
    expect((await post(`${BASE}/allocations`, alloc(E3, P1, CC1, 10, "2026-04-01"), as.pm)).statusCode).toBe(403);
    expect((await post(`${BASE}/allocations`, alloc(E3, P1, CC1, 10, "2026-04-01"), as.finoff)).statusCode).toBe(403);
    expect((await get(`${BASE}/allocations`, as.pm)).statusCode).toBe(403);
    expect((await get(`${BASE}/allocations`, as.finoff)).statusCode).toBe(403);
  });

  it("the requester cannot approve their own request (route 403 and consumer failure)", async () => {
    const res = await post(`${BASE}/allocations`, alloc(E3, P1, CC1, 25, "2026-04-01"), as.admin);
    const id = res.json().id as string;
    await drain();
    expect((await post(`${BASE}/allocations/${id}/decision`, { decision: "approve" }, as.admin)).statusCode).toBe(403);
    // a forged command that bypasses the route is stopped by the consumer too
    await queue.publish(COMMANDS.costAllocationDecide, { messageId: randomUUID(), type: COMMANDS.costAllocationDecide, tenantId: TENANT, actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0", payload: { id, decision: "approve", note: null } });
    await drain();
    expect((await q(sql`SELECT status FROM payroll.employee_cost_allocations WHERE id = ${id}::uuid`))[0]!.status).toBe("pending");
    const fail = await q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND payload->>'resourceId' = ${id} AND payload->>'outcome' = 'failure'`);
    expect((fail[0]!.payload as { detail: { code: string } }).detail.code).toBe("SELF_APPROVAL");
    // reject by a different user is fine and final
    expect((await post(`${BASE}/allocations/${id}/decision`, { decision: "reject", note: "wrong project" }, as.finadmin)).statusCode).toBe(202);
    await drain();
    expect((await q(sql`SELECT status FROM payroll.employee_cost_allocations WHERE id = ${id}::uuid`))[0]!.status).toBe("rejected");
    expect((await post(`${BASE}/allocations/${id}/decision`, { decision: "approve" }, as.finadmin)).statusCode).toBe(409);
  });

  it("an employee's lines may total at most 100% on every day (route 422; consumer re-checks)", async () => {
    await requestAndApprove(alloc(E1, P1, CC1, 60, "2026-04-01"));
    const over = await post(`${BASE}/allocations`, alloc(E1, P2, CC2, 50, "2026-04-01"), as.officer);
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe("ALLOCATION_EXCEEDS_100");
    // not overlapping in time is fine
    expect((await post(`${BASE}/allocations`, alloc(E3, P2, CC2, 50, "2025-01-01", "2025-12-31"), as.officer)).statusCode).toBe(202);
    await drain();
    // exactly 100% is allowed
    await requestAndApprove(alloc(E1, P2, CC2, 40, "2026-04-01"));
    // a command that skipped the route check is refused by the consumer, nothing inserted
    const before = (await q(sql`SELECT count(*)::int AS n FROM payroll.employee_cost_allocations WHERE employee_id = ${E1}::uuid`))[0]!.n;
    await queue.publish(COMMANDS.costAllocationRequest, { messageId: randomUUID(), type: COMMANDS.costAllocationRequest, tenantId: TENANT, actorId: OFFICER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: randomUUID(), employeeId: E1, targetType: "cost_center", projectId: null, costCenterId: CC_CORP, splitPct: 1, effectiveFrom: "2026-05-01", effectiveTo: null, note: null } });
    await drain();
    expect((await q(sql`SELECT count(*)::int AS n FROM payroll.employee_cost_allocations WHERE employee_id = ${E1}::uuid`))[0]!.n).toBe(before);
    const fail = await q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND payload->>'action' = 'cost_allocation_request' AND payload->>'outcome' = 'failure'`);
    expect(fail.length).toBeGreaterThan(0);
  });

  it("the DB refuses a project allocation without its cost centre and a self-decided row", async () => {
    await expect(q(sql`INSERT INTO payroll.employee_cost_allocations (tenant_id, employee_id, target_type, project_id, split_pct, effective_from, requested_by)
      VALUES (${TENANT}::uuid, ${E3}::uuid, 'project', ${P1}::uuid, 10, '2026-01-01', ${ADMIN}::uuid)`)).rejects.toThrow();
    await expect(q(sql`INSERT INTO payroll.employee_cost_allocations (tenant_id, employee_id, target_type, cost_center_id, split_pct, effective_from, requested_by, status, decided_by)
      VALUES (${TENANT}::uuid, ${E3}::uuid, 'cost_center', ${CC1}::uuid, 10, '2026-01-01', ${ADMIN}::uuid, 'active', ${ADMIN}::uuid)`)).rejects.toThrow();
  });
});

describe("cost lines from an approved run", () => {
  it("splits each slip over the allocations, employer cost from the ledgers, lines sum to the slip to the paisa", async () => {
    // E1: 60% P1 / 40% P2 (from above). E2: no allocation. E3: excluded slip.
    run1 = await seedRun("2026-09", [
      { employeeId: E1, gross: 100_000_01n, pfEr: 12_000_01n, esiEr: 750_00n, npsEr: 33n, edli: 500n, admin: 99n },
      { employeeId: E2, gross: 50_000_00n, pfEr: 6_000_00n },
      { employeeId: E3, gross: 40_000_00n, pfEr: 4_800_00n, status: "excluded" },
    ]);
    const res = await post(`${BASE}/runs/${run1.runId}/generate`, {}, as.admin);
    expect(res.statusCode).toBe(202);
    await drain();
    const l = await lines(run1.runId);
    const e1 = l.filter((r) => r.employee_id === E1);
    expect(e1.map((r) => r.target_type)).toEqual(["project", "project"]);
    for (const [k, v] of [["gross", 100_000_01n], ["pf", 12_000_01n], ["esi", 750_00n], ["nps", 33n], ["other", 599n]] as const) {
      expect(sumOf(e1, k)).toBe(v);
    }
    expect(sumOf(e1, "total")).toBe(100_000_01n + 12_000_01n + 750_00n + 33n + 599n);
    expect(e1.find((r) => r.project_id === P1)!.split_bps).toBe(6000);
    expect(BigInt(e1.find((r) => r.project_id === P1)!.gross as string)).toBe(60_000_01n); // 60% of 100,000.01, odd paisa to the larger share
    // E2 has no allocation: 100% on the explicit unallocated line, so reports equal slips
    const e2 = l.filter((r) => r.employee_id === E2);
    expect(e2).toHaveLength(1);
    expect(e2[0]!.target_type).toBe("unallocated");
    expect(e2[0]!.gross).toBe("5000000");
    // the excluded slip is not costed
    expect(l.some((r) => r.employee_id === E3)).toBe(false);
    // the whole run reconciles to slips + ledgers (what the GL accrual uses)
    expect(sumOf(l, "gross")).toBe(100_000_01n + 50_000_00n);
    expect(sumOf(l, "pf")).toBe(12_000_01n + 6_000_00n);
  });

  it("is idempotent: a second generate (retry / manual regenerate) adds nothing", async () => {
    const n = (await lines(run1.runId)).length;
    await post(`${BASE}/runs/${run1.runId}/generate`, {}, as.admin);
    await drain();
    expect(await lines(run1.runId)).toHaveLength(n);
  });

  it("publishes per-project TOTALS only: no employee id and no per-person amount leaves payroll", async () => {
    const ev = await q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = 'payroll.project_cost.posted' ORDER BY created_at`);
    expect(ev.length).toBeGreaterThan(0);
    const text = JSON.stringify(ev.map((e) => e.payload));
    for (const id of [E1, E2, E3]) expect(text).not.toContain(id);
    expect(text).not.toMatch(/employee/i);
    const p = (ev[0]!.payload as { kind: string; postings: Array<Record<string, string | number>> });
    expect(p.kind).toBe("run");
    expect(p.postings.map((x) => x.projectId).sort()).toEqual([P1, P2].sort());
    expect(Object.keys(p.postings[0]!).sort()).toEqual(["costMonth", "employerCostMinor", "grossMinor", "headcount", "projectId", "totalCostMinor"]);
    // unallocated and cost-centre-only lines are not project postings
    expect(p.postings.every((x) => [P1, P2].includes(x.projectId as string))).toBe(true);
  });

  it("run lines are immutable (update and delete refused by the database)", async () => {
    await expect(q(sql`UPDATE payroll.slip_cost_lines SET gross_minor = 1, total_cost_minor = 1 WHERE run_id = ${run1.runId}::uuid`)).rejects.toThrow(/immutable/);
    await expect(q(sql`DELETE FROM payroll.slip_cost_lines WHERE run_id = ${run1.runId}::uuid`)).rejects.toThrow(/immutable/);
  });

  it("tenant isolation: another tenant sees no allocations and no cost lines", async () => {
    expect(await q(sql`SELECT 1 FROM payroll.slip_cost_lines`, OTHER_TENANT)).toHaveLength(0);
    expect(await q(sql`SELECT 1 FROM payroll.employee_cost_allocations`, OTHER_TENANT)).toHaveLength(0);
    const r = await get(`${BASE}/by-project?from=2026-01&to=2026-12`, auth(ADMIN, ["payroll_admin"], OTHER_TENANT));
    expect(r.json().data).toEqual([]);
  });
});

describe("reports and the access matrix (a project manager never sees individual pay)", () => {
  const range = "from=2026-09&to=2026-09";
  it("by-project totals equal the sum of the lines; unallocated is reported separately on by-cost-center", async () => {
    const r = await get(`${BASE}/by-project?${range}`, as.finoff);
    expect(r.statusCode).toBe(200);
    const byP = new Map((r.json().data as Array<{ projectId: string; grossMinor: string; headcount: number }>).map((x) => [x.projectId, x]));
    expect(BigInt(byP.get(P1)!.grossMinor) + BigInt(byP.get(P2)!.grossMinor)).toBe(100_000_01n);
    expect(byP.get(P1)!.headcount).toBe(1);
    const cc = await get(`${BASE}/by-cost-center?${range}`, as.finoff);
    expect(cc.json().unallocated[0].grossMinor).toBe("5000000");
    expect(cc.json().data.map((x: { costCenterId: string }) => x.costCenterId).sort()).toEqual([CC1, CC2].sort());
  });

  it("the totals reports never carry an employee id or a per-person field", async () => {
    for (const url of [`${BASE}/by-project?${range}`, `${BASE}/by-cost-center?${range}`]) {
      const text = (await get(url, as.finoff)).body;
      for (const id of [E1, E2]) expect(text).not.toContain(id);
      expect(text).not.toMatch(/employee/i);
    }
  });

  it("csv export works and carries the same totals", async () => {
    const res = await get(`${BASE}/by-project?${range}&format=csv`, as.finadmin);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body.split("\r\n")[0]).toBe("period,projectId,grossMinor,employerCostMinor,totalCostMinor,headcount");
    expect(res.body).not.toContain(E1);
  });

  it("per-person lines: payroll_officer / payroll_admin / finance_admin only", async () => {
    const url = `${BASE}/projects/${P1}/employees?${range}`;
    for (const h of [as.officer, as.admin, as.finadmin]) {
      const r = await get(url, h);
      expect(r.statusCode).toBe(200);
      expect(r.json().data.map((x: { employeeId: string }) => x.employeeId)).toEqual([E1]);
    }
    for (const h of [as.finoff, as.pm, as.pmOfficer, as.emp]) expect((await get(url, h)).statusCode).toBe(403);
    expect((await get(`${BASE}/unallocated?period=2026-09`, as.officer)).json().data.map((x: { employeeId: string }) => x.employeeId)).toEqual([E2]);
    for (const h of [as.finoff, as.pm]) expect((await get(`${BASE}/unallocated?period=2026-09`, h)).statusCode).toBe(403);
  });

  it("a project manager (even also project_officer) gets 403 from EVERY payroll costing endpoint", async () => {
    const reads = [`/settings`, `/allocations`, `/by-project?${range}`, `/by-cost-center?${range}`, `/projects/${P1}/employees?${range}`, `/unallocated?period=2026-09`];
    for (const h of [as.pm, as.pmOfficer]) {
      for (const p of reads) expect((await get(`${BASE}${p}`, h)).statusCode, p).toBe(403);
      expect((await post(`${BASE}/allocations`, alloc(E2, P1, CC1, 10, "2026-04-01"), h)).statusCode).toBe(403);
      expect((await post(`${BASE}/runs/${randomUUID()}/generate`, {}, h)).statusCode).toBe(403);
    }
    // and the older costing routes stay closed to the role too
    expect((await get(`/v1/payroll/costing/report?period=2026-09`, as.pm)).statusCode).toBe(403);
  });
});

describe("back-dated reclassification: approved runs are never rewritten", () => {
  it("a back-dated allocation books a zero-sum delta against the already-costed month, applied by the next run", async () => {
    const before = await lines(run1.runId);
    // E2 was unallocated in September; charge 50% to P1 from 2026-09-01 (back-dated)
    await requestAndApprove(alloc(E2, P1, CC1, 50, "2026-09-01"));
    const all = await lines(run1.runId);
    expect(all.filter((r) => r.kind === "run")).toEqual(before.filter((r) => r.kind === "run")); // run lines untouched
    const rc = all.filter((r) => r.kind === "reclass" && r.employee_id === E2);
    expect(rc.map((r) => r.target_type).sort()).toEqual(["project", "unallocated"]);
    expect(sumOf(rc, "gross")).toBe(0n);
    expect(sumOf(rc, "total")).toBe(0n);
    expect(rc.find((r) => r.target_type === "project")!.gross).toBe("2500000");
    expect(rc.every((r) => r.booked_run_id === null)).toBe(true);
    // the report by cost month now shows the corrected truth ...
    const r = await get(`/v1/payroll/project-costing/by-project?from=2026-09&to=2026-09&projectId=${P1}`, as.finoff);
    expect(BigInt(r.json().data[0].grossMinor)).toBe(60_000_01n + 25_000_00n);
    // ... and the project-service feed got a reclass posting (money moved, no people counted)
    const ev = await q(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND topic = 'payroll.project_cost.posted' AND payload->>'kind' = 'reclass'`);
    expect(ev).toHaveLength(1);
    expect((ev[0]!.payload as { postings: Array<{ headcount: number }> }).postings.every((x) => x.headcount === 0)).toBe(true);
  });

  it("re-running the reclass finds no difference (idempotent) and the next run books the deltas", async () => {
    const n = (await lines(run1.runId)).filter((r) => r.kind === "reclass").length;
    const { runId } = await seedRun("2026-10", [{ employeeId: E2, gross: 50_000_00n, pfEr: 6_000_00n }]);
    await post(`${BASE}/runs/${runId}/generate`, {}, as.admin);
    await drain();
    const after = (await lines(run1.runId)).filter((r) => r.kind === "reclass");
    expect(after).toHaveLength(n);
    expect(after.every((r) => r.booked_run_id === runId)).toBe(true);
    // October is costed with the new allocation: 50% P1, 50% unallocated
    const oct = await lines(runId);
    expect(oct.find((r) => r.target_type === "project")!.gross).toBe("2500000");
    // basis=booked: the September correction is reported in October, September itself stays as first booked
    const booked = await get(`${BASE}/by-project?from=2026-09&to=2026-10&projectId=${P1}&basis=booked`, as.finoff);
    const byPeriod = Object.fromEntries((booked.json().data as Array<{ period: string; grossMinor: string }>).map((x) => [x.period, BigInt(x.grossMinor)]));
    expect(byPeriod["2026-09"]).toBe(60_000_01n);
    expect(byPeriod["2026-10"]).toBe(25_000_00n + 25_000_00n);
  });

  it("ending an allocation back-dated also reclassifies", async () => {
    const [a] = await q(sql`SELECT id FROM payroll.employee_cost_allocations WHERE employee_id = ${E2}::uuid AND status = 'active'`);
    const res = await post(`${BASE}/allocations/${a!.id}/end`, { effectiveTo: "2026-09-14" }, as.finadmin);
    expect(res.statusCode).toBe(202);
    await drain();
    // 14 of 30 days at 50%: P1 should now carry 50% * 14/30 of 50,000.00 = 11,666.67
    const r = await get(`${BASE}/by-project?from=2026-09&to=2026-09&projectId=${P1}`, as.finoff);
    expect(BigInt(r.json().data[0].grossMinor)).toBe(60_000_01n + 11_666_67n);
    expect((await post(`${BASE}/allocations/${a!.id}/end`, { effectiveTo: "2026-09-30" }, as.finadmin)).statusCode).toBe(422);
  });
});
