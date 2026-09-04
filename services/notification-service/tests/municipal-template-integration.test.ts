/**
 * Integration test (real Postgres, no mocks) proving the notification
 * template gap is fixed: packages/events/src/notification.ts's
 * buildNotificationPayload previously fell back to the generic `default`
 * template for every municipal event type — only citizen.application.approved
 * was mapped. This confirms:
 *
 *   1. buildMunicipalStatusNotification resolves a real, non-default
 *      templateId for a municipal event type (EVENT_TEMPLATE_MAP hit).
 *   2. That exact templateId is what the REAL deliveries consumer
 *      (registerDeliveryConsumers, COMMANDS.sendNotification) persists on
 *      the delivery row — not silently overridden.
 *   3. migration 0044_municipal_templates.sql actually seeded a template row
 *      with that id (so it is not just a dangling constant).
 */
import { describe, it, expect } from "vitest";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import {
  MUNICIPAL_EVENT_TYPES,
  SYSTEM_TEMPLATE_IDS,
  buildMunicipalStatusNotification,
} from "@civitasone/events";
import { db } from "../src/shared/db.js";
import { registerDeliveryConsumers } from "../src/modules/deliveries/consumer.js";
import * as deliveriesRepo from "../src/modules/deliveries/repo.js";
import { COMMANDS } from "../src/topics.js";
import { notificationTemplates } from "../src/modules/templates/schema.js";

const TENANT = "10000000-mtpl-4000-8000-000000000001".replace("mtpl", "aaaa");
const ACTOR = "20000000-mtpl-4000-8000-000000000001".replace("mtpl", "bbbb");
const PLATFORM_TENANT = "00000000-0000-0000-0000-000000000000"; // system templates live here

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue();
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  return q;
}

describe("municipal notification template mapping — real DB, no mocks", () => {
  it("migration 0044 seeded the municipal.application.submitted template", async () => {
    const [row] = await withTenantScope(db as never, PLATFORM_TENANT, (tx: any) =>
      tx.select().from(notificationTemplates)
        .where(and(eq(notificationTemplates.id, SYSTEM_TEMPLATE_IDS.municipalApplicationSubmitted), eq(notificationTemplates.tenantId, PLATFORM_TENANT)))
        .limit(1),
    );
    expect(row, "0044_municipal_templates.sql must have seeded this template row").toBeTruthy();
    expect(row.name).toBe("municipal.application.submitted");
  });

  it("resolves the municipal template (not the generic default) and the real consumer persists it on the delivery", async () => {
    const payload = buildMunicipalStatusNotification({
      eventType: MUNICIPAL_EVENT_TYPES.applicationSubmitted,
      recipient: "Acme Advertising Co",
      recipientId: randomUUID(),
      variables: { applicationId: "APP-2026-001", serviceName: "advertisement" },
    });
    // The actual bug being fixed: this used to fall through to `default`.
    expect(payload.templateId).toBe(SYSTEM_TEMPLATE_IDS.municipalApplicationSubmitted);
    expect(payload.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);

    const q = tenantWrappedQueue();
    registerDeliveryConsumers(q);
    await q.start();

    await q.publish(COMMANDS.sendNotification, makeMsg(COMMANDS.sendNotification, payload));
    await q.drain();

    const deliveries = await deliveriesRepo.findByRecipient(TENANT, payload.recipientId!, 5);
    expect(deliveries.length, "consumer must have written a delivery row").toBeGreaterThan(0);
    const delivery = deliveries[0]!;
    expect(delivery.templateId).toBe(SYSTEM_TEMPLATE_IDS.municipalApplicationSubmitted);
    expect(delivery.templateId).not.toBe(SYSTEM_TEMPLATE_IDS.default);

    await q.stop();
  });
});
