/**
 * audit-service events module route tests
 *
 * Covers:
 *   GET /audit/events        — 401 / 403 (wrong role) / 200 (own tenant) / 403 (cross-tenant, non-admin)
 *   GET /v1/audit/events     — 401 / 403 / 200, plus tenantScoped=false admin gate
 *   GET /audit/events/:id    — 401 / 403 / 404 (random id) / 200 (seeded event)
 *
 * Audit events are APPEND-ONLY (events.events has BEFORE UPDATE/DELETE triggers
 * that reject mutation) — there is no direct test insert. A seed row is created
 * by going through the real consumer (registerAuditConsumers + publish
 * "audit.event.record"), mirroring tests/audit.test.ts's "DB-backed audit
 * ledger" section. wireTenantAwareQueue is required because a bare
 * `new MemoryQueue()` does not auto-wrap subscribed handlers with
 * withTenantConsumer, so db.transaction() inside the consumer would run with
 * no RLS GUC set.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { auditEvents } from "../src/modules/events/schema.js";
import { registerAuditConsumers } from "../src/modules/events/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

let app: FastifyInstance;
let seededEventId: string;

beforeAll(async () => {
  app = await buildApp();

  // Seed one real audit event row for TENANT via the real consumer path.
  const q = wireTenantAwareQueue(new MemoryQueue());
  registerAuditConsumers(q);
  await q.start();
  const messageId = randomUUID();
  await q.publish("audit.event.record", {
    messageId, type: "audit.event.record", tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { service: "policy", action: "create", resourceType: "role", resourceId: "r1", outcome: "success" },
  });
  await new Promise((r) => setTimeout(r, 400));
  await q.stop();

  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.tenantId, TENANT))));
  expect(rows.length).toBeGreaterThanOrEqual(1);
  seededEventId = rows[0]!.id;
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /audit/events", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/audit/events" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without audit access (employee)", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: "/audit/events",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 for audit_officer reading its own tenant, includes the seeded event", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: "/audit/events",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data.some((e: { id?: string }) => e.id === seededEventId)).toBe(true);
  });

  it("403 for a non-admin role passing tenantId= a different tenant (cross-tenant)", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/audit/events?tenantId=${OTHER_TENANT}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 for an admin role (audit_admin) passing tenantId= a different tenant", async () => {
    const jwt = token(["audit_admin"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/audit/events?tenantId=${OTHER_TENANT}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /v1/audit/events", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit/events" });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without audit access (employee)", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: "/v1/audit/events",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 for audit_officer reading its own tenant", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: "/v1/audit/events",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const data = Array.isArray(body) ? body : body.data ?? [];
    expect(data.some((e: { id?: string }) => e.id === seededEventId)).toBe(true);
  });

  it("403 for audit_officer with tenantScoped=false and a cross-tenant tenantId", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/events?tenantScoped=false&tenantId=${OTHER_TENANT}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 for super_admin with tenantScoped=false and a cross-tenant tenantId", async () => {
    const jwt = token(["super_admin"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/events?tenantScoped=false&tenantId=${OTHER_TENANT}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /audit/events/:id", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/audit/events/${randomUUID()}` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role without audit access (employee)", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/audit/events/${randomUUID()}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for a random id", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/audit/events/${randomUUID()}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 for the seeded event's real id", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/audit/events/${seededEventId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(seededEventId);
  });
});
