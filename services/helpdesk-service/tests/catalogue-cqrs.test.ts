/**
 * Catalogue module CQRS — command publish + consumer persistence + idempotency.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { catalogueOfferings, serviceRequests } from "../src/modules/catalogue/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { registerCatalogueConsumers } from "../src/modules/catalogue/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const { outboxMessages } = outboxSchema;
const TENANT = "aaaaaaaa-0000-4000-8000-00000000ca99";
const ACTOR = "00000000-aaaa-4000-8000-00000000ca99";

const publish = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...args: unknown[]) => publish(...args) },
  cache: { invalidate: vi.fn(), makeKey: (...parts: string[]) => parts.join(":") },
}));

const ctx = {
  tenantId: TENANT,
  actorId: ACTOR,
  correlationId: "corr-catalogue-cqrs",
  roles: ["helpdesk_admin"],
};

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function wired() {
  const q = wireTenantAwareQueue(new MemoryQueue());
  registerCatalogueConsumers(q);
  return q;
}

async function seedOffering(): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      tx.insert(catalogueOfferings).values({
        id,
        tenantId: TENANT,
        name: `Offering ${id}`,
        category: "access",
        status: "active",
        approvalRequired: false,
        requestFormSchema: [{ key: "reason", label: "Reason", type: "text", required: true }],
        fulfilmentStages: [],
        defaultPriority: "Medium",
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    ),
  );
  return id;
}

async function cleanup() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(serviceRequests).where(eq(serviceRequests.tenantId, TENANT));
      await tx.delete(catalogueOfferings).where(eq(catalogueOfferings.tenantId, TENANT));
      await tx.delete(tickets).where(eq(tickets.tenantId, TENANT));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    }),
  );
}

beforeEach(async () => {
  publish.mockClear();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("catalogue routes CQRS wiring", () => {
  it("catalogue routes have zero db.transaction on mutating handlers", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/catalogue/routes.ts"), "utf8");
    expect(src).toMatch(/commands\./);
    expect(src).toMatch(/reply\.code\(202\)/);
    expect(src).not.toMatch(/repo\.insertOffering\(tx/);
    expect(src).not.toMatch(/service\.raiseRequest\(/);
  });

  it("worker registers catalogue consumers", () => {
    const src = readFileSync(resolve(__dirname, "../src/worker.ts"), "utf8");
    expect(src).toMatch(/registerCatalogueConsumers/);
  });
});

describe("catalogue commands publish", () => {
  it("raiseRequest publishes catalogueRequestRaise with pre-assigned ids", async () => {
    const { raiseRequest } = await import("../src/modules/catalogue/commands.js");
    const res = await raiseRequest(ctx as never, {
      offeringId: randomUUID(),
      offeringName: "VPN Access",
      formData: { reason: "need vpn" },
      priority: "Medium",
      initialStatus: "pending_fulfilment",
      initialStage: null,
      approvalRequired: false,
      slaPolicyId: null,
      responseDeadline: null,
      resolutionDeadline: null,
    });
    expect(res.status).toBe("accepted");
    expect(res.ticketId).toBeTruthy();
    expect(publish).toHaveBeenCalledWith(
      COMMANDS.catalogueRequestRaise,
      expect.objectContaining({
        messageId: res.id,
        payload: expect.objectContaining({ requestId: res.id, ticketId: res.ticketId }),
      }),
    );
  });
});

describe("catalogue consumer persistence", () => {
  it("raiseRequest atomically creates service_request + linked ticket + events", async () => {
    const q = wired();
    const offeringId = await seedOffering();
    const requestId = randomUUID();
    const ticketId = randomUUID();

    await q.publish(COMMANDS.catalogueRequestRaise, {
      messageId: requestId,
      type: COMMANDS.catalogueRequestRaise,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        requestId,
        ticketId,
        tenantId: TENANT,
        offeringId,
        offeringName: "VPN Access",
        formData: { reason: "need vpn" },
        priority: "Medium",
        initialStatus: "pending_fulfilment",
        initialStage: null,
        approvalRequired: false,
        slaPolicyId: null,
        responseDeadline: null,
        resolutionDeadline: null,
      },
    });
    await new Promise((r) => setTimeout(r, 200));

    const reqs = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(serviceRequests).where(eq(serviceRequests.id, requestId))),
    );
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.ticketId).toBe(ticketId);

    const tix = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(tickets).where(eq(tickets.id, ticketId))),
    );
    expect(tix).toHaveLength(1);
    expect(tix[0]!.source).toBe("catalogue");
    expect(tix[0]!.sourceRef).toBe(requestId);

    const outbox = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))),
    );
    expect(outbox.some((r) => r.eventType === EVENTS.requestRaised)).toBe(true);
    expect(outbox.some((r) => r.eventType === EVENTS.ticketCreated)).toBe(true);
  });

  it("raiseRequest is idempotent on messageId redelivery", async () => {
    const q = wired();
    const offeringId = await seedOffering();
    const requestId = randomUUID();
    const ticketId = randomUUID();
    const msg = {
      messageId: requestId,
      type: COMMANDS.catalogueRequestRaise,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        requestId,
        ticketId,
        tenantId: TENANT,
        offeringId,
        offeringName: "VPN Access",
        formData: { reason: "need vpn" },
        priority: "Medium",
        initialStatus: "pending_fulfilment",
        initialStage: null,
        approvalRequired: false,
        slaPolicyId: null,
        responseDeadline: null,
        resolutionDeadline: null,
      },
    };
    await q.publish(COMMANDS.catalogueRequestRaise, msg);
    await q.publish(COMMANDS.catalogueRequestRaise, msg);
    await new Promise((r) => setTimeout(r, 250));

    const reqs = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(serviceRequests).where(eq(serviceRequests.id, requestId))),
    );
    expect(reqs).toHaveLength(1);
    const tix = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(tickets).where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, TENANT)))),
    );
    expect(tix).toHaveLength(1);
  });
});
