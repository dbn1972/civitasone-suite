/**
 * Justification reasons collected by the audit UI must be persisted in the
 * audit record, in the same transaction as the action they justify.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerObservationConsumers } from "../src/modules/observation/consumer.js";
import { registerExportConsumers } from "../src/modules/exports/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function auditPayloads(): Promise<Array<Record<string, unknown>>> {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
  return rows.filter((r) => r.eventType === "audit.event.record").map((r) => r.payload);
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("reason persistence in audit records", () => {
  afterAll(async () => {
    await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    await sqlClient.end();
  });

  it("observation create, reply and review remarks land in the audit payload", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerObservationConsumers(q);
    await q.start();
    const obs = randomUUID();
    const env = (type: string, payload: Record<string, unknown>) => ({
      messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID().slice(0, 32), schemaVersion: "1.0", payload,
    });
    await q.publish(COMMANDS.observationCreate, env(COMMANDS.observationCreate, {
      id: obs, tenantId: TENANT, obsNo: `OBS-${obs.slice(0, 8)}`, auditeeRef: "dept:x",
      finding: "f", reason: "create-reason-marker",
    }));
    await wait(300);
    await q.publish(COMMANDS.observationReply, env(COMMANDS.observationReply, {
      id: randomUUID(), observationId: obs, tenantId: TENANT,
      replyText: "r", respondedByRef: "dept:x:head", reason: "reply-reason-marker",
    }));
    await wait(300);
    await q.publish(COMMANDS.observationReview, env(COMMANDS.observationReview, {
      id: randomUUID(), observationId: obs, tenantId: TENANT,
      decision: "rejected", remarks: "review-remarks-marker",
    }));
    await wait(300);
    await q.stop();

    const byAction = Object.fromEntries((await auditPayloads()).map((p) => [String(p.action), p.reason]));
    expect(byAction.create).toBe("create-reason-marker");
    expect(byAction.reply).toBe("reply-reason-marker");
    expect(byAction.reply_rejected).toBe("review-remarks-marker");
  });

  it("PII export reason lands in the audit payload", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerExportConsumers(q);
    await q.start();
    const id = randomUUID();
    await q.publish(COMMANDS.exportCreate, {
      messageId: id, type: COMMANDS.exportCreate, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID().slice(0, 32), schemaVersion: "1.0",
      payload: {
        id, tenantId: TENANT, from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z",
        format: "json", includePii: true, roles: ["audit_admin"], reason: "export-reason-marker",
      },
    });
    await wait(1200);
    await q.stop();
    const created = (await auditPayloads()).find((p) => p.action === "create" && p.resourceType === "export");
    expect(created?.reason).toBe("export-reason-marker");
    expect(created?.includesPii).toBe(true);
  });
});
