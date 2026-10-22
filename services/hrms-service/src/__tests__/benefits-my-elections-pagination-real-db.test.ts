/**
 * GET /v1/hrms/benefits/my-elections — history is no longer truncated at 10
 * (GAP-HR-BENEFITS-01).
 *
 * Finding: the route ended in `ORDER BY be.fy DESC LIMIT 10` with no way to
 * ask for more, so an employee with more than ten (plan, financial year)
 * elections silently lost their oldest history. These tests seed twelve
 * elections for one employee (plus one for a colleague) and assert that all
 * twelve are reachable, in a stable order, with bounded limit/offset paging.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import type { FastifyInstance } from "fastify";

// Set by this service's vitest config (env.JWT_SECRET); never a literal in a test.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ME = randomUUID();
const COLLEAGUE = randomUUID();
const TOTAL = 12;

function auth(sub: string): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles: ["employee"], sid: "sess-benefits-page" }, SECRET, 3600)}` };
}

function fyFor(i: number): string {
  const start = 2014 + i;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

type Row = { id: string; fy: string; plan_name: string };

let app: FastifyInstance;

async function seedElection(employeeId: string, i: number): Promise<void> {
  const planId = randomUUID();
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
    INSERT INTO employee.benefit_plans (id, tenant_id, name, fy, flex_budget_minor, components, created_by)
    VALUES (${planId}, ${TENANT}, ${`Flex FY ${fyFor(i)} ${planId.slice(0, 6)}`}, ${fyFor(i)}, ${100000}, ${JSON.stringify([{ name: "hra", maxMinor: 100000 }])}::jsonb, ${ME})
  `);
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`
    INSERT INTO employee.benefit_elections (id, tenant_id, plan_id, employee_id, fy, elections, total_elected_minor)
    VALUES (${randomUUID()}, ${TENANT}, ${planId}, ${employeeId}, ${fyFor(i)}, ${JSON.stringify([{ component: "hra", electedMinor: 1000 }])}::jsonb, ${1000})
  `);
}

beforeAll(async () => {
  app = await buildApp();
  for (let i = 0; i < TOTAL; i++) await seedElection(ME, i);
  await seedElection(COLLEAGUE, 0);
});

afterAll(async () => {
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`DELETE FROM employee.benefit_elections WHERE tenant_id = ${TENANT}`);
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx`DELETE FROM employee.benefit_plans WHERE tenant_id = ${TENANT}`);
  await app.close();
  await sqlClient.end();
});

async function get(query: string): Promise<{ status: number; data: Row[]; meta?: { total: number; limit: number; offset: number } }> {
  const r = await app.inject({ method: "GET", url: `/v1/hrms/benefits/my-elections${query}`, headers: auth(ME) });
  const body = r.statusCode === 200 ? r.json() : { data: [] };
  return { status: r.statusCode, data: body.data as Row[], meta: body.meta };
}

describe("GET /v1/hrms/benefits/my-elections — full history", () => {
  it("returns all twelve elections (the old LIMIT 10 dropped the two oldest), newest financial year first", async () => {
    const { status, data, meta } = await get("");
    expect(status).toBe(200);
    expect(data).toHaveLength(TOTAL);
    expect(meta?.total).toBe(TOTAL);
    const fys = data.map((r) => String(r.fy).trim());
    expect(fys[0]).toBe(fyFor(TOTAL - 1));
    expect(fys[fys.length - 1]).toBe(fyFor(0)); // the oldest survives
    expect([...fys].sort().reverse()).toEqual(fys);
  });

  it("never includes a colleague's election", async () => {
    const { data } = await get("");
    expect(new Set(data.map((r) => r.id)).size).toBe(TOTAL);
  });

  it("limit/offset page through the whole history with no skipped or repeated row", async () => {
    const first = await get("?limit=5&offset=0");
    const second = await get("?limit=5&offset=5");
    const third = await get("?limit=5&offset=10");
    expect(first.data).toHaveLength(5);
    expect(second.data).toHaveLength(5);
    expect(third.data).toHaveLength(2);
    expect(third.meta).toEqual({ total: TOTAL, limit: 5, offset: 10 });
    const ids = [...first.data, ...second.data, ...third.data].map((r) => r.id);
    expect(new Set(ids).size).toBe(TOTAL);
    const all = (await get("")).data.map((r) => r.id);
    expect(ids).toEqual(all);
  });

  it("an offset past the end is an empty page, not an error", async () => {
    const { status, data, meta } = await get("?offset=50");
    expect(status).toBe(200);
    expect(data).toEqual([]);
    expect(meta?.total).toBe(TOTAL);
  });

  it("limit and offset are bounded (400 outside 1..200 / below 0)", async () => {
    expect((await get("?limit=0")).status).toBe(400);
    expect((await get("?limit=201")).status).toBe(400);
    expect((await get("?offset=-1")).status).toBe(400);
    expect((await get("?limit=abc")).status).toBe(400);
  });
});
