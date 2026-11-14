/**
 * S8 G7 review B1b: the two report bases must not difference one person's pay.
 * `cost_month` includes back-dated reclass deltas at once; `booked` leaves out the
 * ones no run has booked yet. Judged per basis, the suppression let a finance_officer
 * run both and subtract (P3: 4 people in `booked`, 3 in `cost_month`; the difference is
 * exactly the reclassed person's gross). Readers without pay-detail access now get
 * `cost_month` only.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";

vi.mock("../src/shared/hrms-client.js", async (io) => ({ ...(await io<Record<string, unknown>>()), verifyEmployeeExists: vi.fn(async () => true) }));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerProjectCostingConsumers } from "../src/modules/project-costing/consumer.js";

const SECRET = process.env.JWT_SECRET as string; // set by the service vitest.config.ts
const TENANT = randomUUID();
const ADMIN = randomUUID(), FINADMIN = randomUUID(), FINOFF = randomUUID();
const E = Array.from({ length: 7 }, () => randomUUID()) as [string, string, string, string, string, string, string];
const P3 = randomUUID(), CC3 = randomUUID();
const BASE = "/v1/payroll/project-costing";
const auth = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "g7b" }, SECRET)}` });
const as = { admin: auth(ADMIN, ["payroll_admin"]), finadmin: auth(FINADMIN, ["finance_admin"]), finoff: auth(FINOFF, ["finance_officer"]) };
type Row = Record<string, unknown>;
const q = (text: ReturnType<typeof sql>) => withTenantScope(db as never, TENANT, async (tx: { execute: (x: unknown) => Promise<unknown> }) => Array.from(await tx.execute(text) as Iterable<Row>));
const drain = () => (queue as unknown as MemoryQueue).drain();
let app: Awaited<ReturnType<typeof buildApp>>;
const get = (url: string, headers = as.finoff) => app.inject({ method: "GET", url, headers });
const GROSS = 1_000_000n;

beforeAll(async () => {
  const raw = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    raw(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerProjectCostingConsumers(queue);
  app = await buildApp();
  await app.inject({ method: "PUT", url: `${BASE}/settings`, headers: as.admin, payload: { enabled: true } });
  await drain();
});
afterAll(async () => { await app?.close(); await sqlClient.end(); });

describe("two bases cannot be subtracted", () => {
  let e1Allocation = "";
  it("setup: P3 has 4 people at 100% (E1-E4), 3 people are unallocated (E5-E7), run costed for 2026-09", async () => {
    for (const [i, e] of E.slice(0, 4).entries()) {
      const id = randomUUID();
      if (i === 0) e1Allocation = id;
      await q(sql`INSERT INTO payroll.employee_cost_allocations (id, tenant_id, employee_id, target_type, project_id, cost_center_id, split_pct, effective_from, status, requested_by, decided_by, decided_at)
        VALUES (${id}::uuid, ${TENANT}::uuid, ${e}::uuid, 'project', ${P3}::uuid, ${CC3}::uuid, 100, '2026-01-01', 'active', ${ADMIN}::uuid, ${FINADMIN}::uuid, now())`);
    }
    const runId = randomUUID();
    await q(sql`INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, status, created_by, updated_by)
      VALUES (${runId}::uuid, ${TENANT}::uuid, ${`R-${runId.slice(0, 6)}`}, '2026-09', ${randomUUID()}::uuid, 'approved', ${ADMIN}::uuid, ${ADMIN}::uuid)`);
    for (const e of E) {
      const sid = randomUUID();
      await q(sql`INSERT INTO payroll.payroll_slips (id, tenant_id, run_id, employee_id, employee_no, basic_minor, gross_minor, created_by, updated_by)
        VALUES (${sid}::uuid, ${TENANT}::uuid, ${runId}::uuid, ${e}::uuid, ${`E-${sid.slice(0, 4)}`}, ${GROSS.toString()}::bigint, ${GROSS.toString()}::bigint, ${ADMIN}::uuid, ${ADMIN}::uuid)`);
    }
    expect((await app.inject({ method: "POST", url: `${BASE}/runs/${runId}/generate`, headers: as.admin, payload: {} })).statusCode).toBe(202);
    await drain();
  });

  it("a back-dated END of E1's allocation (effective 2026-08-31) moves E1 off P3 in cost_month but is not booked yet", async () => {
    const res = await app.inject({ method: "POST", url: `${BASE}/allocations/${e1Allocation}/end`, headers: as.finadmin, payload: { effectiveTo: "2026-08-31" } });
    expect(res.statusCode).toBe(202);
    await drain();
    const [pending] = await q(sql`SELECT count(*)::int AS n FROM payroll.slip_cost_lines WHERE tenant_id = ${TENANT}::uuid AND kind = 'reclass' AND booked_run_id IS NULL`);
    expect(pending!.n).toBeGreaterThan(0);
  });

  it("the finance officer can no longer obtain the `booked` view, so the two bases cannot be subtracted", async () => {
    for (const path of ["by-project", "by-cost-center"]) {
      const res = await get(`${BASE}/${path}?from=2026-09&to=2026-09&basis=booked`, as.finoff);
      expect(res.statusCode, path).toBe(403);
      expect(res.json().code).toBe("BASIS_RESTRICTED");
    }
    expect((await get(`${BASE}/by-project?from=2026-09&to=2026-09&basis=booked&format=csv`, as.finoff)).statusCode).toBe(403);
    // cost_month is what they get: P3 now has 3 people (E2-E4) and shows 3 x GROSS, nothing more
    const cm = (await get(`${BASE}/by-project?from=2026-09&to=2026-09`, as.finoff)).json() as { data: Row[] };
    expect(cm.data).toHaveLength(1);
    expect(cm.data[0]).toMatchObject({ projectId: P3, suppressed: false, headcount: 3, grossMinor: (GROSS * 3n).toString() });
  });

  it("the regression: for a pay-detail role the two bases DO differ by exactly E1's gross (what the officer could have subtracted)", async () => {
    const booked = (await get(`${BASE}/by-project?from=2026-09&to=2026-09&basis=booked`, as.finadmin)).json() as { data: Row[] };
    const cm = (await get(`${BASE}/by-project?from=2026-09&to=2026-09`, as.finadmin)).json() as { data: Row[] };
    expect(booked.data[0]).toMatchObject({ headcount: 4 });
    expect(cm.data[0]).toMatchObject({ headcount: 3 });
    expect(BigInt(booked.data[0]!.grossMinor as string) - BigInt(cm.data[0]!.grossMinor as string)).toBe(GROSS);
  });
});
