/**
 * CS-001: Case creation from multiple channels.
 *
 * Validates:
 * - Gapless ticket_no allocation (CASE/<FY>/NNNNNN)
 * - Per-tenant isolation of ticket_no counters
 * - All 7 valid channels accepted; invalid → 400
 * - Category linked to ticket
 * - SLA auto-assigned based on matching priority + category policy
 * - Priority + category present on created ticket
 * - 400 for invalid category_id (non-uuid)
 * - System-field protection trigger (ticket_no + created_at)
 */
process.env.JWT_SECRET ??= "test_secret_for_civitasone_32chr";

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { slaPolicies } from "../src/modules/sla/schema.js";
import { categories } from "../src/modules/config/categories-schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { registerTicketConsumers } from "../src/modules/tickets/consumer.js";
import { VALID_CHANNELS } from "../src/modules/tickets/validators.js";
import { allocateTicketNo } from "../src/shared/numbering.js";
import { COMMANDS } from "../src/topics.js";

const { outboxMessages } = outboxSchema;

const SECRET = process.env.JWT_SECRET!;
const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000c01";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000c02";
const ACTOR = "cccccccc-0000-4000-8000-000000000c03";
const CATEGORY_ID = "dddddddd-0000-4000-8000-000000000c04";
const SLA_POLICY_ID = "eeeeeeee-0000-4000-8000-000000000c05";
const ALL_TENANTS = [TENANT_A, TENANT_B];

function token(tenantId = TENANT_A, roles = ["helpdesk_user"]) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-cs001" }, SECRET);
}

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

function wired() {
  const q = wireTenantAwareQueue(new MemoryQueue());
  registerTicketConsumers(q);
  return q;
}

async function cleanup() {
  for (const tenantId of ALL_TENANTS) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await tx.delete(tickets).where(eq(tickets.tenantId, tenantId));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
      }),
    );
  }
  // Clean counter table via raw SQL (needs tenant context too)
  for (const tenantId of ALL_TENANTS) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await (tx as typeof db).execute(
          sql`DELETE FROM helpdesk.number_counters WHERE tenant_id = ${tenantId}::uuid`,
        );
      }),
    );
  }
}

async function seedCategory(tenantId: string) {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.insert(categories).values({
        id: CATEGORY_ID,
        tenantId,
        name: "Network Issues",
        ordinal: 1,
        enabled: true,
      }).onConflictDoNothing();
    }),
  );
}

async function seedSlaPolicy(tenantId: string) {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.insert(slaPolicies).values({
        id: SLA_POLICY_ID,
        tenantId,
        priority: "High",
        category: CATEGORY_ID,
        responseMinutes: 30,
        resolutionMinutes: 240,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }).onConflictDoNothing();
    }),
  );
}

async function findTicketRow(id: string, tenantId: string) {
  const rows = await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.select().from(tickets).where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId))),
    ),
  );
  return rows[0] ?? null;
}

/** Publish a create command and drain synchronously via MemoryQueue. */
async function createTicketViaConsumer(
  q: Queue,
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  await q.publish(COMMANDS.createTicket, {
    messageId: id,
    type: COMMANDS.createTicket,
    tenantId,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId,
      subject: `CS-001 test ticket ${id.slice(0, 8)}`,
      description: null,
      priority: "Medium",
      status: "open",
      channel: "portal",
      categoryId: null,
      ...overrides,
    },
  });
  // MemoryQueue delivers asynchronously — wait for processing
  await new Promise((r) => setTimeout(r, 200));
  return id;
}

beforeAll(async () => {
  await cleanup();
  await seedCategory(TENANT_A);
  await seedSlaPolicy(TENANT_A);
});

afterAll(async () => {
  await cleanup();
  // Clean up seeded reference data
  await runWithTenant(TENANT_A, () =>
    db.transaction(async (tx) => {
      await tx.delete(slaPolicies).where(eq(slaPolicies.id, SLA_POLICY_ID));
      await tx.delete(categories).where(eq(categories.id, CATEGORY_ID));
    }),
  );
  await sqlClient.end();
});

describe("CS-001: Gapless ticket_no allocation", () => {
  beforeEach(async () => { await cleanup(); });

  it("allocates sequential CASE/<FY>/NNNNNN numbers", async () => {
    const refs: string[] = [];
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        const executor = tx as unknown as import("@civitasone/numbering").SqlExecutor;
        refs.push(await allocateTicketNo(executor, TENANT_A));
        refs.push(await allocateTicketNo(executor, TENANT_A));
        refs.push(await allocateTicketNo(executor, TENANT_A));
      }),
    );

    const pattern = /^CASE\/\d{4}-\d{2}\/\d{6}$/;
    for (const ref of refs) {
      expect(ref).toMatch(pattern);
    }

    // Sequential: 000001, 000002, 000003
    const seqs = refs.map((r) => parseInt(r.split("/")[2]!, 10));
    expect(seqs).toEqual([1, 2, 3]);
  });

  it("3 sequential creates via consumer → gapless ticket_no", async () => {
    const q = wired();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await createTicketViaConsumer(q, TENANT_A));
    }

    // Wait longer for consumer processing + DB commits
    await new Promise((r) => setTimeout(r, 300));

    const rows = await Promise.all(ids.map((id) => findTicketRow(id, TENANT_A)));
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i], `ticket ${ids[i]} not found`).not.toBeNull();
    }
    const ticketNos = rows.map((r) => r!.ticketNo);

    const pattern = /^CASE\/\d{4}-\d{2}\/\d{6}$/;
    for (const tno of ticketNos) {
      expect(tno).toMatch(pattern);
    }

    // Extract sequence numbers and verify gapless (consecutive)
    const seqs = ticketNos.map((t) => parseInt(t!.split("/")[2]!, 10));
    expect(seqs[1]! - seqs[0]!).toBe(1);
    expect(seqs[2]! - seqs[1]!).toBe(1);
  });
});

describe("CS-001: Per-tenant isolation on ticket_no", () => {
  beforeEach(async () => { await cleanup(); });

  it("two tenants get independent counters starting at 000001", async () => {
    const q = wired();
    const idA = await createTicketViaConsumer(q, TENANT_A);
    const idB = await createTicketViaConsumer(q, TENANT_B);

    const rowA = await findTicketRow(idA, TENANT_A);
    const rowB = await findTicketRow(idB, TENANT_B);

    expect(rowA!.ticketNo).toMatch(/\/000001$/);
    expect(rowB!.ticketNo).toMatch(/\/000001$/);
  });
});

describe("CS-001: Channel validation", () => {
  it("accepts all 7 valid channels via HTTP", async () => {
    const app = await buildApp();
    for (const channel of VALID_CHANNELS) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/helpdesk/tickets",
        headers: { authorization: `Bearer ${token()}` },
        payload: { subject: `Channel test: ${channel}`, channel },
      });
      expect(res.statusCode, `Expected 202 for channel=${channel}`).toBe(202);
    }
    await app.close();
  });

  it("rejects invalid channel with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets",
      headers: { authorization: `Bearer ${token()}` },
      payload: { subject: "Bad channel", channel: "pigeon" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("CS-001: Category linked to ticket", () => {
  beforeEach(async () => { await cleanup(); });

  it("persists categoryId on the created ticket", async () => {
    const q = wired();
    const id = await createTicketViaConsumer(q, TENANT_A, { categoryId: CATEGORY_ID });
    const row = await findTicketRow(id, TENANT_A);
    expect(row, `ticket ${id} not found`).not.toBeNull();
    expect(row!.categoryId).toBe(CATEGORY_ID);
  });

  it("returns 400 for invalid category_id (non-uuid)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets",
      headers: { authorization: `Bearer ${token()}` },
      payload: { subject: "Invalid category", channel: "portal", categoryId: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("CS-001: SLA auto-assignment", () => {
  beforeEach(async () => { await cleanup(); });

  it("auto-assigns sla_policy_id when priority+category matches a policy", async () => {
    const q = wired();
    const id = await createTicketViaConsumer(q, TENANT_A, {
      priority: "High",
      categoryId: CATEGORY_ID,
    });
    const row = await findTicketRow(id, TENANT_A);
    expect(row!.slaPolicyId).toBe(SLA_POLICY_ID);
  });

  it("leaves sla_policy_id null when no policy matches", async () => {
    const q = wired();
    const id = await createTicketViaConsumer(q, TENANT_A, {
      priority: "Low",
      categoryId: null,
    });
    const row = await findTicketRow(id, TENANT_A);
    expect(row!.slaPolicyId).toBeNull();
  });
});

describe("CS-001: Priority + category present on created ticket", () => {
  beforeEach(async () => { await cleanup(); });

  it("stores priority and category_id on the ticket row", async () => {
    const q = wired();
    const id = await createTicketViaConsumer(q, TENANT_A, {
      priority: "Critical",
      categoryId: CATEGORY_ID,
      channel: "chatbot",
    });
    const row = await findTicketRow(id, TENANT_A);
    expect(row!.priority).toBe("Critical");
    expect(row!.categoryId).toBe(CATEGORY_ID);
    expect(row!.channel).toBe("chatbot");
  });
});

describe("CS-001: System field protection trigger", () => {
  let ticketId: string;

  beforeEach(async () => {
    await cleanup();
    // Seed a ticket with ticket_no via consumer
    const q = wired();
    ticketId = await createTicketViaConsumer(q, TENANT_A);
    // Verify it was actually created
    const row = await findTicketRow(ticketId, TENANT_A);
    expect(row, "ticket not created by consumer").not.toBeNull();
    expect(row!.ticketNo, "ticket_no not allocated").not.toBeNull();
  });

  it("prevents modification of ticket_no once set", async () => {
    await expect(
      runWithTenant(TENANT_A, () =>
        db.transaction(async (tx) => {
          const res = await (tx as typeof db).update(tickets)
            .set({ ticketNo: "CASE/9999-99/999999" })
            .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, TENANT_A)));
        }),
      ),
    ).rejects.toThrow(/cannot modify system field: ticket_no/);
  });

  it("prevents modification of created_at once set", async () => {
    await expect(
      runWithTenant(TENANT_A, () =>
        db.transaction(async (tx) => {
          await (tx as typeof db).update(tickets)
            .set({ createdAt: new Date("2020-01-01T00:00:00Z") })
            .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, TENANT_A)));
        }),
      ),
    ).rejects.toThrow(/cannot modify system field: created_at/);
  });

  it("allows updating other fields when ticket_no is set", async () => {
    await expect(
      runWithTenant(TENANT_A, () =>
        db.transaction(async (tx) => {
          await (tx as typeof db).update(tickets)
            .set({ status: "assigned", updatedBy: ACTOR })
            .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, TENANT_A)));
        }),
      ),
    ).resolves.not.toThrow();
  });
});
