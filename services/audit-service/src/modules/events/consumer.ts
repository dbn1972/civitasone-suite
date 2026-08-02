import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
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
      // P1-4: serialize per-tenant chain appends. Without this, two concurrent
      // inserts can both read the same `latest` row and fork the hash chain.
      // pg_advisory_xact_lock auto-releases at COMMIT/ROLLBACK.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${msg.tenantId}))`);
      const latest = await repo.findLatestForTenant(msg.tenantId);
      const id = randomUUID();
      const now = new Date().toISOString();
      // CERT-In §4: capture actor IP, user agent, and field-level old/new values when provided.
      // retainUntil and CERT-In columns are added by migration 0004_cert_in_audit_fields.sql.
      const retainUntil = new Date(Date.now() + 180 * 86400 * 1000);
      const actor = { actorId: msg.actorId, ...(msg.payload.actor as Record<string, unknown> ?? {}) };
      const target = (msg.payload.resourceId as string) ?? null;
      // Store CERT-In metadata in the payload for queryability.
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
      // P1-4: bind full event content into the chain hash.
      const eventHash = computeHash(id, msg.tenantId, msg.type, latest?.eventHash ?? null, now, {
        actor, target, payload: enrichedPayload,
      });
      await repo.insert(tx, {
        id, tenantId: msg.tenantId, type: msg.type,
        actor,
        target,
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

  q.subscribe<IngestPayload>(CONSUMED_EVENTS.auditEventRecord, async (msg) => {
    await handleAuditEvent(msg);
  });

  q.subscribe<IngestPayload>(CONSUMED_EVENTS.auditEventIngest, async (msg) => {
    await handleAuditEvent(msg);
  });
}
