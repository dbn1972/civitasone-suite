/**
 * audit-service plan module tests
 *
 * Covers (previously zero dedicated coverage beyond rls-isolation.test.ts's
 * single create-plan smoke check):
 *  - assertCanStart pure domain guard (draft ok, non-draft throws INVALID_STATUS)
 *  - route auth (401 / 403) + validation (400) on POST /v1/audit/plans
 *  - consumer integration: planCreate, planItemCreate, planStart via a
 *    tenant-aware MemoryQueue + registerPlanConsumers (mirrors tests/para.test.ts)
 *  - planStart re-publish on an already-active plan is rejected by the
 *    assertCanStart guard without corrupting state
 *  - idempotency: republishing the same planCreate messageId inserts exactly one row
 *  - GET /v1/audit/plans/:id 404 for a nonexistent id
 *
 * NOTE: `db` / `sqlClient` are process-wide singletons (services/audit-service/
 * src/shared/db.ts). All setup/teardown of the shared Fastify app and the
 * Postgres connection pool happens ONCE at file scope — closing sqlClient
 * inside more than one describe's afterAll would break every describe that
 * runs after the first one to close it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { auditPlans, auditPlanItems } from "../src/modules/plan/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPlanConsumers } from "../src/modules/plan/consumer.js";
import { assertCanStart, DomainError } from "../src/modules/plan/domain.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const ACTOR  = "00000000-aaaa-4000-8000-000000000020";
const TENANT = "11111111-aaaa-4000-8000-000000000020";
const PLAN_1 = "22222222-bbbb-4000-8000-000000000020";
const PLAN_2 = "22222222-bbbb-4000-8000-000000000021";
const ITEM_1 = "33333333-cccc-4000-8000-000000000020";
const MSG_1  = "44444444-dddd-4000-8000-000000000020";
const MSG_2  = "44444444-dddd-4000-8000-000000000021";
const MSG_3  = "44444444-dddd-4000-8000-000000000022";
const MSG_4  = "44444444-dddd-4000-8000-000000000023";
const MSG_5  = "44444444-dddd-4000-8000-000000000024";

/**
 * Test-harness fix: `new MemoryQueue()` used directly (not the `createQueue()`
 * factory) does NOT auto-wrap subscribed handlers with `withTenantConsumer`.
 * Production wiring (queue-service's `createQueue()`) decorates `subscribe()`
 * so every consumer handler runs inside `runWithTenant(msg.tenantId, ...)`,
 * which is what lets `db.transaction()` pick up the tenant GUC. Without this
 * wrapping, consumer writes/reads here run with no RLS GUC set and every
 * insert/update fails its `WITH CHECK` under FORCE RLS. Mirrors
 * tests/para.test.ts.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

// Test-harness fix: bare db.delete()/db.select()/db.insert() outside
// db.transaction() (or without an active runWithTenant scope) run with no
// RLS GUC set. Wrap all direct DB access in runWithTenant(TENANT, () =>
// db.transaction(...)).
async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(auditPlanItems).where(eq(auditPlanItems.tenantId, TENANT));
    await tx.delete(auditPlans).where(eq(auditPlans.tenantId, TENANT));
    for (const id of [MSG_1, MSG_2, MSG_3, MSG_4, MSG_5]) {
      await tx.delete(processed).where(eq(processed.messageId, id));
    }
  }));
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await wipe();
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("Plan domain — assertCanStart (pure)", () => {
  it("does not throw for a draft plan", () => {
    expect(() => assertCanStart("draft")).not.toThrow();
  });

  it("throws DomainError with code INVALID_STATUS for a non-draft plan", () => {
    try {
      assertCanStart("active");
      expect.unreachable("assertCanStart should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("INVALID_STATUS");
    }
  });

  it.each(["active", "completed", "cancelled", "archived"])(
    "throws INVALID_STATUS for status '%s'",
    (status) => {
      expect(() => assertCanStart(status)).toThrowError("INVALID_STATUS");
    },
  );
});

describe("Plan routes — auth + validation (HTTP)", () => {
  it("POST /v1/audit/plans — 401 when no bearer token is supplied", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/plans",
      payload: {
        planNo: "PLAN-NOAUTH-1", title: "No Auth Plan", area: "Finance",
        periodFrom: "2026-04-01", periodTo: "2027-03-31",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/audit/plans — 403 for wrong role (employee)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/plans",
      headers: { authorization: `Bearer ${token(["employee"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: {
        planNo: "PLAN-WRONGROLE-1", title: "Wrong Role Plan", area: "Finance",
        periodFrom: "2026-04-01", periodTo: "2027-03-31",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/audit/plans — 202 for audit_officer with a valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/plans",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: {
        planNo: `PLAN-VALID-${Date.now()}`, title: "Valid Plan", area: "Finance Department",
        periodFrom: "2026-04-01", periodTo: "2027-03-31",
      },
    });
    expect([201, 202]).toContain(res.statusCode);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(typeof body.id).toBe("string");
    expect(body.correlationId).toBeDefined();
  });

  it("POST /v1/audit/plans — 400 when a required field is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/audit/plans",
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}`, "content-type": "application/json" },
      payload: {
        // missing `title`
        planNo: "PLAN-INVALID-1", area: "Finance Department",
        periodFrom: "2026-04-01", periodTo: "2027-03-31",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("GET /v1/audit/plans/:id — 404 for a nonexistent id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/audit/plans/${randomUUID()}`,
      headers: { authorization: `Bearer ${token(["audit_officer"], TENANT, ACTOR)}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Plan consumer — CQRS integration (planCreate, planItemCreate, planStart)", () => {
  it("planCreate: publishing lands a draft row in auditPlans", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPlanConsumers(q);
    await q.start();

    await q.publish(COMMANDS.planCreate, {
      messageId: MSG_1, type: COMMANDS.planCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-plan-1", schemaVersion: "1.0",
      payload: {
        id: PLAN_1, tenantId: TENANT, planNo: "PLAN-2026-C001", title: "Annual Finance Audit",
        area: "Finance Department", periodFrom: "2026-04-01", periodTo: "2027-03-31", riskLevel: "high",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditPlans).where(eq(auditPlans.id, PLAN_1))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("draft");
    expect(rows[0]?.riskLevel).toBe("high");
    expect(rows[0]?.version).toBe(1);
  });

  it("planItemCreate: publishing lands a row in auditPlanItems linked to the plan", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPlanConsumers(q);
    await q.start();

    await q.publish(COMMANDS.planItemCreate, {
      messageId: MSG_2, type: COMMANDS.planItemCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-plan-2", schemaVersion: "1.0",
      payload: {
        id: ITEM_1, planId: PLAN_1, tenantId: TENANT, deptRef: "dept:finance",
        scheduledFrom: "2026-05-01", scheduledTo: "2026-05-15",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditPlanItems).where(eq(auditPlanItems.id, ITEM_1))));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.planId).toBe(PLAN_1);
    expect(rows[0]?.deptRef).toBe("dept:finance");
    expect(rows[0]?.status).toBe("scheduled");
  });

  it("planStart: flips a draft plan to in_progress and increments version; re-publishing on an already-started plan is rejected without corrupting state", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPlanConsumers(q);
    await q.start();

    // Sanity: plan seeded via planCreate above is still draft/version 1.
    let rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditPlans).where(eq(auditPlans.id, PLAN_1))));
    expect(rows[0]?.status).toBe("draft");
    expect(rows[0]?.version).toBe(1);

    await q.publish(COMMANDS.planStart, {
      messageId: MSG_3, type: COMMANDS.planStart,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-plan-3", schemaVersion: "1.0",
      payload: { planId: PLAN_1, tenantId: TENANT },
    });
    await new Promise<void>((r) => setTimeout(r, 1000));

    rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditPlans).where(eq(auditPlans.id, PLAN_1))));
    // "in_progress" (not "active") — matches the CHECK constraint
    // (migration 0016) and queries.ts's read-model vocabulary. The consumer
    // previously wrote "active", which the CHECK constraint rejected
    // outright, so every planStart command failed and dead-lettered.
    expect(rows[0]?.status).toBe("in_progress");
    expect(rows[0]?.version).toBe(2);

    // Re-publish planStart on the now-started plan. The consumer's
    // assertCanStart guard throws INVALID_STATUS, so the MemoryQueue retries
    // it up to maxAttempts and then dead-letters it — it must never succeed
    // and must never corrupt the row (status/version unchanged from above).
    await q.publish(COMMANDS.planStart, {
      messageId: MSG_4, type: COMMANDS.planStart,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-plan-4", schemaVersion: "1.0",
      payload: { planId: PLAN_1, tenantId: TENANT },
    });
    // Generous wait: MemoryQueue backs off exponentially (2^attempt * 10ms)
    // across up to 5 attempts before landing in the DLQ.
    await new Promise<void>((r) => setTimeout(r, 2000));
    await q.stop();

    rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditPlans).where(eq(auditPlans.id, PLAN_1))));
    expect(rows[0]?.status).toBe("in_progress");
    expect(rows[0]?.version).toBe(2);

    const dlq = (q as unknown as { dlq: Array<{ error: string }> }).dlq;
    expect(dlq.length).toBeGreaterThan(0);
    expect(dlq.some((d) => d.error.includes("INVALID_STATUS"))).toBe(true);
  }, 10000);

  it("idempotency: republishing the same planCreate messageId inserts exactly one row", async () => {
    // MemoryQueue itself dedupes `${topic}:${messageId}` within a single
    // instance's in-process `seen` set, which would make a same-instance
    // republish a no-op without ever re-invoking the handler — that would
    // test the queue's delivery dedup, not the consumer's DB-level
    // `markProcessed` idempotency guard. To exercise the real guard, publish
    // the identical messageId through TWO independent queue instances (each
    // with its own fresh `seen` set, simulating redelivery after a consumer
    // restart / at-least-once redelivery) so the handler actually runs
    // twice and the second run must be rejected by `processed` PK collision.
    const payload = {
      id: PLAN_2, tenantId: TENANT, planNo: "PLAN-2026-C002", title: "Idempotency Test Plan",
      area: "HR Department", periodFrom: "2026-06-01", periodTo: "2027-05-31", riskLevel: "low",
    };
    const envelope = {
      messageId: MSG_5, type: COMMANDS.planCreate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-plan-5a", schemaVersion: "1.0",
      payload,
    };

    const q1 = wireTenantAwareQueue(new MemoryQueue());
    registerPlanConsumers(q1);
    await q1.start();
    await q1.publish(COMMANDS.planCreate, envelope);
    await new Promise<void>((r) => setTimeout(r, 300));
    await q1.stop();

    const q2 = wireTenantAwareQueue(new MemoryQueue());
    registerPlanConsumers(q2);
    await q2.start();
    await q2.publish(COMMANDS.planCreate, { ...envelope, correlationId: "corr-plan-5b" });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q2.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(auditPlans).where(eq(auditPlans.id, PLAN_2))));
    expect(rows).toHaveLength(1);
  });
});
