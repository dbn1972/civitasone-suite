/**
 * `outcome` narrowing on GET /audit/events and GET /audit/events/count (used by admin-service's
 * Security Center to count failed sign-in verifications): applied in SQL, comma-separated,
 * combined with `service`, and strictly tenant-scoped. Seeds through the real consumer.
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
const hdr = (tenant: string) =>
  ({ authorization: `Bearer ${signToken({ sub: randomUUID(), tid: tenant, roles: ["audit_officer"], sid: "s" }, SECRET, 3600)}` });

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

let app: FastifyInstance;
const FROM = "from=2020-01-01T00:00:00.000Z";

async function list(qs: string, tenant = TENANT) {
  const res = await app.inject({ method: "GET", url: `/audit/events?${FROM}&${qs}`, headers: hdr(tenant) });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  return (Array.isArray(body) ? body : body.data) as Array<{ payload: { service?: string; outcome?: string } }>;
}
async function count(qs: string, tenant = TENANT): Promise<number> {
  const res = await app.inject({ method: "GET", url: `/audit/events/count?${FROM}&${qs}`, headers: hdr(tenant) });
  expect(res.statusCode).toBe(200);
  return res.json().total as number;
}

beforeAll(async () => {
  app = await buildApp();
  const q = wire(new MemoryQueue());
  registerAuditConsumers(q);
  await q.start();
  const publish = (tenantId: string, payload: Record<string, unknown>) =>
    q.publish("audit.event.record", {
      messageId: randomUUID(), type: "audit.event.record", tenantId, actorId: randomUUID(),
      correlationId: randomUUID(), schemaVersion: "1.0", payload: { action: "x", ...payload },
    });
  await publish(TENANT, { service: "identity", outcome: "failure", action: "mfa_verify_failed" });
  await publish(TENANT, { service: "identity", outcome: "failure", action: "mfa_verify_failed" });
  await publish(TENANT, { service: "identity", outcome: "denied", action: "status_change" });
  await publish(TENANT, { service: "identity", outcome: "success", action: "mfa_enable" });
  await publish(TENANT, { service: "hrms", outcome: "failure", action: "x" });
  await publish(TENANT, { service: "hrms" }); // no outcome recorded at all
  await publish(OTHER, { service: "identity", outcome: "failure", action: "mfa_verify_failed" });
  for (let i = 0; i < 60; i++) {
    const n = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, TENANT))))).length;
    if (n >= 6) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 200));
  await q.stop();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("outcome filter", () => {
  it("list: outcome=failure returns only failures", async () => {
    const rows = await list("outcome=failure");
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.payload.outcome === "failure")).toBe(true);
  });

  it("list: comma-separated outcomes are OR-ed", async () => {
    expect(await list("outcome=failure,denied")).toHaveLength(4);
  });

  it("combines with service (AND)", async () => {
    const rows = await list("service=identity&outcome=failure");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.payload.service === "identity")).toBe(true);
  });

  it("count agrees with the list for the same filters", async () => {
    expect(await count("service=identity&outcome=failure")).toBe(2);
    expect(await count("outcome=failure,denied")).toBe(4);
    expect(await count("")).toBe(6);
  });

  it("is strictly tenant-scoped: the other tenant's failure is never counted here, and vice versa", async () => {
    expect(await count("service=identity&outcome=failure", OTHER)).toBe(1);
    expect(await count("service=identity&outcome=failure", TENANT)).toBe(2);
  });

  it("an outcome matching nothing yields an empty list and a zero count", async () => {
    expect(await list("outcome=nonexistent")).toHaveLength(0);
    expect(await count("outcome=nonexistent")).toBe(0);
  });

  it("outcome text is bound as a parameter, not interpolated (no injection)", async () => {
    expect(await list("outcome=failure'%20OR%20'1'='1")).toHaveLength(0);
  });
});
