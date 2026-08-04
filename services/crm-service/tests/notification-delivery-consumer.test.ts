/**
 * notification-delivery-consumer.ts round-trip tests (DB-backed).
 *
 * Kept in its own file rather than folded into tests/domain.test.ts, per the
 * same collision-avoidance note as the consumer itself: this service is
 * being actively worked by other sessions and domain.test.ts is a hot file
 * there.
 *
 * Drives the REAL consumer (registerNotificationDeliveryConsumer) against a
 * MemoryQueue + the real Postgres (civitas_crm) singleton `db`, then asserts
 * the persisted crm.activities row. Covers:
 *   - happy path: delivery event -> activities row, keyed by contactId
 *   - contactId absent: still recorded, keyed by recipient (in `text`)
 *   - idempotency: redelivering the same messageId writes exactly one row
 *   - cross-tenant contactId: rejected (contactId nulled), row still written
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";

import { db, sqlClient } from "../src/shared/db.js";
import { registerNotificationDeliveryConsumer } from "../src/modules/activities/notification-delivery-consumer.js";
import { registerContactConsumers } from "../src/modules/contacts/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { buildView } from "../src/modules/contacts/commands.js";
import { activities } from "../src/modules/activities/schema.js";
import { contacts } from "../src/modules/contacts/schema.js";
import { warmCipher } from "../src/shared/pii-crypto.js";

process.env.CRM_PII_KEY ??= "test_pii_key_for_crm_domain_tests_aaaa";

const DELIVERY_TO_CRM_TOPIC = "notification.delivery.to_crm";

const TENANT_A = "eeeeeee1-0000-4000-8000-000000000001";
const TENANT_B = "eeeeeee2-0000-4000-8000-000000000002";
const ACTOR = "eeeeeee0-0000-4000-8000-0000000000aa";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const queue = wireTenantAwareQueue(new MemoryQueue());
registerContactConsumers(queue);
registerNotificationDeliveryConsumer(queue);

function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, fn);
}

function tenantQuery(tenantId: string) {
  return {
    async select(query: string, params: unknown[] = []): Promise<any[]> {
      return sqlClient.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return tx.unsafe(query, params);
      });
    },
  };
}

type Cmd = { messageId: string; type: string; tenantId: string; payload: Record<string, unknown> };

async function drive(topic: string, cmd: Cmd, ready: () => Promise<boolean>): Promise<void> {
  await queue.publish(topic, {
    messageId: cmd.messageId,
    type: cmd.type,
    tenantId: cmd.tenantId,
    actorId: ACTOR,
    correlationId: `corr-${cmd.messageId}`,
    schemaVersion: "1.0",
    payload: cmd.payload,
  });
  const deadline = Date.now() + 5000;
  for (;;) {
    if (await ready()) return;
    if (Date.now() > deadline) throw new Error(`drive(${topic}) timed out`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function createContactCmd(tenantId: string, overrides: Record<string, unknown> = {}): Cmd {
  const id = randomUUID();
  const view = buildView(id, { tenantId, actorId: ACTOR, correlationId: "c" } as never, {
    name: "Delivery Test Contact",
    leadStatus: "new",
    ...overrides,
  } as never);
  return { messageId: id, type: COMMANDS.createContact, tenantId, payload: view as Record<string, unknown> };
}

async function activityRow(tenantId: string, id: string): Promise<any | null> {
  const r = await tenantQuery(tenantId).select("select * from crm.activities where id = $1", [id]);
  return r[0] ?? null;
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT_A, TENANT_B]) {
    await withTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(activities).where(eq(activities.tenantId, t));
      await tx.delete(contacts).where(eq(contacts.tenantId, t));
    }));
  }
}

beforeAll(async () => {
  warmCipher();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("notification.delivery.to_crm -> crm.activities", () => {
  it("records a delivery event on the contact's timeline", { timeout: 10000 }, async () => {
    const contactCmd = createContactCmd(TENANT_A);
    await drive(COMMANDS.createContact, contactCmd, async () => {
      const r = await tenantQuery(TENANT_A).select("select 1 from crm.contacts where id = $1", [contactCmd.messageId]);
      return r.length > 0;
    });
    const contactId = contactCmd.messageId;

    const id = randomUUID();
    await drive(DELIVERY_TO_CRM_TOPIC, {
      messageId: id, type: DELIVERY_TO_CRM_TOPIC, tenantId: TENANT_A,
      payload: {
        id, tenantId: TENANT_A, status: "delivered", recipient: "citizen@example.in",
        contactId, campaignId: randomUUID(),
      },
    }, async () => (await activityRow(TENANT_A, id)) !== null);

    const row = await activityRow(TENANT_A, id);
    expect(row.type).toBe("comm_delivery");
    expect(row.contact_id).toBe(contactId);
    expect(row.status).toBe("completed");
    expect(row.text).toContain("delivered");
    expect(row.text).toContain("citizen@example.in");
  });

  it("records the event keyed by recipient when contactId is absent", { timeout: 10000 }, async () => {
    const id = randomUUID();
    await drive(DELIVERY_TO_CRM_TOPIC, {
      messageId: id, type: DELIVERY_TO_CRM_TOPIC, tenantId: TENANT_A,
      payload: { id, tenantId: TENANT_A, status: "opened", recipient: "no-contact@example.in" },
    }, async () => (await activityRow(TENANT_A, id)) !== null);

    const row = await activityRow(TENANT_A, id);
    expect(row.contact_id).toBeNull();
    expect(row.text).toContain("no-contact@example.in");
    expect(row.text).toContain("opened");
  });

  it("rejects a cross-tenant contactId but still records the delivery", { timeout: 10000 }, async () => {
    const contactCmd = createContactCmd(TENANT_B);
    await drive(COMMANDS.createContact, contactCmd, async () => {
      const r = await tenantQuery(TENANT_B).select("select 1 from crm.contacts where id = $1", [contactCmd.messageId]);
      return r.length > 0;
    });
    const foreignContactId = contactCmd.messageId;

    const id = randomUUID();
    await drive(DELIVERY_TO_CRM_TOPIC, {
      messageId: id, type: DELIVERY_TO_CRM_TOPIC, tenantId: TENANT_A,
      payload: { id, tenantId: TENANT_A, status: "bounced", recipient: "xtenant@example.in", contactId: foreignContactId },
    }, async () => (await activityRow(TENANT_A, id)) !== null);

    const row = await activityRow(TENANT_A, id);
    expect(row.contact_id).toBeNull();
    expect(row.text).toContain("bounced");

    // The foreign-tenant activity table must stay empty — no cross-tenant leak.
    const leaked = await tenantQuery(TENANT_B).select("select 1 from crm.activities where id = $1", [id]);
    expect(leaked.length).toBe(0);
  });

  it("is idempotent: redelivering the same messageId writes exactly one row", { timeout: 10000 }, async () => {
    const id = randomUUID();
    const cmd: Cmd = {
      messageId: id, type: DELIVERY_TO_CRM_TOPIC, tenantId: TENANT_A,
      payload: { id, tenantId: TENANT_A, status: "clicked", recipient: "idem@example.in" },
    };
    await drive(DELIVERY_TO_CRM_TOPIC, cmd, async () => (await activityRow(TENANT_A, id)) !== null);
    // Redeliver the identical command (same messageId) directly, bypassing drive's
    // single-shot publish so we can assert on row count rather than a ready() flag.
    await queue.publish(DELIVERY_TO_CRM_TOPIC, {
      messageId: id, type: DELIVERY_TO_CRM_TOPIC, tenantId: TENANT_A,
      actorId: ACTOR, correlationId: `corr-${id}-redelivery`, schemaVersion: "1.0",
      payload: cmd.payload,
    });
    // Give the (no-op) redelivery a moment to be claimed by markProcessed.
    await new Promise((r) => setTimeout(r, 200));

    const rows = await tenantQuery(TENANT_A).select("select count(*)::int as n from crm.activities where id = $1", [id]);
    expect(rows[0]?.n).toBe(1);
  });
});
