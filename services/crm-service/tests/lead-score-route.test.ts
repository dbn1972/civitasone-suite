/**
 * crm-service — Lead score route RLS regression test.
 *
 * Regression for a silent-empty-result bug: score-route.ts queries
 * `sqlClient` (raw postgres.js client) directly against `crm.contacts`,
 * `crm.deals`, `crm.accounts`, `crm.activities` — all four RLS-ENABLEd AND
 * FORCEd. The service connects as `crm_svc` (rolsuper=false,
 * rolbypassrls=false). `db.transaction()` is the only place `app.tenant_id`
 * gets set (via the tenant tx hook / wrapWithTenantGuc); this route never
 * calls it, so RLS fails CLOSED — every raw query returns SUCCESS with
 * EMPTY rows. Nothing throws, nothing 500s. The route "not found" branch
 * (rows.length === 0) then silently returns a fallback score for a contact
 * that actually exists, for every tenant, every time.
 *
 * This test seeds a real contact via the tenant-scoped path (Drizzle
 * `db.transaction()`, which DOES set the GUC) and asserts the route can see
 * it — mirroring services/helpdesk-service/tests/sla-engine-routes.test.ts.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { contacts, accounts } from "../src/modules/contacts/schema.js";
import { deals } from "../src/modules/deals/schema.js";
import { activities } from "../src/modules/activities/schema.js";
import { extractLeadFeatures, computeFallbackScore } from "../src/modules/leads/ml-scoring.js";

/** The score returned for a lead the route's own query cannot see at all. */
const DEFAULT_MISSING_DATA_SCORE = computeFallbackScore(extractLeadFeatures({})).score;

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "0d1a5e00-4000-4000-8000-000000000501";
const ACTOR = "0d1a5e00-5000-4000-8000-000000000501";

function token(tenantId = TENANT, roles = ["crm_user"]) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-score-001" }, SECRET);
}

async function cleanup() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(activities).where(eq(activities.tenantId, TENANT));
      await tx.delete(deals).where(eq(deals.tenantId, TENANT));
      await tx.delete(contacts).where(eq(contacts.tenantId, TENANT));
      await tx.delete(accounts).where(eq(accounts.tenantId, TENANT));
    }),
  );
}

/** Seed a contact (plus a deal and an activity) via the GUC-setting path. */
async function seedScorableContact(): Promise<string> {
  const contactId = randomUUID();
  const accountId = randomUUID();
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(accounts).values({
        id: accountId, tenantId: TENANT, name: "Acme Corp", status: "active",
        createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.insert(contacts).values({
        id: contactId, tenantId: TENANT, name: "Jane Prospect", accountId,
        leadStatus: "new", leadSource: "referral", status: "active",
        createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.insert(deals).values({
        id: randomUUID(), tenantId: TENANT, name: "Acme Deal", contactId,
        stage: "Lead", status: "active", valueMinor: 500_000_00n,
        createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.insert(activities).values({
        id: randomUUID(), tenantId: TENANT, actorName: "Jane Prospect",
        text: "Called prospect", contactId, type: "call",
        createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
    }),
  );
  return contactId;
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GET /v1/crm/leads/:id/score", () => {
  it("sees a seeded contact and returns a non-fallback-default score (regression: raw sqlClient query bypassed RLS GUC and always returned empty)", async () => {
    const contactId = await seedScorableContact();

    // Force fallback scoring path deterministically — this test's contract
    // is about whether the route's OWN sqlClient query can see the row at
    // all, not about ml-service integration.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no ml-service in test"));

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/leads/${contactId}/score`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    fetchSpy.mockRestore();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Before the fix: rows.length === 0 always (RLS fails closed with no
    // GUC set), so the route takes the "not found" branch and returns the
    // all-missing-data fallback score (interactionCount=0, dealValue=unknown,
    // sourceChannel=unknown) regardless of the seeded data. With the seeded
    // referral lead + 1 activity + 1 deal, the fallback score computed from
    // the REAL row must beat the all-missing-data fallback score.
    expect(body.data.isFallback).toBe(true);
    expect(body.data.score).toBeGreaterThan(DEFAULT_MISSING_DATA_SCORE);
  });

  it("tenant isolation: another tenant cannot see this tenant's contact via the score route", async () => {
    const contactId = await seedScorableContact();
    const OTHER_TENANT = "0d1a5e00-6000-4000-8000-000000000502";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no ml-service in test"));
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/leads/${contactId}/score`,
      headers: { authorization: `Bearer ${token(OTHER_TENANT)}` },
    });
    await app.close();
    fetchSpy.mockRestore();

    expect(res.statusCode).toBe(200);
    // Not found for the other tenant → default (all-missing-data) fallback.
    const body = res.json();
    expect(body.data.isFallback).toBe(true);
    expect(body.data.score).toBe(DEFAULT_MISSING_DATA_SCORE);
  });

  it("returns 200 with default fallback when the lead does not exist", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no ml-service in test"));
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/leads/${randomUUID()}/score`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    fetchSpy.mockRestore();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.isFallback).toBe(true);
  });

  it("returns 400 for an invalid lead id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/leads/not-a-uuid/score",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/crm/leads/${randomUUID()}/score` });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without CRM access", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/leads/${randomUUID()}/score`,
      headers: { authorization: `Bearer ${token(TENANT, ["citizen"])}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});
