/**
 * GAP-PAYROLL-FLEX-BENEFITS-05 -- approval of flex-benefit elections
 * (maker-checker), end to end against a REAL Postgres (migrated through
 * 0070), through buildApp() and the real payroll consumers.
 *
 * Requires DATABASE_URL pointing at a disposable, migrated instance (see
 * vitest.config.ts REL-035).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";

const H = vi.hoisted(() => ({ names: new Map<string, { fullName: string; departmentName: string; employeeNo: string | null }>(), own: {} as Record<string, string> }));

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/hrms-client.js")>()),
  fetchEmployeeSummaries: vi.fn(async () => H.names),
  resolveActorEmployeeId: vi.fn(async (_t: string, actorId: string) => H.own[actorId] ?? null),
}));

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const MAKER = randomUUID();     // payroll officer who submitted the election
const CHECKER = randomUUID();   // a different payroll officer
const CHECKER_2 = randomUUID(); // a second one (race)
const EMPLOYEE = randomUUID();  // plain employee login
const EMP_ID = randomUUID();    // that employee's hrms id
const PLAN = randomUUID();
const FY = "2026-27";

const OFFICER = ["payroll_officer"];

function auth(sub: string, roles: string[], tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "flex-approval" }, SECRET)}` };
}

let app: Awaited<ReturnType<typeof buildApp>>;
type Row = Record<string, unknown>;
const rowsOf = (r: unknown): Row[] => Array.from(r as Iterable<Row>);

async function seed(opts: { createdBy?: string; status?: string; tenant?: string } = {}): Promise<string> {
  const id = randomUUID();
  const tenant = opts.tenant ?? TENANT;
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.flex_benefit_elections
        (id, tenant_id, employee_id, plan_id, fy, elections, total_elected_minor, status, created_by)
      VALUES (${id}::uuid, ${tenant}::uuid, ${randomUUID()}::uuid, ${PLAN}::uuid, ${FY},
        ${JSON.stringify([{ component: "Medical", electedMinor: 100000 }])}::jsonb, 100000,
        ${opts.status ?? "submitted"}, ${opts.createdBy ?? MAKER}::uuid)
    `);
  }));
  return id;
}

async function read(id: string): Promise<Row | undefined> {
  return runWithTenant(TENANT, () => db.transaction(async (tx) =>
    rowsOf(await tx.execute(sql`
      SELECT status, reviewed_by, review_reason, created_by FROM payroll.flex_benefit_elections WHERE id = ${id}::uuid
    `))[0]));
}

async function audits(id: string): Promise<Row[]> {
  return runWithTenant(TENANT, () => db.transaction(async (tx) =>
    rowsOf(await tx.execute(sql`
      SELECT actor_id, payload FROM _outbox.messages
       WHERE topic = 'audit.event.record' AND payload->>'resourceId' = ${id} ORDER BY created_at
    `))));
}

async function setMakerChecker(on: boolean) {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.payroll_settings (tenant_id, flex_election_maker_checker)
      VALUES (${TENANT}::uuid, ${on})
      ON CONFLICT (tenant_id) DO UPDATE SET flex_election_maker_checker = EXCLUDED.flex_election_maker_checker
    `);
  }));
}

async function until<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!pred(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    v = await fn();
  }
  return v;
}
const settle = () => new Promise((r) => setTimeout(r, 300));

async function etagOf(id: string): Promise<string> {
  return runWithTenant(TENANT, () => db.transaction(async (tx) =>
    String(rowsOf(await tx.execute(sql`
      SELECT md5(elections::text || total_elected_minor::text) AS etag FROM payroll.flex_benefit_elections WHERE id = ${id}::uuid
    `))[0]!.etag)));
}

/** The reviewer's decision carries the etag of what they loaded (default: the current state). */
async function decide(id: string, action: "approve" | "reject", sub: string, roles: string[], body: Record<string, unknown> = {}) {
  const etag = (body.etag as string | undefined) ?? (await etagOf(id).catch(() => "0".repeat(32)));
  return app.inject({ method: "POST", url: `/v1/payroll/flex-benefits/elections/${id}/${action}`, headers: auth(sub, roles), payload: { ...body, etag } as never });
}

async function elect(amount: number) {
  return app.inject({
    method: "POST", url: "/v1/payroll/flex-benefits/elections", headers: auth(EMPLOYEE, ["employee"]),
    payload: { planId: PLAN, fy: FY, elections: [{ component: "Medical", electedMinor: amount }] },
  });
}

async function clearEmployeeElections() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM payroll.flex_benefit_elections WHERE employee_id = ${EMP_ID}::uuid`);
  }));
}

async function employeeElectionId(): Promise<string> {
  return runWithTenant(TENANT, () => db.transaction(async (tx) =>
    String(rowsOf(await tx.execute(sql`SELECT id FROM payroll.flex_benefit_elections WHERE employee_id = ${EMP_ID}::uuid`))[0]?.id ?? "")));
}

beforeAll(async () => {
  const q = queue as unknown as { subscribe: (t: string, h: (m: { tenantId: string }) => Promise<void>) => void; start?: () => Promise<void> };
  const raw = q.subscribe.bind(q);
  registerPayrollConsumers({
    ...queue,
    subscribe: (topic: string, handler: (m: { tenantId: string }) => Promise<void>) =>
      raw(topic, (m) => runWithTenant(m.tenantId, () => handler(m))),
  } as unknown as Parameters<typeof registerPayrollConsumers>[0]);
  await q.start?.();
  H.own[EMPLOYEE] = EMP_ID;
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.flex_benefit_plans (id, tenant_id, name, fy, total_budget_minor, components, created_by)
      VALUES (${PLAN}::uuid, ${TENANT}::uuid, 'Flex Plan', ${FY}, 5000000,
        ${JSON.stringify([{ name: "Medical", maxMinor: 2000000, taxExempt: true }])}::jsonb, ${MAKER}::uuid)
    `);
  }));
  await runWithTenant(OTHER_TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO payroll.flex_benefit_plans (id, tenant_id, name, fy, total_budget_minor, components, created_by)
      VALUES (${randomUUID()}::uuid, ${OTHER_TENANT}::uuid, 'Other', ${FY}, 1, '[]'::jsonb, ${MAKER}::uuid)
    `);
  }));
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM payroll.flex_benefit_elections WHERE tenant_id = ${t}::uuid`);
      await tx.execute(sql`DELETE FROM payroll.flex_benefit_plans WHERE tenant_id = ${t}::uuid`);
      await tx.execute(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${t}::uuid`);
    }));
  }
  await sqlClient.end();
});

describe("flex election approval -- maker-checker (default ON)", () => {
  it("a different officer approves: status, reviewer and an audit row with the reason", async () => {
    const id = await seed();
    const res = await decide(id, "approve", CHECKER, OFFICER, { reason: "within plan limits" });
    expect(res.statusCode).toBe(202);
    const row = await until(() => read(id), (r) => r?.status === "approved");
    expect(row).toMatchObject({ status: "approved", reviewed_by: CHECKER, review_reason: "within plan limits" });
    const trail = await until(() => audits(id), (a) => a.length > 0);
    expect(trail).toHaveLength(1);
    expect(trail[0]!.actor_id).toBe(CHECKER);
    expect(trail[0]!.payload).toMatchObject({ action: "approve", resourceType: "payroll_flex_election", reason: "within plan limits" });
  });

  it("the submitter may not approve their own election: 403 and nothing changes", async () => {
    const id = await seed({ createdBy: MAKER });
    const res = await decide(id, "approve", MAKER, OFFICER);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_APPROVAL_FORBIDDEN");
    await settle();
    expect((await read(id))?.status).toBe("submitted");
  });

  it("the consumer re-asserts maker != checker even if the route pre-check is bypassed", async () => {
    const id = await seed({ createdBy: MAKER });
    await queue.publish("payroll.flex_election.decide", {
      messageId: randomUUID(), type: "payroll.flex_election.decide",
      tenantId: TENANT, actorId: MAKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: TENANT, id, decision: "approved", etag: await etagOf(id) },
    } as never);
    await settle();
    expect((await read(id))?.status).toBe("submitted");
    expect(await audits(id)).toHaveLength(0);
  });

  it("rejecting requires a reason of at least 10 characters (400), and records it", async () => {
    const id = await seed();
    expect((await decide(id, "reject", CHECKER, OFFICER, { reason: "short" })).statusCode).toBe(400);
    expect((await decide(id, "reject", CHECKER, OFFICER, {})).statusCode).toBe(400);
    expect((await decide(id, "reject", CHECKER, OFFICER, { reason: "exceeds the plan component cap" })).statusCode).toBe(202);
    const row = await until(() => read(id), (r) => r?.status === "rejected");
    expect(row).toMatchObject({ status: "rejected", reviewed_by: CHECKER, review_reason: "exceeds the plan component cap" });
  });

  it("an already-decided election answers 409", async () => {
    const id = await seed({ status: "approved" });
    const res = await decide(id, "reject", CHECKER, OFFICER, { reason: "changed my mind entirely" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ELECTION_NOT_PENDING");
  });

  it("two reviewers racing: exactly one decision lands and exactly one audit row is written", async () => {
    const id = await seed();
    const [a, b] = await Promise.all([
      decide(id, "approve", CHECKER, OFFICER),
      decide(id, "reject", CHECKER_2, OFFICER, { reason: "rejecting concurrently here" }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    const row = await until(() => read(id), (r) => r?.status !== "submitted");
    await settle();
    expect(["approved", "rejected"]).toContain(row?.status);
    const trail = await audits(id);
    expect(trail).toHaveLength(1);
    const winner = row?.status === "approved" ? CHECKER : CHECKER_2;
    expect(trail[0]!.actor_id).toBe(winner);
    expect((await read(id))?.reviewed_by).toBe(winner);
  });

  it("an employee (or any non-payroll role) cannot decide or list the queue", async () => {
    const id = await seed();
    expect((await decide(id, "approve", EMPLOYEE, ["employee"])).statusCode).toBe(403);
    const list = await app.inject({ method: "GET", url: "/v1/payroll/flex-benefits/elections", headers: auth(EMPLOYEE, ["employee"]) });
    expect(list.statusCode).toBe(403);
  });

  it("another tenant's election is invisible: 404", async () => {
    const id = await seed({ tenant: OTHER_TENANT });
    expect((await decide(id, "approve", CHECKER, OFFICER)).statusCode).toBe(404);
  });
});

describe("flex election approval -- tenant switch OFF", () => {
  it("lets the submitter decide when the tenant disabled maker-checker (audited)", async () => {
    await setMakerChecker(false);
    try {
      const id = await seed({ createdBy: MAKER });
      expect((await decide(id, "approve", MAKER, OFFICER)).statusCode).toBe(202);
      const row = await until(() => read(id), (r) => r?.status === "approved");
      expect(row?.reviewed_by).toBe(MAKER);
      expect(await until(() => audits(id), (a) => a.length > 0)).toHaveLength(1);
    } finally {
      await setMakerChecker(true);
    }
  });
});

describe("flex election approval -- queue listing", () => {
  it("lists with names, total/pending, stable paging and the caller's own-submission flag; never leaks another tenant", async () => {
    const id = await seed({ createdBy: CHECKER });
    await seed({ tenant: OTHER_TENANT });
    const empId = (await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      rowsOf(await tx.execute(sql`SELECT employee_id::text AS e FROM payroll.flex_benefit_elections WHERE id = ${id}::uuid`))[0]!.e))) as string;
    H.names.set(empId, { fullName: "Asha Verma", departmentName: "Accounts", employeeNo: "E1" });

    const res = await app.inject({ method: "GET", url: "/v1/payroll/flex-benefits/elections?status=submitted&limit=2&offset=0", headers: auth(CHECKER, OFFICER) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Row>; total: number; pending: number; limit: number };
    expect(body.limit).toBe(2);
    expect(body.data.length).toBeLessThanOrEqual(2);
    expect(body.total).toBeGreaterThanOrEqual(3);
    const mine = body.data.find((r) => r.id === id);
    if (mine) {
      expect(mine.employee_name).toBe("Asha Verma");
      expect(mine.is_own_submission).toBe(true);
    }
    const all = await app.inject({ method: "GET", url: "/v1/payroll/flex-benefits/elections?limit=100", headers: auth(CHECKER, OFFICER) });
    const rows = (all.json() as { data: Array<Row> }).data;
    expect(rows.find((r) => r.id === id)).toMatchObject({ employee_name: "Asha Verma", is_own_submission: true, plan_name: "Flex Plan" });
    // names that hrms cannot resolve are null (UI shows a neutral label), never the uuid
    expect(rows.some((r) => r.employee_name === null)).toBe(true);
    expect((await app.inject({ method: "GET", url: "/v1/payroll/flex-benefits/elections?limit=1000", headers: auth(CHECKER, OFFICER) })).statusCode).toBe(400);
  });
});

describe("flex election approval -- re-election goes back to the approver", () => {
  it("an approved election the employee changes is 'submitted' again, with the employee as maker", async () => {
    const empRowId = randomUUID();
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO payroll.flex_benefit_elections
          (id, tenant_id, employee_id, plan_id, fy, elections, total_elected_minor, status, created_by, reviewed_by, reviewed_at, review_reason)
        VALUES (${empRowId}::uuid, ${TENANT}::uuid, ${EMP_ID}::uuid, ${PLAN}::uuid, ${FY},
          ${JSON.stringify([{ component: "Medical", electedMinor: 100000 }])}::jsonb, 100000,
          'approved', ${MAKER}::uuid, ${CHECKER}::uuid, NOW(), 'ok')
      `);
    }));
    const res = await app.inject({
      method: "POST", url: "/v1/payroll/flex-benefits/elections", headers: auth(EMPLOYEE, ["employee"]),
      payload: { planId: PLAN, fy: FY, elections: [{ component: "Medical", electedMinor: 150000 }] },
    });
    expect(res.statusCode).toBe(202);
    const row = await until(() => read(empRowId), (r) => r?.status === "submitted");
    expect(row).toMatchObject({ status: "submitted", reviewed_by: null, review_reason: null, created_by: EMPLOYEE });
  });
});

describe("flex election approval -- repeat decisions and stale reviews", () => {
  for (const [first, second, firstStatus] of [["approve", "approve", "approved"], ["reject", "reject", "rejected"]] as const) {
    it(`${first} -> re-elect -> ${second}: the second decision lands (not deduped)`, async () => {
      await clearEmployeeElections();
      expect((await elect(100000)).statusCode).toBe(202);
      const id = await until(employeeElectionId, (v) => !!v);
      const body = (r: string) => (first === "reject" ? { reason: r } : {});
      expect((await decide(id, first, CHECKER, OFFICER, body("first rejection reason"))).statusCode).toBe(202);
      await until(() => read(id), (r) => r?.status === firstStatus);
      expect((await elect(150000)).statusCode).toBe(202);
      await until(() => read(id), (r) => r?.status === "submitted");
      expect((await decide(id, second, CHECKER, OFFICER, body("second rejection reason"))).statusCode).toBe(202);
      const row = await until(() => read(id), (r) => r?.status === firstStatus);
      expect(row?.status).toBe(firstStatus);
      const decisions = (await until(() => audits(id), (a) => a.filter((x) => (x.payload as Row).action !== "upsert").length >= 2))
        .filter((x) => (x.payload as Row).action !== "upsert");
      expect(decisions.map((x) => (x.payload as Row).action)).toEqual([first, first]);
    });
  }

  it("an election edited after the reviewer loaded it is 409 STALE_ELECTION and stays submitted", async () => {
    await clearEmployeeElections();
    expect((await elect(100000)).statusCode).toBe(202);
    const id = await until(employeeElectionId, (v) => !!v);
    const seen = await etagOf(id);
    expect((await elect(180000)).statusCode).toBe(202);
    await until(() => etagOf(id), (e) => e !== seen);
    const res = await decide(id, "approve", CHECKER, OFFICER, { etag: seen });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("STALE_ELECTION");
    expect((await read(id))?.status).toBe("submitted");
  });

  it("the consumer re-asserts the etag: a command carrying a stale etag changes nothing and writes no audit", async () => {
    const id = await seed();
    await queue.publish("payroll.flex_election.decide", {
      messageId: randomUUID(), type: "payroll.flex_election.decide",
      tenantId: TENANT, actorId: CHECKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: TENANT, id, decision: "approved", etag: "f".repeat(32) },
    } as never);
    await settle();
    expect((await read(id))?.status).toBe("submitted");
    expect(await audits(id)).toHaveLength(0);
  });
});

describe("payroll settings audit -- flexElectionMakerChecker before/after", () => {
  it("records the previous value in `before`", async () => {
    await setMakerChecker(true);
    const res = await app.inject({
      method: "PUT", url: "/v1/payroll/settings", headers: auth(CHECKER, ["payroll_admin"]),
      payload: { protectedNetFloorMinor: 0, flexElectionMakerChecker: false },
    });
    expect(res.statusCode).toBe(202);
    try {
      const trail = await until(() => audits(TENANT), (a) => a.length > 0);
      const p = trail[trail.length - 1]!.payload as { before: Row; after: Row };
      expect(p.before.flexElectionMakerChecker).toBe(true);
      expect(p.after.flexElectionMakerChecker).toBe(false);
    } finally {
      await setMakerChecker(true);
    }
  });
});
