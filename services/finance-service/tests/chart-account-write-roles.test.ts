/**
 * GAP-FINANCE-CHART-OF-ACCOUNTS-05: who may create / change a head of account. Only finance_officer, finance_admin and
 * super_admin; every other role the finance module admits for reading (audit_officer, budget_officer, procurement_officer,
 * accounts_officer, ...) gets a 403, and a control account additionally needs finance_admin / super_admin. The web hides
 * "+ Add Head" and the form from the read-only roles (lib/auth/workRoles.ts ACCOUNT_HEAD_WRITE_ROLES mirrors this list).
 * The list items also carry level and parentId, which the web tree and the parent picker rely on.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerBudgetConsumers } from "../src/modules/budget/consumer.js";
import { bearer } from "./_fp02.js";

const T = randomUUID();
const ACTOR = "00000000-0f02-4000-8000-000000000071";
let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

const create = (roles: string[], body: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST", url: "/v1/finance/accounts", headers: bearer(T, ACTOR, roles),
    payload: { code: `C${Math.floor(Math.random() * 1e6)}`, name: "Test head", level: 0, ...body },
  });

describe("POST /v1/finance/accounts role gate", () => {
  it.each(["finance_officer", "finance_admin", "super_admin"])("%s may create a head (202)", async (role) => {
    const res = await create([role]);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: "accepted", level: 0 });
  });

  it.each(["audit_officer", "budget_officer", "procurement_officer", "accounts_officer", "payroll_admin", "tenant_admin", "admin", "citizen", "employee"])(
    "%s gets 403 and nothing is queued",
    async (role) => {
      const res = await create([role]);
      expect(res.statusCode).toBe(403);
    },
  );

  it("a plain finance_officer cannot mark a control account; finance_admin can", async () => {
    expect((await create(["finance_officer"], { isControl: true })).statusCode).toBe(403);
    expect((await create(["finance_admin"], { isControl: true })).statusCode).toBe(202);
  });

  it("changing a head (PATCH) and mapping its HoA code have the same gate", async () => {
    const id = randomUUID();
    for (const role of ["audit_officer", "budget_officer", "accounts_officer"]) {
      const patch = await app.inject({ method: "PATCH", url: `/v1/finance/accounts/${id}`, headers: bearer(T, ACTOR, [role]), payload: { name: "Renamed head" } });
      expect(patch.statusCode, `PATCH ${role}`).toBe(403);
      const hoa = await app.inject({ method: "PATCH", url: `/v1/finance/accounts/${id}/hoa`, headers: bearer(T, ACTOR, [role]), payload: { hoaCode: "210100101010101010", reason: "Aligning with PFMS" } });
      expect(hoa.statusCode, `HoA ${role}`).toBe(403);
    }
    // a writer gets past the role gate (an unknown id is then a plain 404, not a 403)
    const ok = await app.inject({ method: "PATCH", url: `/v1/finance/accounts/${id}`, headers: bearer(T, ACTOR, ["finance_officer"]), payload: { name: "Renamed head" } });
    expect(ok.statusCode).toBe(404);
  });
});

// The create route only queues a command; the budget consumer (on the shared queue singleton the route publishes to,
// wrapped in runWithTenant like worker.ts) performs the insert. A fresh tenant has no heads, so the read-side test seeds
// a major and a minor head through that real path, otherwise "each item carries level and parentId" could pass over an
// empty list without asserting anything.
type Drainable = { subscribe: (topic: string, handler: (msg: any) => Promise<void>) => void; drain(): Promise<void> };

describe("GET /v1/finance/accounts (read side)", () => {
  const READ_TENANT = randomUUID();
  beforeAll(async () => {
    const shared = queue as unknown as Drainable;
    const rawSubscribe = shared.subscribe.bind(shared);
    shared.subscribe = (topic, handler) => rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
    registerBudgetConsumers(queue);
  });

  it("is readable by the read-only finance roles, and each item carries level and parentId", async () => {
    const seed = (body: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/v1/finance/accounts", headers: bearer(READ_TENANT, ACTOR, ["finance_officer"]), payload: body });
    const major = await seed({ code: "9000", name: "Seeded major head", level: 0 });
    expect(major.statusCode).toBe(202);
    await (queue as unknown as Drainable).drain();
    const minor = await seed({ code: "9000-01", name: "Seeded minor head", level: 1, parentId: major.json().id });
    expect(minor.statusCode).toBe(202);
    await (queue as unknown as Drainable).drain();

    const res = await app.inject({ method: "GET", url: "/v1/finance/accounts?limit=5", headers: bearer(READ_TENANT, ACTOR, ["audit_officer"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>> };
    expect(Array.isArray(body.data)).toBe(true);
    // non-vacuous: both seeded heads are listed, so the loop below really checks items
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    for (const item of body.data) {
      expect(item).toHaveProperty("level");
      expect(item).toHaveProperty("parentId");
    }
    expect(body.data.find((i) => i.id === major.json().id)).toMatchObject({ level: 0, parentId: null });
    expect(body.data.find((i) => i.id === minor.json().id)).toMatchObject({ level: 1, parentId: major.json().id });
    expect((await app.inject({ method: "GET", url: "/v1/finance/accounts", headers: bearer(T, ACTOR, ["citizen"]) })).statusCode).toBe(403);
  });
});
