/**
 * Contract tests for the shapes the helpdesk web reads (internal tickets):
 * flat 202 create ack, ticketNo / description / createdAt on the detail view,
 * "In Progress" for the incident "investigating" stage, and transitions for
 * tickets that carry no explicit ITIL ticketType (the internal intake form
 * creates those). Everything runs the real HTTP route -> queue -> consumer -> DB
 * round trip; nothing in the response is hand-mocked.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import type { Handler } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";

vi.mock("../src/shared/infra.js", async () => {
  const { MemoryQueue } = await import("@civitasone/queue");
  const { withTenantConsumer } = await import("@civitasone/db");
  // NB: consumers are registered in beforeAll — the ticket consumer imports the
  // (mocked) infra module, so importing it from inside this factory would deadlock.
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return {
    queue: q,
    cache: {
      invalidate: vi.fn(),
      makeKey: (...parts: string[]) => parts.join(":"),
      getOrLoad: async (_key: string, loader: () => Promise<unknown>) => loader(),
      put: vi.fn(),
      invalidateResource: vi.fn(),
      listOrLoad: async (_t: string, _r: string, _k: string, loader: () => Promise<unknown>) => loader(),
    },
  };
});

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-0000-4000-8000-00000000ab01";
const ACTOR = "cccccccc-0000-4000-8000-00000000ab0a";
const { outboxMessages } = outboxSchema;

const bearer = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["helpdesk_user"], sid: "sess-shape" }, SECRET, 3600)}`,
  "content-type": "application/json",
});

async function cleanup() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(tickets).where(eq(tickets.tenantId, TENANT));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    }),
  );
}
const flush = () => new Promise((r) => setTimeout(r, 300));

let app: FastifyInstance;
beforeAll(async () => {
  const { queue } = await import("../src/shared/infra.js");
  const { registerTicketConsumers } = await import("../src/modules/tickets/consumer.js");
  registerTicketConsumers(queue);
  app = await buildApp();
  await cleanup();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

async function createTicket(payload: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/v1/helpdesk/tickets", headers: bearer(), payload });
  await flush();
  return res;
}
const transition = (id: string, status: string) =>
  app.inject({ method: "POST", url: `/v1/helpdesk/tickets/${id}/transition`, headers: bearer(), payload: { status } });
const detail = async (id: string) =>
  (await app.inject({ method: "GET", url: `/v1/helpdesk/tickets/${id}`, headers: bearer() })).json();

describe("internal ticket create ack + detail contract", () => {
  it("create returns the flat { id, status, correlationId } 202 ack", async () => {
    const res = await createTicket({ subject: "Printer jam", description: "Floor 3 printer", priority: "High" });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeTruthy();
  });

  it("detail exposes ticketNo, description and createdAt once the worker has created it", async () => {
    const { id } = (await createTicket({ subject: "VPN down", description: "Cannot connect since 9am", priority: "Medium" })).json();
    const d = await detail(id);
    expect(d.id).toBe(id);
    expect(d.ticketNo).toMatch(/\S+/);
    expect(d.description).toBe("Cannot connect since 9am");
    expect(typeof d.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(d.createdAt))).toBe(false);
    expect(d.status).toBe("Open");
  });

  it("list rows carry ticketNo too (and never the description)", async () => {
    await createTicket({ subject: "Listed", description: "secret body" });
    const list = (await app.inject({ method: "GET", url: "/v1/helpdesk/tickets", headers: bearer() })).json();
    const row = list.data.find((t: { subject: string }) => t.subject === "Listed");
    expect(row.ticketNo).toMatch(/\S+/);
    expect(row.description).toBeUndefined();
  });
});

describe("transitions for tickets created WITHOUT a ticketType (internal form)", () => {
  it("open -> investigating -> resolved -> closed all succeed; open -> resolved is a 422", async () => {
    const { id } = (await createTicket({ subject: "Walk the state machine", description: "d" })).json();

    // resolving straight from open is illegal (must investigate first)
    const skip = await transition(id, "resolved");
    expect(skip.statusCode).toBe(422);
    expect(skip.json().code).toBe("INVALID_TRANSITION");

    expect((await transition(id, "investigating")).statusCode).toBe(202);
    await flush();
    // "investigating" is surfaced as In Progress (distinct from Open)
    expect((await detail(id)).status).toBe("In Progress");

    expect((await transition(id, "resolved")).statusCode).toBe(202);
    await flush();
    expect((await detail(id)).status).toBe("Resolved");

    expect((await transition(id, "closed")).statusCode).toBe(202);
    await flush();
    expect((await detail(id)).status).toBe("Closed");
  });

  it.each(["assigned", "in_progress"])("a typeless '%s' ticket resolves like an investigating incident", async (status) => {
    const id = randomUUID();
    await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx.insert(tickets).values({
          id, tenantId: TENANT, subject: `legacy ${status}`, description: null, priority: "Medium", status,
          createdBy: ACTOR, updatedBy: ACTOR, version: 1,
        } as typeof tickets.$inferInsert),
      ),
    );
    expect((await detail(id)).status).toBe("In Progress");
    expect((await transition(id, "resolved")).statusCode).toBe(202);
    await flush();
    expect((await detail(id)).status).toBe("Resolved");
  });

  it("a typeless ticket can not skip a stage (assigned -> closed is a 422)", async () => {
    const id = randomUUID();
    await runWithTenant(TENANT, () =>
      db.transaction((tx) =>
        tx.insert(tickets).values({
          id, tenantId: TENANT, subject: "skip", description: null, priority: "Medium", status: "assigned",
          createdBy: ACTOR, updatedBy: ACTOR, version: 1,
        } as typeof tickets.$inferInsert),
      ),
    );
    const res = await transition(id, "closed");
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });
});
