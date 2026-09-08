/**
 * COMP-002 — route integration tests for the real citizen service-request
 * portal (POST/GET/PATCH /v1/citizen/requests, GET .../status, GET
 * /v1/citizen/portal/metrics) and the completed profile GET/PATCH, replacing
 * the fabricated-success stubs formerly in modules/gap/routes.ts.
 *
 * Covers: genuine persistence + retrieval (the gap report's definition of
 * done), real audit event emission, ownership/authz (citizen vs officer-tier),
 * RLS cross-tenant isolation, status-history trail, and the honest 501 for
 * alerts/notices/surveys (no backing store).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerServiceRequestConsumers } from "../src/modules/requests/consumer.js";
import { registerPortalConsumers } from "../src/modules/portal/consumer.js";
import type { FastifyInstance } from "fastify";

registerServiceRequestConsumers(queue);
registerPortalConsumers(queue);
await queue.start();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "a1a1a1a1-0000-4000-8000-000000000031";
const TENANT_B = "b2b2b2b2-0000-4000-8000-000000000031";
const CITIZEN   = "11111111-0000-4000-8000-000000000031";
const CITIZEN_2 = "44444444-0000-4000-8000-000000000031";
const OFFICER   = "22222222-0000-4000-8000-000000000031";

function tok(tenant: string, actor: string, roles = ["citizen"]) {
  return signToken({ sub: actor, tid: tenant, roles, sid: "sess-svcreq" }, SECRET, 3600);
}
function hdr(t: string, tenant = TENANT_A) { return { authorization: `Bearer ${t}`, "content-type": "application/json", "x-tenant-id": tenant }; }

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

async function outboxTopics(tenant: string): Promise<string[]> {
  // _outbox.messages has FORCED RLS — read under the transaction-LOCAL tenant GUC.
  const rows = await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenant}, true)`;
    return sql`SELECT topic FROM _outbox.messages WHERE tenant_id = ${tenant}`;
  });
  return rows.map((r: { topic: string }) => r.topic);
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ═══════════════════ COMP-002 citizen service requests ═══════════════════
describe("COMP-002 POST/GET/PATCH /v1/citizen/requests — real persistence, not fabricated", () => {
  let requestId: string;

  it("POST creates nothing fabricated — 202, then a real GET actually retrieves it", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/citizen/requests", headers: hdr(tok(TENANT_A, CITIZEN)),
      payload: { subject: "Streetlight not working", description: "Pole #42 on MG Road has been dark for a week.", category: "streetlight" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    requestId = res.json().id;

    // Definition of done: genuinely retrievable afterward via a GET.
    const got = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/requests/${requestId}`, headers: hdr(tok(TENANT_A, CITIZEN)) });
      return g.statusCode === 200 ? g.json().data : null;
    });
    expect(got.id).toBe(requestId);
    expect(got.status).toBe("submitted");
    expect(got.subject).toBe("Streetlight not working");
    expect(got.citizenId).toBe(CITIZEN);
  });

  it("a real audit event and the domain event were emitted (not silently dropped)", async () => {
    const topics = await outboxTopics(TENANT_A);
    expect(topics).toContain("audit.event.record");
    expect(topics).toContain("citizen.service_request.submitted");
  });

  it("GET /v1/citizen/requests/:id/status returns a real transition history, not an empty stub", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/citizen/requests/${requestId}/status`, headers: hdr(tok(TENANT_A, CITIZEN)) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("submitted");
    expect(res.json().data.history).toHaveLength(1);
    expect(res.json().data.history[0]).toMatchObject({ fromStatus: null, toStatus: "submitted" });
  });

  it("OWNERSHIP: a different citizen cannot read or update this request (404, not leaked)", async () => {
    const get = await app.inject({ method: "GET", url: `/v1/citizen/requests/${requestId}`, headers: hdr(tok(TENANT_A, CITIZEN_2)) });
    expect(get.statusCode).toBe(404);

    const patch = await app.inject({
      method: "PATCH", url: `/v1/citizen/requests/${requestId}`, headers: hdr(tok(TENANT_A, CITIZEN_2)), payload: { status: "cancelled" },
    });
    expect(patch.statusCode).toBe(404);
  });

  it("AUTHZ: the owning citizen cannot escalate status themselves (only cancel their own)", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/citizen/requests/${requestId}`, headers: hdr(tok(TENANT_A, CITIZEN)), payload: { status: "resolved" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("PATCH performs a REAL update (not a fabricated {status:'updated'}) — officer resolves it", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/citizen/requests/${requestId}`,
      headers: hdr(tok(TENANT_A, OFFICER, ["citizen_officer"])),
      payload: { status: "resolved", note: "Pole replaced" },
    });
    expect(res.statusCode).toBe(202);

    const resolved = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/requests/${requestId}`, headers: hdr(tok(TENANT_A, OFFICER, ["citizen_officer"])) });
      const body = g.statusCode === 200 ? g.json().data : null;
      return body?.status === "resolved" ? body : null;
    });
    expect(resolved.resolvedAt).toBeTruthy();

    const status = await app.inject({ method: "GET", url: `/v1/citizen/requests/${requestId}/status`, headers: hdr(tok(TENANT_A, OFFICER, ["citizen_officer"])) });
    expect(status.json().data.history).toHaveLength(2);
    expect(status.json().data.history[1]).toMatchObject({ fromStatus: "submitted", toStatus: "resolved", note: "Pole replaced" });

    const topics = await outboxTopics(TENANT_A);
    expect(topics).toContain("citizen.service_request.status_changed");
  });

  it("a resolved (terminal) request cannot be transitioned further — no-op, not a fake success", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/citizen/requests/${requestId}`,
      headers: hdr(tok(TENANT_A, OFFICER, ["citizen_officer"])), payload: { status: "in_progress" },
    });
    expect(res.statusCode).toBe(202); // command accepted...
    await new Promise((r) => setTimeout(r, 200));
    const g = await app.inject({ method: "GET", url: `/v1/citizen/requests/${requestId}`, headers: hdr(tok(TENANT_A, OFFICER, ["citizen_officer"])) });
    expect(g.json().data.status).toBe("resolved"); // ...but the terminal-state guard makes it a no-op.
  });

  it("GET /v1/citizen/portal/metrics computes real counts, not hardcoded zeros", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/citizen/portal/metrics", headers: hdr(tok(TENANT_A, OFFICER, ["citizen_officer"])) });
    expect(res.statusCode).toBe(200);
    const m = res.json().data;
    expect(typeof m.totalServices).toBe("number");
    expect(typeof m.activeRequests).toBe("number");
    expect(m.resolvedThisMonth).toBeGreaterThanOrEqual(1);
    expect(m.avgResolutionDays).toBeGreaterThanOrEqual(0);
  });

  it("RLS: tenant B cannot read tenant A's request (404)", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/citizen/requests/${requestId}`,
      headers: { authorization: `Bearer ${tok(TENANT_B, OFFICER, ["citizen_officer"])}`, "x-tenant-id": TENANT_B },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ═══════════════════ COMP-002 profile GET/PATCH (real table) ═══════════════════
describe("COMP-002 GET/PATCH /v1/citizen/profiles/:id — wired to the real portal.citizen_profiles table", () => {
  it("create, then GET returns the real row; PATCH performs a real update", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/citizen/profiles", headers: hdr(tok(TENANT_A, CITIZEN)),
      payload: { name: "Asha Kumar", email: "asha@example.com", consentGranted: true },
    });
    expect(create.statusCode).toBe(202);
    const id = create.json().id;

    const profile = await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/profiles/${id}`, headers: hdr(tok(TENANT_A, CITIZEN)) });
      return g.statusCode === 200 ? g.json().data : null;
    });
    expect(profile.name).toBe("Asha Kumar");

    const patch = await app.inject({
      method: "PATCH", url: `/v1/citizen/profiles/${id}`, headers: hdr(tok(TENANT_A, CITIZEN)), payload: { ward: "Ward 7" },
    });
    expect(patch.statusCode).toBe(202);

    await waitFor(async () => {
      const g = await app.inject({ method: "GET", url: `/v1/citizen/profiles/${id}`, headers: hdr(tok(TENANT_A, CITIZEN)) });
      return g.statusCode === 200 && g.json().data.ward === "Ward 7" ? g.json().data : null;
    });
  });
});

// ═══════════════════ COMP-002 honest 501s (no fabricated empty lists) ═══════════════════
describe("COMP-002 alerts/notices/surveys — honest 501, not a fabricated empty success", () => {
  for (const path of ["/v1/citizen/alerts", "/v1/citizen/notices", "/v1/citizen/surveys"]) {
    it(`GET ${path} returns 501 NOT_IMPLEMENTED (no backing store) rather than a fake []`, async () => {
      const res = await app.inject({ method: "GET", url: path, headers: hdr(tok(TENANT_A, CITIZEN)) });
      expect(res.statusCode).toBe(501);
      expect(res.json().code).toBe("NOT_IMPLEMENTED");
    });
  }
});
