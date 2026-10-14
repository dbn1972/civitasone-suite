/**
 * GAP-TENANT-ADMIN-AUDIT-04/-06: GET /v1/audit/events/summary returns whole-history
 * counts for the caller's tenant — independent of any list page size — and never
 * counts another tenant's events. Seeds through the real consumer.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { auditEvents } from "../src/modules/events/schema.js";
import { registerAuditConsumers } from "../src/modules/events/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const hdr = (roles: string[], tid = TENANT) => ({ authorization: `Bearer ${signToken({ sub: randomUUID(), tid, roles, sid: "s" }, SECRET, 3600)}` });

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

let app: FastifyInstance;
const SEEDED = 7; // 4 info + 2 error + 1 critical

beforeAll(async () => {
  app = await buildApp();
  const q = wire(new MemoryQueue());
  registerAuditConsumers(q);
  await q.start();
  const publish = (tenantId: string, severity: string) =>
    q.publish("audit.event.record", {
      messageId: randomUUID(), type: "audit.event.record", tenantId, actorId: randomUUID(),
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { action: "x", actor: { email: "a@gov.in" }, severity, service: "hrms", resourceType: "employee", resourceId: "e1" },
    });
  for (const sev of ["info", "info", "info", "info", "error", "error", "critical"]) await publish(TENANT, sev);
  await publish(OTHER, "error");
  for (let i = 0; i < 80; i++) {
    const n = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, TENANT))))).length;
    if (n >= SEEDED) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await q.stop();
});

afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GET /v1/audit/events/summary", () => {
  it("counts the whole tenant history, even when the list is capped far below it", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/audit/events?tenantScoped=true&limit=2&from=2020-01-01T00:00:00.000Z", headers: hdr(["audit_officer"]) });
    expect(list.statusCode).toBe(200);
    expect((list.json() as unknown[]).length).toBe(2);

    const res = await app.inject({ method: "GET", url: "/v1/audit/events/summary", headers: hdr(["audit_officer"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(SEEDED);
    expect(body.failures).toBe(3);
    expect(body.success).toBe(4);
    expect(body.last24h).toBe(SEEDED);
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false);
  });

  it("is scoped to the caller's tenant — the other tenant's event is not counted, and a query tenantId is ignored", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/audit/events/summary?tenantId=${OTHER}`, headers: hdr(["audit_officer"]) });
    expect(res.json().total).toBe(SEEDED);
    const other = await app.inject({ method: "GET", url: "/v1/audit/events/summary", headers: hdr(["audit_officer"], OTHER) });
    expect(other.json().total).toBe(1);
  });

  it("403 for a role outside the audit readers, 401 without a token", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/audit/events/summary", headers: hdr(["employee"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/audit/events/summary" })).statusCode).toBe(401);
  });
});
