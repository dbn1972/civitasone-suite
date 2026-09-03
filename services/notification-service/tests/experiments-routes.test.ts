/**
 * CR-MKT-05 — A/B experiment routes + consumer write path.
 *
 * Covers the authz/validation boundary on all seven endpoints, the 404 and 422
 * business-rule paths, the 409 double-conclude guard, and the consumer's
 * idempotency + DLQ behaviour.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { experiments, experimentVariants, experimentEvents } from "../src/modules/experiments/schema.js";
import { registerExperimentConsumers } from "../src/modules/experiments/consumer.js";
import { incrementSentCount } from "../src/modules/experiments/repo.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "eeee0001-1111-4000-8000-000000000001";
const ACTOR = "eeeeaaaa-1111-4000-8000-0000000000aa";
const EXP = "eeee1111-1111-4000-8000-000000000011";
const VAR_A = "eeee2222-1111-4000-8000-00000000002a";
const VAR_B = "eeee2222-1111-4000-8000-00000000002b";
const UNKNOWN = "eeee9999-9999-4000-8000-000000000099";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-exp" }, SECRET, 3600);
}
const bearer = (roles: string[], tid = TENANT) => ({ authorization: `Bearer ${token(roles, tid)}` });

/** Message ids this file has delivered, so cleanup can scope its reset. */
const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(experimentEvents).where(eq(experimentEvents.tenantId, TENANT));
    await tx.delete(experimentVariants).where(eq(experimentVariants.tenantId, TENANT));
    await tx.delete(experiments).where(eq(experiments.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  // _inbox.processed is a SHARED, non-tenant-scoped table. An unqualified
  // DELETE here would wipe the idempotency markers of every OTHER test file
  // running in parallel, which silently breaks their "second delivery is a
  // no-op" assertions. Only this file's own message ids are removed.
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

async function seedExperiment(status = "running", sentPerVariant = 0): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(experiments).values({
      id: EXP, tenantId: TENANT, name: "Subject line test", status,
      createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    }).onConflictDoNothing();
    await tx.insert(experimentVariants).values([
      {
        id: VAR_A, tenantId: TENANT, experimentId: EXP, variantKey: "a",
        allocationPct: 50, sentCount: sentPerVariant, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      },
      {
        id: VAR_B, tenantId: TENANT, experimentId: EXP, variantKey: "b",
        allocationPct: 50, sentCount: sentPerVariant, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      },
    ]).onConflictDoNothing();
  }));
}

async function deliver(topic: string, messageId: string, payload: unknown): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerExperimentConsumers(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${messageId}`, schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
  return q;
}

const validCreate = {
  name: "Subject line test",
  variants: [{ key: "a", allocationPct: 50 }, { key: "b", allocationPct: 50 }],
};

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("POST /v1/notification/experiments", () => {
  it("202 for a marketing admin with a valid 50/50 split", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/experiments",
      headers: bearer(["marketing_admin"]), payload: validCreate,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/notification/experiments", payload: validCreate });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/experiments",
      headers: bearer(["audit_officer"]), payload: validCreate,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403 for an unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/experiments",
      headers: bearer(["citizen"]), payload: validCreate,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 for a missing name", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/experiments",
      headers: bearer(["tenant_admin"]), payload: { variants: validCreate.variants },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for fewer than 2 variants", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/experiments",
      headers: bearer(["tenant_admin"]),
      payload: { name: "x", variants: [{ key: "a", allocationPct: 100 }] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for more than 10 variants", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/experiments",
      headers: bearer(["tenant_admin"]),
      payload: {
        name: "x",
        variants: Array.from({ length: 11 }, (_, i) => ({ key: `v${i}`, allocationPct: 9 })),
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a fractional allocation", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/experiments",
      headers: bearer(["tenant_admin"]),
      payload: { name: "x", variants: [{ key: "a", allocationPct: 50.5 }, { key: "b", allocationPct: 49.5 }] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("422 when allocations do not sum to 100 — recipients would be unassigned", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/experiments",
      headers: bearer(["tenant_admin"]),
      payload: { name: "x", variants: [{ key: "a", allocationPct: 40 }, { key: "b", allocationPct: 40 }] },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("ALLOCATION_NOT_100");
  });

  it("422 for duplicate variant keys", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/experiments",
      headers: bearer(["tenant_admin"]),
      payload: { name: "x", variants: [{ key: "a", allocationPct: 50 }, { key: "A", allocationPct: 50 }] },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("DUPLICATE_KEY");
  });
});

describe("GET /v1/notification/experiments", () => {
  beforeAll(() => seedExperiment());

  it("200 with the list envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/experiments?limit=20", headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toMatchObject({ page: 1, pageSize: 20 });
    expect(body.data.some((r: { id: string }) => r.id === EXP)).toBe(true);
  });

  it("200 for audit_officer", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/experiments?limit=20", headers: bearer(["audit_officer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("400 when limit is omitted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/experiments", headers: bearer(["tenant_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/notification/experiments?limit=20" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/experiments?limit=20", headers: bearer(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/notification/experiments/:id/events", () => {
  beforeAll(() => seedExperiment());

  it("202 for an open event", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/events`,
      headers: bearer(["marketing_admin"]), payload: { variantId: VAR_A, eventType: "open" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("202 for a click event with a link position", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/events`,
      headers: bearer(["marketing_admin"]),
      payload: { variantId: VAR_A, eventType: "click", linkPosition: 2, linkUrl: "https://dept.gov.in/apply" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("404 for an unknown experiment", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${UNKNOWN}/events`,
      headers: bearer(["marketing_admin"]), payload: { variantId: VAR_A, eventType: "open" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("422 for a click with no link position — it would never appear in the heatmap", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/events`,
      headers: bearer(["marketing_admin"]), payload: { variantId: VAR_A, eventType: "click" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MISSING_LINK_POSITION");
  });

  it("400 for an unknown event type", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/events`,
      headers: bearer(["marketing_admin"]), payload: { variantId: VAR_A, eventType: "hover" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid variantId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/events`,
      headers: bearer(["marketing_admin"]), payload: { variantId: "nope", eventType: "open" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-uuid experiment id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/experiments/not-a-uuid/events",
      headers: bearer(["marketing_admin"]), payload: { variantId: VAR_A, eventType: "open" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a link position above the maximum", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/events`,
      headers: bearer(["marketing_admin"]),
      payload: { variantId: VAR_A, eventType: "click", linkPosition: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-URL linkUrl", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/events`,
      headers: bearer(["marketing_admin"]),
      payload: { variantId: VAR_A, eventType: "click", linkPosition: 1, linkUrl: "not a url" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/events`,
      payload: { variantId: VAR_A, eventType: "open" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/events`,
      headers: bearer(["audit_officer"]), payload: { variantId: VAR_A, eventType: "open" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/experiments/:id/results", () => {
  beforeAll(() => seedExperiment());

  it("200 with per-variant results and a winner verdict", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${EXP}/results`, headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.experimentId).toBe(EXP);
    expect(data.results).toHaveLength(2);
    // Zero sends → the rule must refuse to name a winner.
    expect(data.winner.decided).toBe(false);
    expect(data.winner.reason).toBe("insufficient_sample");
  });

  it("404 for an unknown experiment", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${UNKNOWN}/results`, headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/experiments/xyz/results", headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/notification/experiments/${EXP}/results` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${EXP}/results`, headers: bearer(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/experiments/:id/heatmap", () => {
  beforeAll(() => seedExperiment());

  it("200 with heatmap cells", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${EXP}/heatmap`, headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data.cells)).toBe(true);
  });

  it("200 filtered to one variant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${EXP}/heatmap?variantId=${VAR_A}`,
      headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.variantId).toBe(VAR_A);
  });

  it("400 for a non-uuid variantId filter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${EXP}/heatmap?variantId=nope`,
      headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown experiment", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${UNKNOWN}/heatmap`, headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/notification/experiments/${EXP}/heatmap` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${EXP}/heatmap`, headers: bearer(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/experiments/:id/allocation", () => {
  beforeAll(() => seedExperiment());

  it("200 with a deterministic variant for a subject", async () => {
    const app = await buildApp();
    const first = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${EXP}/allocation?subject=citizen-77`,
      headers: bearer(["marketing_admin"]),
    });
    const second = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${EXP}/allocation?subject=citizen-77`,
      headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(first.statusCode).toBe(200);
    expect([VAR_A, VAR_B]).toContain(first.json().data.variantId);
    // Same subject must never flip variants between calls.
    expect(second.json().data.variantId).toBe(first.json().data.variantId);
  });

  it("400 when subject is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${EXP}/allocation`, headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown experiment", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${UNKNOWN}/allocation?subject=x`,
      headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${EXP}/allocation?subject=x`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/experiments/${EXP}/allocation?subject=x`,
      headers: bearer(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/notification/experiments/:id/conclude", () => {
  beforeEach(cleanup);

  it("202 for a running experiment", async () => {
    await seedExperiment("running");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/conclude`, headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("409 for an already-concluded experiment", async () => {
    await seedExperiment("concluded");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/conclude`, headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ALREADY_CONCLUDED");
  });

  it("404 for an unknown experiment", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${UNKNOWN}/conclude`, headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/experiments/nope/conclude", headers: bearer(["marketing_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    await seedExperiment();
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/notification/experiments/${EXP}/conclude` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    await seedExperiment();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/experiments/${EXP}/conclude`, headers: bearer(["audit_officer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("experiment consumer", () => {
  beforeEach(cleanup);

  async function rows() {
    return runWithTenant(TENANT, () => db.transaction(async (tx) => ({
      exps: await tx.select().from(experiments).where(eq(experiments.tenantId, TENANT)),
      variants: await tx.select().from(experimentVariants).where(eq(experimentVariants.tenantId, TENANT)),
      events: await tx.select().from(experimentEvents).where(eq(experimentEvents.tenantId, TENANT)),
      outbox: await tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)),
    })));
  }

  const createPayload = {
    id: EXP, tenantId: TENANT, name: "Subject line test",
    variants: [
      { id: VAR_A, key: "a", allocationPct: 50 },
      { id: VAR_B, key: "b", allocationPct: 50 },
    ],
  };

  it("creates the experiment and its variants and emits the created event", async () => {
    await deliver(COMMANDS.createExperiment, "eeee3333-1111-4000-8000-000000000301", createPayload);
    const { exps, variants, outbox } = await rows();
    expect(exps).toHaveLength(1);
    expect(exps[0]?.status).toBe("running");
    expect(variants).toHaveLength(2);
    expect(variants.map((v) => v.sentCount)).toEqual([0, 0]);
    expect(outbox.map((m) => m.eventType)).toContain(EVENTS.experimentCreated);
    expect(outbox.map((m) => m.eventType)).toContain("audit.event.record");
  });

  it("processing the same messageId twice creates one experiment (idempotency)", async () => {
    const MSG = "eeee3333-1111-4000-8000-000000000302";
    await deliver(COMMANDS.createExperiment, MSG, createPayload);
    const first = await rows();
    await deliver(COMMANDS.createExperiment, MSG, createPayload);
    const second = await rows();
    expect(first.exps).toHaveLength(1);
    expect(second.exps).toHaveLength(1);
    expect(second.variants).toHaveLength(2);
    expect(second.outbox).toHaveLength(first.outbox.length);
  });

  it("dead-letters an invalid variant set instead of writing a broken experiment", async () => {
    const q = await deliver(COMMANDS.createExperiment, "eeee3333-1111-4000-8000-000000000303", {
      ...createPayload,
      variants: [{ id: VAR_A, key: "a", allocationPct: 30 }, { id: VAR_B, key: "b", allocationPct: 30 }],
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("ALLOCATION_NOT_100");
    expect((await rows()).exps).toHaveLength(0);
  });

  it("records an engagement event against an existing variant", async () => {
    await seedExperiment();
    const EVT = "eeee4444-1111-4000-8000-00000000004a";
    await deliver(COMMANDS.recordExperimentEvent, "eeee3333-1111-4000-8000-000000000304", {
      id: EVT, tenantId: TENANT, experimentId: EXP, variantId: VAR_A,
      eventType: "click", linkPosition: 3, linkUrl: "https://dept.gov.in/x",
    });
    const { events, outbox } = await rows();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("click");
    expect(events[0]?.linkPosition).toBe(3);
    expect(outbox.map((m) => m.eventType)).toContain(EVENTS.experimentEventRecorded);
  });

  it("recording the same event message twice writes one row (idempotency)", async () => {
    await seedExperiment();
    const MSG = "eeee3333-1111-4000-8000-000000000305";
    const payload = {
      id: "eeee4444-1111-4000-8000-00000000004b", tenantId: TENANT,
      experimentId: EXP, variantId: VAR_B, eventType: "open",
    };
    await deliver(COMMANDS.recordExperimentEvent, MSG, payload);
    await deliver(COMMANDS.recordExperimentEvent, MSG, payload);
    expect((await rows()).events).toHaveLength(1);
  });

  it("dead-letters an event for an unknown variant", async () => {
    await seedExperiment();
    const q = await deliver(COMMANDS.recordExperimentEvent, "eeee3333-1111-4000-8000-000000000306", {
      id: "eeee4444-1111-4000-8000-00000000004c", tenantId: TENANT,
      experimentId: EXP, variantId: UNKNOWN, eventType: "open",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("VARIANT_NOT_FOUND");
    expect((await rows()).events).toHaveLength(0);
  });

  it("dead-letters an unknown event type", async () => {
    await seedExperiment();
    const q = await deliver(COMMANDS.recordExperimentEvent, "eeee3333-1111-4000-8000-000000000307", {
      id: "eeee4444-1111-4000-8000-00000000004d", tenantId: TENANT,
      experimentId: EXP, variantId: VAR_A, eventType: "hover",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_EVENT_TYPE");
  });

  it("dead-letters an unparseable occurredAt", async () => {
    await seedExperiment();
    const q = await deliver(COMMANDS.recordExperimentEvent, "eeee3333-1111-4000-8000-000000000308", {
      id: "eeee4444-1111-4000-8000-00000000004e", tenantId: TENANT,
      experimentId: EXP, variantId: VAR_A, eventType: "open", occurredAt: "soon",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("ISO-8601");
  });

  it("concludes with no winner when the sample is too small", async () => {
    await seedExperiment("running", 10);
    // P2-9 winner-approval gate: conclude only accepts experiments already at
    // pending_approval, so the flow must pass through requestWinnerApproval first.
    await deliver(COMMANDS.requestWinnerApproval, "eeee3333-1111-4000-8000-0000000030a1", {
      id: EXP, tenantId: TENANT,
    });
    await deliver(COMMANDS.concludeExperiment, "eeee3333-1111-4000-8000-000000000309", {
      id: EXP, tenantId: TENANT,
    });
    const { exps, outbox } = await rows();
    expect(exps[0]?.status).toBe("concluded");
    expect(exps[0]?.winnerVariantId).toBeNull();
    expect(exps[0]?.winnerMarginPct).toBeNull();
    expect(exps[0]?.concludedAt).not.toBeNull();
    // requestWinnerApproval (setStatus) and concludeExperiment (setWinner) each
    // independently bump version by 1 off the version they read: 1 -> 2 -> 3.
    expect(exps[0]?.version).toBe(3);
    const concluded = outbox.find((m) => m.eventType === EVENTS.experimentConcluded);
    expect((concluded?.payload as { decided?: boolean }).decided).toBe(false);
  });

  it("freezes the winner when one variant leads clearly", async () => {
    await seedExperiment("running", 100);
    // 20 clicks on A, 2 on B → 18pp margin at n=100, well past the 2pp minimum.
    for (let i = 0; i < 20; i++) {
      await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(experimentEvents).values({
        tenantId: TENANT, experimentId: EXP, variantId: VAR_A, eventType: "click",
        linkPosition: 1, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      })));
    }
    for (let i = 0; i < 2; i++) {
      await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(experimentEvents).values({
        tenantId: TENANT, experimentId: EXP, variantId: VAR_B, eventType: "click",
        linkPosition: 1, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      })));
    }
    // P2-9 winner-approval gate: conclude only accepts experiments already at
    // pending_approval, so the flow must pass through requestWinnerApproval first.
    await deliver(COMMANDS.requestWinnerApproval, "eeee3333-1111-4000-8000-0000000030a2", {
      id: EXP, tenantId: TENANT,
    });
    await deliver(COMMANDS.concludeExperiment, "eeee3333-1111-4000-8000-000000000310", {
      id: EXP, tenantId: TENANT,
    });
    const { exps } = await rows();
    expect(exps[0]?.winnerVariantId).toBe(VAR_A);
    expect(exps[0]?.winnerMarginPct).toBe(18);
  });

  it("dead-letters a conclude for an unknown experiment", async () => {
    const q = await deliver(COMMANDS.concludeExperiment, "eeee3333-1111-4000-8000-000000000311", {
      id: UNKNOWN, tenantId: TENANT,
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("EXPERIMENT_NOT_FOUND");
  });

  it("concluding twice with the same messageId does not bump the version twice", async () => {
    await seedExperiment("running", 10);
    // P2-9 winner-approval gate: conclude only accepts experiments already at
    // pending_approval, so the flow must pass through requestWinnerApproval first.
    await deliver(COMMANDS.requestWinnerApproval, "eeee3333-1111-4000-8000-0000000030a3", {
      id: EXP, tenantId: TENANT,
    });
    const MSG = "eeee3333-1111-4000-8000-000000000312";
    await deliver(COMMANDS.concludeExperiment, MSG, { id: EXP, tenantId: TENANT });
    const first = await rows();
    await deliver(COMMANDS.concludeExperiment, MSG, { id: EXP, tenantId: TENANT });
    const second = await rows();
    expect(second.exps[0]?.version).toBe(first.exps[0]?.version);
  });
});

describe("incrementSentCount — keeps rate denominators accurate", () => {
  beforeEach(cleanup);

  it("increments the variant's send counter", async () => {
    await seedExperiment("running", 5);
    await runWithTenant(TENANT, () => db.transaction((tx) => incrementSentCount(tx, TENANT, VAR_A)));
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(experimentVariants).where(eq(experimentVariants.id, VAR_A))));
    expect(rows[0]?.sentCount).toBe(6);
  });

  it("does not touch the other variant", async () => {
    await seedExperiment("running", 5);
    await runWithTenant(TENANT, () => db.transaction((tx) => incrementSentCount(tx, TENANT, VAR_A)));
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(experimentVariants).where(eq(experimentVariants.id, VAR_B))));
    expect(rows[0]?.sentCount).toBe(5);
  });
});
