/**
 * GAP-PROCUREMENT-VENDORS-NEW-06 (server, pinning test).
 *
 * The vendorCreate consumer must force the initial status to 'registered'
 * regardless of any client-supplied status (so a client can't self-empanel at
 * creation), and must audit the creation. This pins src/modules/vendor/
 * consumer.ts's COMMANDS.vendorCreate handler, which hardcodes
 * vendorType:"registered" and emits audit(..., "create", "vendor", id).
 *
 * NOTE on dedup: unique (tenant,gstin)/(tenant,pan) is NOT yet enforced — see
 * HUMAN REVIEW in the batch report; this test does not assert it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerVendorConsumers } from "../src/modules/vendor/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "11111111-eeee-4000-8000-0000000000a6";
const ACTOR = randomUUID();

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

let queue: Queue;

beforeAll(async () => {
  queue = wireTenantAwareQueue(new MemoryQueue() as unknown as Queue);
  registerVendorConsumers(queue);
  await queue.start();
});

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT));
    }),
  );
}

afterAll(async () => {
  await clean();
  await queue.stop();
  await sqlClient.end();
});

describe("VENDORS-NEW-06 — vendor create forces initial status + audits", () => {
  it("stores vendorType='registered' even when the client payload claims status='empanelled'", async () => {
    await clean();
    const id = randomUUID();
    const msgId = randomUUID();
    await runWithTenant(TENANT, () =>
      queue.publish(COMMANDS.vendorCreate, {
        messageId: msgId, type: COMMANDS.vendorCreate,
        tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
        // Hostile client input: try to self-empanel at creation.
        payload: { id, tenantId: TENANT, name: "Sneaky Vendor", mse: false, msme: false, status: "empanelled", vendorType: "empanelled" },
      }),
    );
    await queue.drain();

    const [row] = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(procurementVendors).where(eq(procurementVendors.id, id))),
    );
    expect(row).toBeTruthy();
    expect(row.vendorType).toBe("registered");

    // A create audit event was written in the same transaction.
    const audits = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(outboxMessages).where(and(
        eq(outboxMessages.tenantId, TENANT),
      ))),
    );
    const hasCreateAudit = audits.some((a) => JSON.stringify(a).includes("\"create\"") && JSON.stringify(a).includes(id));
    expect(hasCreateAudit).toBe(true);
  });
});
