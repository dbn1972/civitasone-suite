/**
 * helpdesk-service — SLA engine HTTP route tests (inject).
 *
 * Regression test for a live 500: GET /v1/helpdesk/sla/breaches selected
 * `t.assigned_to`, a column that does not exist on helpdesk.tickets (the
 * real column is `assignee_id`). Postgres raised "column t.assigned_to does
 * not exist" for every call whose query plan reached that column, which
 * happens whenever there's at least one open ticket past its SLA resolution
 * window. This test seeds a real breaching ticket and asserts the route
 * returns 200, not 500 — so any regression of the column name is caught.
 *
 * DB-backed: uses the live civitas_helpdesk (same conn the route tests use).
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-4444-4000-8000-000000000099";
const ACTOR = "dddddddd-5555-4000-8000-000000000099";

function token(tenantId = TENANT, roles = ["helpdesk_user"]) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

async function cleanup() {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.delete(tickets).where(eq(tickets.tenantId, TENANT))),
  );
  // helpdesk.sla_config has no Drizzle schema (routes.ts queries it with raw
  // sqlClient), so it is cleaned up directly. Without this, the PATCH test
  // below leaves a `high` config row for TENANT; once a tenant has ANY config
  // row, the breaches query's `WHERE NOT EXISTS (...)` stops emitting default
  // thresholds for that tenant's OTHER priorities entirely, so a seeded
  // 'critical' ticket has no SLA row to join against and silently vanishes
  // from the result set (a real cross-test pollution bug, not a route bug —
  // the route reads per-tenant, so this cannot leak across tenants in
  // production, but it does leak across tests sharing one tenant id).
  await sqlClient`DELETE FROM helpdesk.sla_config WHERE tenant_id = ${TENANT}`;
}

/** Seed a ticket old enough to be past the default SLA resolution window for its priority. */
async function seedBreachingTicket(priority = "Critical"): Promise<string> {
  const id = randomUUID();
  // Default critical resolution window is 240 minutes; go well past it.
  const createdAt = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10h ago
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.insert(tickets).values({
        id, tenantId: TENANT, subject: `breach ${id}`, description: null,
        priority, status: "open", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
        createdAt, updatedAt: createdAt, assigneeId: ACTOR,
      } as typeof tickets.$inferInsert),
    ),
  );
  return id;
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GET /v1/helpdesk/sla/breaches", () => {
  it("returns 200 (not 500) when a breaching ticket exists — regression for assigned_to/assignee_id column bug", async () => {
    const ticketId = await seedBreachingTicket("Critical");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/sla/breaches",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    const row = body.data.find((r: { id: string }) => r.id === ticketId);
    expect(row).toBeDefined();
    // assignee_id is the real column; the route must expose it under this row.
    expect(row.assignee_id).toBe(ACTOR);
  });

  it("returns 200 with empty data when no tickets breach SLA", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/sla/breaches",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("filters by priority", async () => {
    await seedBreachingTicket("Critical");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/sla/breaches?priority=high",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 400 for invalid query params", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/sla/breaches?priority=bogus",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/helpdesk/sla/breaches" });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without read access", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/sla/breaches",
      headers: { authorization: `Bearer ${token(TENANT, ["citizen"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("tenant isolation: another tenant's breaching ticket is not visible", async () => {
    await seedBreachingTicket("Critical");
    const OTHER = "eeeeeeee-6666-4000-8000-000000000099";
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/sla/breaches",
      headers: { authorization: `Bearer ${token(OTHER)}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /v1/helpdesk/sla/metrics", () => {
  it("returns 200 with metrics shape", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/sla/metrics",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.data.currentOpenBreaches).toBe("number");
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/helpdesk/sla/metrics" });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/helpdesk/sla/config", () => {
  it("returns 200 with default rules when none configured", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/sla/config",
      headers: { authorization: `Bearer ${token(randomUUID())}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.source).toBe("defaults");
    expect(Array.isArray(body.data.rules)).toBe(true);
  });

  it("returns 403 for a role without read access", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/sla/config",
      headers: { authorization: `Bearer ${token(TENANT, ["citizen"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/helpdesk/sla/config", () => {
  it("returns 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/helpdesk/sla/config",
      headers: { authorization: `Bearer ${token(TENANT, ["helpdesk_admin"])}` },
      payload: { rules: [] },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/helpdesk/sla/config",
      headers: { authorization: `Bearer ${token(TENANT, ["helpdesk_user"])}` },
      payload: { rules: [{ priority: "high", responseTimeMinutes: 60, resolutionTimeMinutes: 480 }] },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/helpdesk/sla/config",
      payload: { rules: [{ priority: "high", responseTimeMinutes: 60, resolutionTimeMinutes: 480 }] },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("updates SLA config successfully", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/helpdesk/sla/config",
      headers: { authorization: `Bearer ${token(TENANT, ["helpdesk_admin"])}` },
      payload: { rules: [{ priority: "high", responseTimeMinutes: 60, resolutionTimeMinutes: 480 }] },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.updated).toBe(1);
  });
});
