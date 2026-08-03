/**
 * P1-13 (CSAT survey lifecycle + detractor service recovery) and
 * P1-15 (ticket escalation) — command pre-conditions and applied state.
 *
 * Regression cover for the black-hole defect: /csat and /tickets/:id/escalate
 * answered 202 for work the consumer then silently discarded (unknown ticket,
 * unresolved ticket, duplicate survey). The routes now pre-check and the
 * consumer opens a service-recovery escalation for detractor ratings.
 *
 * DB-backed against live civitas_helpdesk; MemoryQueue + sla consumers wired
 * through the infra mock so writes land before assertions.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { NOTIFICATION_SEND } from "@civitasone/events";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import type { Handler } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { ticketEscalations, csatResponses } from "../src/modules/sla/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { EVENTS } from "../src/topics.js";

vi.mock("../src/shared/infra.js", async () => {
  const { MemoryQueue } = await import("@civitasone/queue");
  const { withTenantConsumer } = await import("@civitasone/db");
  const { registerSlaConsumers } = await import("../src/modules/sla/consumer.js");
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  registerSlaConsumers(q);
  return {
    queue: q,
    cache: {
      invalidate: vi.fn(),
      makeKey: (...parts: string[]) => parts.join(":"),
      getOrLoad: vi.fn(),
      put: vi.fn(),
      invalidateResource: vi.fn(),
      listOrLoad: vi.fn(),
    },
  };
});

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000c501";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000c502";
const AGENT_A = "aaaaaaaa-0000-4000-8000-00000000c5a1";
const USER_A = "aaaaaaaa-0000-4000-8000-00000000c5b1";
const TENANTS = [TENANT_A, TENANT_B];

function token(tid: string, sub: string, roles: string[]) {
  return signToken({ sub, tid, roles, sid: "sess-csat" }, SECRET, 3600);
}
const agentA = () => token(TENANT_A, AGENT_A, ["helpdesk_agent"]);
const userA = () => token(TENANT_A, USER_A, ["helpdesk_user"]);

let app: FastifyInstance;

async function post(url: string, tok: string, payload: unknown) {
  return app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    payload: payload as object,
  });
}

/** MemoryQueue delivery is async — give the consumer a beat to apply the write. */
async function flush() {
  await new Promise((r) => setTimeout(r, 250));
}

async function seedTicket(tenantId: string, status: string, assigneeId: string | null = null): Promise<string> {
  const id = randomUUID();
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.insert(tickets).values({
        id,
        tenantId,
        subject: `survey seed ${id}`,
        priority: "Medium",
        status,
        assigneeId,
        createdBy: USER_A,
        updatedBy: USER_A,
      }),
    ),
  );
  return id;
}

async function escalationsFor(tenantId: string, ticketId: string) {
  return runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx
        .select()
        .from(ticketEscalations)
        .where(and(eq(ticketEscalations.ticketId, ticketId), eq(ticketEscalations.tenantId, tenantId))),
    ),
  );
}

async function outboxTopics(tenantId: string, ticketId: string): Promise<string[]> {
  const { outboxMessages } = outboxSchema;
  const rows = await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId))),
  );
  return rows.filter((r) => JSON.stringify(r.payload).includes(ticketId)).map((r) => r.topic);
}

async function cleanup() {
  const { outboxMessages } = outboxSchema;
  for (const t of TENANTS) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(csatResponses).where(eq(csatResponses.tenantId, t));
        await tx.delete(ticketEscalations).where(eq(ticketEscalations.tenantId, t));
        await tx.delete(tickets).where(eq(tickets.tenantId, t));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      }),
    );
  }
}

beforeAll(async () => {
  app = await buildApp();
});
beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("P1-15 — POST /v1/helpdesk/tickets/:id/escalate pre-conditions", () => {
  it("rejects an escalation for a ticket that does not exist (404, not a 202 black hole)", async () => {
    const res = await post(`/v1/helpdesk/tickets/${randomUUID()}/escalate`, agentA(), { reason: "Customer upset" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects an escalation for another tenant's ticket (404, no cross-tenant leak)", async () => {
    const ticketId = await seedTicket(TENANT_B, "open");
    const res = await post(`/v1/helpdesk/tickets/${ticketId}/escalate`, agentA(), { reason: "Customer upset" });
    expect(res.statusCode).toBe(404);
    expect(await escalationsFor(TENANT_B, ticketId)).toHaveLength(0);
  });

  it("accepts a real ticket and the consumer records the escalation, raises priority and emits the event", async () => {
    const ticketId = await seedTicket(TENANT_A, "open");
    const res = await post(`/v1/helpdesk/tickets/${ticketId}/escalate`, agentA(), { reason: "Breached, customer escalating" });
    expect(res.statusCode).toBe(202);
    await flush();

    const rows = await escalationsFor(TENANT_A, ticketId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe(1);
    expect(rows[0]!.reason).toBe("Breached, customer escalating");

    const [ticket] = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.select().from(tickets).where(eq(tickets.id, ticketId))),
    );
    expect(ticket!.priority).toBe("High");
    expect(await outboxTopics(TENANT_A, ticketId)).toContain(EVENTS.ticketEscalated);
  });

  it("increments the escalation level on a repeat escalation", async () => {
    const ticketId = await seedTicket(TENANT_A, "open");
    await post(`/v1/helpdesk/tickets/${ticketId}/escalate`, agentA(), { reason: "first" });
    await flush();
    await post(`/v1/helpdesk/tickets/${ticketId}/escalate`, agentA(), { reason: "second" });
    await flush();

    const levels = (await escalationsFor(TENANT_A, ticketId)).map((r) => r.level).sort();
    expect(levels).toEqual([1, 2]);
  });
});

describe("P1-13 — POST /v1/helpdesk/csat pre-conditions", () => {
  it("rejects a survey for a ticket that does not exist (404)", async () => {
    const res = await post("/v1/helpdesk/csat", userA(), { ticketId: randomUUID(), rating: 5 });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a survey while the ticket is still open (409 NOT_RESOLVED)", async () => {
    const ticketId = await seedTicket(TENANT_A, "open");
    const res = await post("/v1/helpdesk/csat", userA(), { ticketId, rating: 4 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NOT_RESOLVED");
  });

  it("accepts a survey on a resolved ticket and the consumer persists it", async () => {
    const ticketId = await seedTicket(TENANT_A, "resolved");
    const res = await post("/v1/helpdesk/csat", userA(), { ticketId, rating: 4, comment: "quick fix" });
    expect(res.statusCode).toBe(202);
    await flush();

    const rows = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.select().from(csatResponses).where(eq(csatResponses.ticketId, ticketId))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe(4);
    expect(await outboxTopics(TENANT_A, ticketId)).toContain(EVENTS.csatSubmitted);
  });

  it("rejects a second survey for the same ticket (409 ALREADY_SUBMITTED)", async () => {
    const ticketId = await seedTicket(TENANT_A, "closed");
    expect((await post("/v1/helpdesk/csat", userA(), { ticketId, rating: 5 })).statusCode).toBe(202);
    await flush();
    const again = await post("/v1/helpdesk/csat", userA(), { ticketId, rating: 1 });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("ALREADY_SUBMITTED");
  });
});

describe("P1-13 — detractor CSAT triggers service recovery", () => {
  it("opens a service-recovery escalation and notifies the ticket owner", async () => {
    const ticketId = await seedTicket(TENANT_A, "resolved", AGENT_A);
    expect((await post("/v1/helpdesk/csat", userA(), { ticketId, rating: 1, comment: "still broken" })).statusCode).toBe(202);
    await flush();

    const rows = await escalationsFor(TENANT_A, ticketId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("service recovery: CSAT rating 1");
    expect(rows[0]!.level).toBe(1);

    const topics = await outboxTopics(TENANT_A, ticketId);
    expect(topics).toContain(EVENTS.csatServiceRecovery);
    expect(topics).toContain(NOTIFICATION_SEND);
  });

  it("stacks the recovery escalation above an existing SLA escalation", async () => {
    const ticketId = await seedTicket(TENANT_A, "resolved", AGENT_A);
    await post(`/v1/helpdesk/tickets/${ticketId}/escalate`, agentA(), { reason: "sla breach" });
    await flush();
    await post("/v1/helpdesk/csat", userA(), { ticketId, rating: 2 });
    await flush();

    const rows = await escalationsFor(TENANT_A, ticketId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.level).sort()).toEqual([1, 2]);
    const recovery = rows.find((r) => r.reason.startsWith("service recovery"));
    expect(recovery?.level).toBe(2);
  });

  it("does not open a recovery escalation for a satisfied rating", async () => {
    const ticketId = await seedTicket(TENANT_A, "resolved", AGENT_A);
    expect((await post("/v1/helpdesk/csat", userA(), { ticketId, rating: 5 })).statusCode).toBe(202);
    await flush();

    expect(await escalationsFor(TENANT_A, ticketId)).toHaveLength(0);
    expect(await outboxTopics(TENANT_A, ticketId)).not.toContain(EVENTS.csatServiceRecovery);
  });
});
