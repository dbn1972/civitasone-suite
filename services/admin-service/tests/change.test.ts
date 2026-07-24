/**
 * SVC-130 — change/release route integration tests (admin-service).
 *
 * Exercises the full governed lifecycle against a real Postgres with RLS:
 *   create → submit → CAB approve (maker-checker + rollback guard) → schedule
 *   (freeze conflict) → start → PIR complete (release-notes outbox broadcast).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-dddd-4000-8000-000000000001";
const REQUESTER = "11111111-dddd-4000-8000-000000000001";
const APPROVER = "22222222-dddd-4000-8000-000000000002";

function token(actorId: string, roles: string[] = ["tenant_admin"], tenantId = TENANT): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-chg" }, SECRET, 3600);
}
// Only the bearer token; app.inject sets content-type automatically when a
// payload object is present, so bodyless POSTs never carry an empty JSON body.
function auth(actorId: string, roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(actorId, roles, tenantId)}` };
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

/**
 * Read an RLS-forced table directly, with the tenant GUC set on the same
 * connection (mirrors how the app's scoped transactions satisfy RLS). Without
 * this a raw pooled query as the NOBYPASSRLS service role sees zero rows.
 */
function readAsTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

/**
 * Fetch this tenant's broadcast outbox messages for a change. The outbox stores
 * `payload` as a (jsonb-encoded) JSON string across the whole codebase, so we
 * parse it in JS rather than via a SQL json path.
 */
async function broadcastsFor(tenantId: string, changeId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await readAsTenant(tenantId, (sql) => sql<Array<{ payload: string }>>`
    SELECT payload FROM _outbox.messages
    WHERE tenant_id = ${tenantId} AND topic = 'notification.broadcast.send'`);
  return rows
    .map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>)
    .filter((p) => p.changeId === changeId);
}

async function createChange(body: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/admin/change/requests", headers: auth(REQUESTER),
    payload: {
      title: "Upgrade payments gateway", type: "normal", risk: "high",
      affectedServices: ["finance-service", "billing-service"],
      description: "Roll out gateway v2 across finance and billing.",
      rollbackPlan: "Flip the feature flag back to v1 and redeploy N-1.",
      ...body,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function advanceTo(id: string, stage: "submitted" | "approved"): Promise<void> {
  const s = await app.inject({ method: "POST", url: `/v1/admin/change/requests/${id}/submit`, headers: auth(REQUESTER) });
  expect(s.statusCode).toBe(200);
  if (stage === "submitted") return;
  const a = await app.inject({
    method: "POST", url: `/v1/admin/change/requests/${id}/approve`,
    headers: auth(APPROVER, ["tenant_admin"]), payload: {},
  });
  expect(a.statusCode).toBe(200);
}

// ── auth ──────────────────────────────────────────────────────────────────
describe("change routes — auth", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/change/requests" });
    expect(res.statusCode).toBe(401);
  });
  it("403 for a non-admin role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/change/requests", headers: auth(REQUESTER, ["employee"]) });
    expect(res.statusCode).toBe(403);
  });
  it("200 list for tenant_admin", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/change/requests", headers: auth(REQUESTER) });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });
});

// ── create + validation ─────────────────────────────────────────────────────
describe("change create + validation", () => {
  it("creates a draft change request (201)", async () => {
    const id = await createChange();
    expect(id).toBeDefined();
    const detail = await app.inject({ method: "GET", url: `/v1/admin/change/requests/${id}`, headers: auth(REQUESTER) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.status).toBe("draft");
    // audit trail records the initial draft transition
    expect(detail.json().audit.length).toBeGreaterThanOrEqual(1);
  });

  it("400 on an invalid change type", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/change/requests", headers: auth(REQUESTER),
      payload: { title: "bad", type: "banana", description: "long enough description here" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 fetching an unknown change", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/admin/change/requests/99999999-dddd-4000-8000-000000000000", headers: auth(REQUESTER),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── CAB approval: maker-checker ──────────────────────────────────────────────
describe("CAB approval — maker-checker", () => {
  it("blocks self-approval by the requester (MAKER_CHECKER_VIOLATION)", async () => {
    const id = await createChange();
    await advanceTo(id, "submitted");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/approve`, headers: auth(REQUESTER), payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("allows approval by a different CAB member", async () => {
    const id = await createChange();
    await advanceTo(id, "submitted");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/approve`, headers: auth(APPROVER), payload: { note: "CAB ok" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
  });
});

// ── rollback-plan guard ──────────────────────────────────────────────────────
describe("rollback-plan guard", () => {
  it("blocks approval when no rollback plan is present (ROLLBACK_REQUIRED)", async () => {
    const id = await createChange({ rollbackPlan: undefined });
    await advanceTo(id, "submitted");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/approve`, headers: auth(APPROVER), payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("ROLLBACK_REQUIRED");
  });

  it("approval succeeds once a rollback plan is supplied", async () => {
    const id = await createChange({ rollbackPlan: undefined });
    await advanceTo(id, "submitted");
    const rb = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/rollback-plan`, headers: auth(REQUESTER),
      payload: { rollbackPlan: "Restore prior release and re-run smoke tests." },
    });
    expect(rb.statusCode).toBe(200);
    const res = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/approve`, headers: auth(APPROVER), payload: {},
    });
    expect(res.statusCode).toBe(200);
  });
});

// ── invalid transitions ──────────────────────────────────────────────────────
describe("state machine enforcement", () => {
  it("cannot approve a draft (must be submitted first)", async () => {
    const id = await createChange();
    const res = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/approve`, headers: auth(APPROVER), payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });
  it("cannot start an unscheduled change", async () => {
    const id = await createChange();
    await advanceTo(id, "approved");
    const res = await app.inject({ method: "POST", url: `/v1/admin/change/requests/${id}/start`, headers: auth(REQUESTER) });
    expect(res.statusCode).toBe(409);
  });
});

// ── freeze conflict ──────────────────────────────────────────────────────────
describe("release window — freeze conflict", () => {
  it("rejects scheduling into a change-freeze window (FREEZE_CONFLICT)", async () => {
    // register a freeze
    const freeze = await app.inject({
      method: "POST", url: "/v1/admin/change/freezes", headers: auth(REQUESTER),
      payload: {
        name: "Fiscal year-end freeze", reason: "No prod changes during close",
        startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-10T00:00:00.000Z",
      },
    });
    expect(freeze.statusCode).toBe(201);

    const id = await createChange();
    await advanceTo(id, "approved");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/schedule`, headers: auth(REQUESTER),
      payload: { windowStart: "2026-09-05T02:00:00.000Z", windowEnd: "2026-09-05T04:00:00.000Z" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("FREEZE_CONFLICT");
  });

  it("lists freezes for the tenant", async () => {
    const name = `Listable freeze ${Date.now()}`;
    const create = await app.inject({
      method: "POST", url: "/v1/admin/change/freezes", headers: auth(REQUESTER),
      payload: { name, reason: "listing probe", startsAt: "2027-01-01T00:00:00.000Z", endsAt: "2027-01-05T00:00:00.000Z" },
    });
    expect(create.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/v1/admin/change/freezes", headers: auth(REQUESTER) });
    expect(list.statusCode).toBe(200);
    const data = list.json().data as Array<{ name: string; startsAt: string }>;
    const found = data.find((f) => f.name === name);
    expect(found).toBeDefined();
    expect(found?.startsAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("rejects a freeze whose end precedes its start (422)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/change/freezes", headers: auth(REQUESTER),
      payload: { name: "bad freeze", reason: "invalid", startsAt: "2027-02-05T00:00:00.000Z", endsAt: "2027-02-01T00:00:00.000Z" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_WINDOW");
  });

  it("allows scheduling outside any freeze window", async () => {
    const id = await createChange();
    await advanceTo(id, "approved");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/schedule`, headers: auth(REQUESTER),
      payload: { windowStart: "2026-12-01T02:00:00.000Z", windowEnd: "2026-12-01T04:00:00.000Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("scheduled");
  });

  it("rejects an invalid window (end before start)", async () => {
    const id = await createChange();
    await advanceTo(id, "approved");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/schedule`, headers: auth(REQUESTER),
      payload: { windowStart: "2026-12-01T04:00:00.000Z", windowEnd: "2026-12-01T02:00:00.000Z" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_WINDOW");
  });
});

// ── full lifecycle + PIR + release-notes broadcast ──────────────────────────
describe("full lifecycle: PIR + release-notes broadcast outbox", () => {
  it("runs create→…→complete(success) and emits a release-notes broadcast to the outbox", async () => {
    const id = await createChange();
    await advanceTo(id, "approved");
    const sch = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/schedule`, headers: auth(REQUESTER),
      payload: { windowStart: "2026-11-01T02:00:00.000Z", windowEnd: "2026-11-01T04:00:00.000Z" },
    });
    expect(sch.statusCode).toBe(200);
    const start = await app.inject({ method: "POST", url: `/v1/admin/change/requests/${id}/start`, headers: auth(REQUESTER) });
    expect(start.statusCode).toBe(200);

    const complete = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/complete`, headers: auth(REQUESTER),
      payload: { outcome: "success", notes: "Deployed cleanly, smoke tests green.", releaseNotes: "Payments gateway v2 is now live." },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().status).toBe("completed");

    // A release-notes broadcast must be sitting in the transactional outbox.
    const broadcasts = await broadcastsFor(TENANT, id);
    expect(broadcasts.length).toBe(1);
    expect(broadcasts[0].channel).toBe("release_notes");
    expect(String(broadcasts[0].releaseNotes)).toContain("Payments gateway v2");

    // PIR recorded on the change row.
    const detail = await app.inject({ method: "GET", url: `/v1/admin/change/requests/${id}`, headers: auth(REQUESTER) });
    expect(detail.json().data.pirOutcome).toBe("success");
    expect(detail.json().data.pirNotes).toContain("smoke tests");
    // audit trail spans every transition (draft→submitted→approved→scheduled→in_progress→completed).
    expect(detail.json().audit.length).toBeGreaterThanOrEqual(6);
  });

  it("records a rolled_back PIR without a broadcast", async () => {
    const id = await createChange();
    await advanceTo(id, "approved");
    await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/schedule`, headers: auth(REQUESTER),
      payload: { windowStart: "2026-11-02T02:00:00.000Z", windowEnd: "2026-11-02T04:00:00.000Z" },
    });
    await app.inject({ method: "POST", url: `/v1/admin/change/requests/${id}/start`, headers: auth(REQUESTER) });
    const complete = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/complete`, headers: auth(REQUESTER),
      payload: { outcome: "rolled_back", notes: "Latency regression; rolled back." },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().status).toBe("rolled_back");
    // A rolled-back release emits no user-communication broadcast.
    const broadcasts = await broadcastsFor(TENANT, id);
    expect(broadcasts.length).toBe(0);
  });
});

// ── reject path ──────────────────────────────────────────────────────────────
describe("rejection", () => {
  it("a CAB member can reject a submitted change", async () => {
    const id = await createChange();
    await advanceTo(id, "submitted");
    const res = await app.inject({
      method: "POST", url: `/v1/admin/change/requests/${id}/reject`, headers: auth(APPROVER),
      payload: { reason: "Insufficient test evidence." },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("rejected");
  });
});
