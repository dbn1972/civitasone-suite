import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { CONSUME_TOPICS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeHash, type IngestPayload } from "./domain.js";

export function registerAuditConsumers(q: Queue): void {
  const handleAuditEvent = async (msg: {
    messageId: string;
    tenantId: string;
    actorId: string;
    correlationId: string;
    payload: Record<string, unknown>;
    type: string;
  }): Promise<void> => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const latest = await repo.findLatestForTenant(msg.tenantId);
      const id = randomUUID();
      const now = new Date().toISOString();
      const eventHash = computeHash(id, msg.tenantId, msg.type, latest?.eventHash ?? null, now);
      await repo.insert(tx, {
        id, tenantId: msg.tenantId, type: msg.type,
        actor: { actorId: msg.actorId },
        target: (msg.payload.resourceId as string) ?? null,
        payload: msg.payload,
        severity: (msg.payload.severity as string) ?? "info",
        prevHash: latest?.eventHash ?? null,
        eventHash,
        correlationId: msg.correlationId,
        createdBy: msg.actorId,
      });
    });
  };

  q.subscribe<IngestPayload>(CONSUME_TOPICS.auditEventIngest, async (msg) => {
    await handleAuditEvent(msg);
  });

  q.subscribe<IngestPayload>(CONSUME_TOPICS.auditEventRecord, async (msg) => {
    await handleAuditEvent(msg);
  });
}
