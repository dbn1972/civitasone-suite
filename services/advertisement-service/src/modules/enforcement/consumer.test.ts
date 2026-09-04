/**
 * Real, DB-backed enforcement tests — route → consumer → persisted-state.
 *
 * This is the module this branch's migrations/0002_enforcement_schema.sql
 * fixes: adv_enforcement.adv_violations was declared in schema.ts but never
 * created by any migration, so on a fresh database EVERY route here 500s
 * and every consumer transaction's INSERT/UPDATE fails — the module has
 * been completely dead since the service was scaffolded. The first
 * describe block below is the direct proof that is no longer true: a real
 * HTTP POST, through the real (in-process) command bus, into the real
 * consumer, persisting a real row this test then reads back — plus an
 * explicit cross-tenant RLS isolation check for that same violation, and a
 * dedicated test proving the RLS check actually has teeth (temporarily
 * strips FORCE ROW LEVEL SECURITY, confirms the SAME check now fails/leaks,
 * restores it — so this test would itself fail if adv_violations' RLS
 * policy ever regressed).
 *
 * Also replaces the previous fully vi.mock'd consumer.test.ts (cache
 * invalidation regression coverage) and covers this branch's money-field
 * fix (penaltyMinor) and collision-prone violation-number-generator fix.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { queue } from "../../shared/infra.js";
import { sqlClient } from "../../shared/db.js";
import { registerEnforcementConsumers } from "./consumer.js";
import * as repo from "./repo.js";
import { tokenForTenant, settle } from "../../shared/test-helpers.js";

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();
// "adv_admin" (not "adv_officer" alone) so the SAME token can both report a
// violation (enforcement/routes.ts ADV_ROLES = adv_user/adv_admin/super_admin)
// and drive the rest of the lifecycle (OFFICER_ROLES = adv_admin/adv_officer/
// adv_enforcement/super_admin) in one test flow.
const OFFICER_ROLES = ["adv_admin"];

let app: FastifyInstance;
let authedA: { authorization: string; "content-type": string };
let authedB: { authorization: string; "content-type": string };

beforeAll(async () => {
  registerEnforcementConsumers(queue);
  await queue.start();
  app = await buildApp();
  authedA = { authorization: `Bearer ${tokenForTenant(TENANT_A, ACTOR, OFFICER_ROLES)}`, "content-type": "application/json" };
  authedB = { authorization: `Bearer ${tokenForTenant(TENANT_B, ACTOR, OFFICER_ROLES)}`, "content-type": "application/json" };
});

afterAll(async () => {
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

function reportPayload(overrides: Record<string, unknown> = {}) {
  return {
    violationType: "unauthorized_hoarding",
    description: "Unauthorized hoarding at MG Road junction",
    location: { address: "MG Road junction", ward: "12" },
    ...overrides,
  };
}

async function reportViolationAs(headers: Record<string, string>): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/v1/advertisement/violations", headers, payload: reportPayload() });
  expect(res.statusCode).toBe(202);
  const { id } = res.json() as { id: string };
  await settle();
  return id;
}

/** Raw SQL as a given tenant — bypasses repo.ts's own WHERE tenant_id=... so
 * this reflects RLS enforcement itself, not just the application-level filter. */
async function rawSelectAsTenant(tenantId: string, violationId: string): Promise<Array<{ id: string; tenant_id: string }>> {
  return sqlClient.begin(async (sql) => {
    // set_config(), not `SET LOCAL app.tenant_id = ${tenantId}` — postgres.js
    // sends tagged-template values as a bind parameter, and Postgres's SET
    // statement doesn't accept one there ("syntax error at or near $1").
    // set_config() is a plain function call, so it does.
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return sql`SELECT id, tenant_id FROM adv_enforcement.adv_violations WHERE id = ${violationId}`;
  }) as unknown as Promise<Array<{ id: string; tenant_id: string }>>;
}

describe("enforcement module end-to-end (the module migrations/0002_enforcement_schema.sql fixes)", () => {
  it("creates a violation via the real route → consumer → adv_enforcement.adv_violations, and it persists", async () => {
    const violationId = await reportViolationAs(authedA);

    const row = await repo.findById(violationId, TENANT_A);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("reported");
    expect(row!.violationType).toBe("unauthorized_hoarding");
    expect(row!.violationNumber).toMatch(/^ADVV\/ULB\/\d{4}\/\d{6}$/);
    expect(row!.reportedBy).toBe(ACTOR);
  });

  it("tenant B cannot read tenant A's violation through the app-level repo (belt)", async () => {
    const violationId = await reportViolationAs(authedA);
    const asB = await repo.findById(violationId, TENANT_B);
    expect(asB).toBeNull();
  });

  it("tenant B cannot read tenant A's violation via a raw query with no tenant_id in the WHERE clause — proves RLS itself, not just app-level filtering, is enforcing isolation (suspenders)", async () => {
    const violationId = await reportViolationAs(authedA);
    const rows = await rawSelectAsTenant(TENANT_B, violationId);
    expect(rows).toHaveLength(0);
  });

  it("RLS check has teeth: with FORCE ROW LEVEL SECURITY temporarily stripped, the SAME raw cross-tenant query DOES leak the row — proving the previous test would catch a real RLS regression, not just pass vacuously", async () => {
    const violationId = await reportViolationAs(authedA);

    await sqlClient`ALTER TABLE adv_enforcement.adv_violations NO FORCE ROW LEVEL SECURITY`;
    try {
      // advertisement_svc owns this table (it created it in
      // migrations/0002_enforcement_schema.sql), so without FORCE it now
      // bypasses its own table's RLS policy entirely — the leak this proves
      // is exactly what FORCE ROW LEVEL SECURITY exists to prevent.
      const leaked = await rawSelectAsTenant(TENANT_B, violationId);
      expect(leaked).toHaveLength(1);
      expect(leaked[0]!.tenant_id).toBe(TENANT_A);
    } finally {
      await sqlClient`ALTER TABLE adv_enforcement.adv_violations FORCE ROW LEVEL SECURITY`;
    }

    // Restored: the isolation check passes again.
    const restored = await rawSelectAsTenant(TENANT_B, violationId);
    expect(restored).toHaveLength(0);
  });
});

describe("violation lifecycle — persisted state + cache invalidation", () => {
  it("issueNotice persists noticeDetails and invalidates the read-through cache", async () => {
    const violationId = await reportViolationAs(authedA);
    const res = await app.inject({
      method: "POST",
      url: `/v1/advertisement/violations/${violationId}/notice`,
      headers: authedA,
      payload: { noticeDetails: { servedTo: "site owner", method: "in-person" } },
    });
    expect(res.statusCode).toBe(202);
    await settle();

    const row = await repo.findById(violationId, TENANT_A);
    expect(row!.status).toBe("notice_issued");
    expect(row!.noticeDetails).toEqual({ servedTo: "site owner", method: "in-person" });

    const getRes = await app.inject({ method: "GET", url: `/v1/advertisement/violations/${violationId}`, headers: authedA });
    expect((getRes.json() as { data: { status: string } }).data.status).toBe("notice_issued");
  });

  it("imposePenalty rejects a non-numeric penaltyMinor with 400 before 202 (money field regression)", async () => {
    const violationId = await reportViolationAs(authedA);
    await app.inject({ method: "POST", url: `/v1/advertisement/violations/${violationId}/notice`, headers: authedA, payload: { noticeDetails: {} } });
    await settle();

    const res = await app.inject({
      method: "POST",
      url: `/v1/advertisement/violations/${violationId}/penalty`,
      headers: authedA,
      payload: { penaltyMinor: "not-a-number" },
    });
    expect(res.statusCode).toBe(400);

    const row = await repo.findById(violationId, TENANT_A);
    expect(row!.status).toBe("notice_issued"); // untouched — no penalty command was ever published
  });

  it("imposePenalty accepts a valid penaltyMinor and persists it", async () => {
    const violationId = await reportViolationAs(authedA);
    await app.inject({ method: "POST", url: `/v1/advertisement/violations/${violationId}/notice`, headers: authedA, payload: { noticeDetails: {} } });
    await settle();

    const res = await app.inject({
      method: "POST",
      url: `/v1/advertisement/violations/${violationId}/penalty`,
      headers: authedA,
      payload: { penaltyMinor: "750000" },
    });
    expect(res.statusCode).toBe(202);
    await settle();

    const row = await repo.findById(violationId, TENANT_A);
    expect(row!.status).toBe("penalty_imposed");
    expect(row!.penaltyMinor).toBe(750000n);
  });

  it("orderRemoval then recordRemoval carry the violation to removed", async () => {
    const violationId = await reportViolationAs(authedA);
    await app.inject({ method: "POST", url: `/v1/advertisement/violations/${violationId}/notice`, headers: authedA, payload: { noticeDetails: {} } });
    await settle();
    await app.inject({ method: "POST", url: `/v1/advertisement/violations/${violationId}/penalty`, headers: authedA, payload: { penaltyMinor: "500000" } });
    await settle();

    const order = await app.inject({ method: "POST", url: `/v1/advertisement/violations/${violationId}/removal-order`, headers: authedA, payload: { removalDeadline: "2026-12-31" } });
    expect(order.statusCode).toBe(202);
    await settle();
    expect((await repo.findById(violationId, TENANT_A))!.status).toBe("removal_ordered");

    const record = await app.inject({ method: "POST", url: `/v1/advertisement/violations/${violationId}/removal-record`, headers: authedA, payload: { removalNotes: "Hoarding taken down by owner" } });
    expect(record.statusCode).toBe(202);
    await settle();
    const final = await repo.findById(violationId, TENANT_A);
    expect(final!.status).toBe("removed");
    expect(final!.removalNotes).toBe("Hoarding taken down by owner");
  });

  it("rejects issuing a notice twice (pre-accept state validation)", async () => {
    const violationId = await reportViolationAs(authedA);
    await app.inject({ method: "POST", url: `/v1/advertisement/violations/${violationId}/notice`, headers: authedA, payload: { noticeDetails: {} } });
    await settle();

    const again = await app.inject({ method: "POST", url: `/v1/advertisement/violations/${violationId}/notice`, headers: authedA, payload: { noticeDetails: {} } });
    expect(again.statusCode).toBe(422);
  });
});

describe("collision-prone violation-number generation (regression)", () => {
  it("two violations reported back-to-back get distinct, non-colliding violation numbers", async () => {
    const [idA, idB] = await Promise.all([reportViolationAs(authedA), reportViolationAs(authedA)]);
    const [rowA, rowB] = await Promise.all([repo.findById(idA, TENANT_A), repo.findById(idB, TENANT_A)]);
    expect(rowA).not.toBeNull();
    expect(rowB).not.toBeNull();
    expect(rowA!.violationNumber).not.toBe(rowB!.violationNumber);
  });
});
