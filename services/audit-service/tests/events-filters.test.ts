/**
 * GAP-HR-AUDIT-LOG-07/08: GET /audit/events narrowing params -- `service`
 * (comma-separated), `resourceType` and `actor` -- applied in SQL, so they
 * hold across pages, not just within one fetched page. Seeds through the
 * real consumer (events.events is append-only; see events-routes.test.ts).
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
const ACTOR_A = randomUUID();
const ACTOR_B = randomUUID();
const token = () => signToken({ sub: randomUUID(), tid: TENANT, roles: ["audit_officer"], sid: "s" }, SECRET, 3600);

function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

let app: FastifyInstance;

async function list(qs: string): Promise<Array<{ payload: { service?: string; resourceType?: string }; actor: { actorId?: string; email?: string } }>> {
  const res = await app.inject({
    method: "GET",
    url: `/audit/events?from=2020-01-01T00:00:00.000Z&${qs}`,
    headers: { authorization: `Bearer ${token()}` },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  return Array.isArray(body) ? body : body.data;
}

beforeAll(async () => {
  app = await buildApp();
  const q = wire(new MemoryQueue());
  registerAuditConsumers(q);
  await q.start();
  const publish = (actorId: string, actor: Record<string, unknown>, payload: Record<string, unknown>) =>
    q.publish("audit.event.record", {
      messageId: randomUUID(), type: "audit.event.record", tenantId: TENANT, actorId,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { outcome: "success", action: "x", actor, ...payload },
    });
  await publish(ACTOR_A, { email: "Asha.Rao@gov.in" }, { service: "hrms", resourceType: "employee", resourceId: "e1" });
  await publish(ACTOR_A, { email: "Asha.Rao@gov.in" }, { service: "payroll", resourceType: "payroll_run", resourceId: "p1" });
  await publish(ACTOR_B, { name: "100% Sharma_x" }, { service: "hrms", resourceType: "leave_app", resourceId: "l1" });
  await publish(ACTOR_B, {}, { service: "policy", resourceType: "role", resourceId: "r1" });
  // Poll for the 4 seeded rows instead of a fixed sleep: the consumer
  // serialises per-tenant hash-chain appends, so under parallel test load a
  // fixed delay is flaky.
  for (let i = 0; i < 50; i++) {
    const n = (await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, TENANT))))).length;
    if (n >= 4) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await q.stop();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /audit/events narrowing params", () => {
  it("no filter returns every service's events", async () => {
    expect((await list("")).length).toBe(4);
  });

  it("service=hrms,payroll excludes other services' events (08)", async () => {
    const rows = await list("service=hrms,payroll");
    expect(rows.map((r) => r.payload.service).sort()).toEqual(["hrms", "hrms", "payroll"]);
  });

  it("resourceType narrows to that type only (07)", async () => {
    const rows = await list("resourceType=payroll_run");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.resourceType).toBe("payroll_run");
  });

  it("actor matches an exact actorId (07)", async () => {
    expect((await list(`actor=${ACTOR_B}`)).length).toBe(2);
  });

  it("actor matches a case-insensitive email substring (07)", async () => {
    const rows = await list("actor=asha.rao");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actor.email === "Asha.Rao@gov.in")).toBe(true);
  });

  it("LIKE wildcards in actor are matched literally, not as patterns (07)", async () => {
    expect(await list("actor=%25")).toHaveLength(1);          // only "100% Sharma_x" contains a literal %
    expect(await list("actor=a_a")).toHaveLength(0);          // "_" must not behave as single-char wildcard
  });

  it("filters combine with AND (07+08)", async () => {
    const rows = await list(`service=hrms&actor=${ACTOR_B}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload.resourceType).toBe("leave_app");
  });
});
