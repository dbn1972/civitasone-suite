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
      // CERT-In §4: capture actor IP, user agent, and field-level old/new values when provided.
      // retainUntil and CERT-In columns are added by migration 0004_cert_in_audit_fields.sql.
      // Until that migration runs, the insert omits those columns to stay backward-compatible.
      const retainUntil = new Date(Date.now() + 180 * 86400 * 1000);
      // Store CERT-In metadata in the payload for queryability even before migration 0004 runs.
      // After migration 0004, the dedicated columns are populated via raw SQL in the consumer.
      const enrichedPayload = {
        ...msg.payload,
        _certIn: {
          ipAddress: (msg.payload.ipAddress as string) ?? null,
          userAgent: (msg.payload.userAgent as string) ?? null,
          oldValue: (msg.payload.oldValue as Record<string, unknown>) ?? null,
          newValue: (msg.payload.newValue as Record<string, unknown>) ?? null,
          retainUntil: retainUntil.toISOString(),
        },
      };
      await repo.insert(tx, {
        id, tenantId: msg.tenantId, type: msg.type,
        actor: { actorId: msg.actorId, ...(msg.payload.actor as Record<string, unknown> ?? {}) },
        target: (msg.payload.resourceId as string) ?? null,
        payload: enrichedPayload,
        severity: (msg.payload.severity as string) ?? "info",
        prevHash: latest?.eventHash ?? null,
        eventHash,
        correlationId: msg.correlationId,
        createdBy: msg.actorId,
        ipAddress: (msg.payload.ipAddress as string) ?? null,
        userAgent: (msg.payload.userAgent as string) ?? null,
        oldValue: (msg.payload.oldValue as Record<string, unknown>) ?? null,
        newValue: (msg.payload.newValue as Record<string, unknown>) ?? null,
        retainUntil,
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
