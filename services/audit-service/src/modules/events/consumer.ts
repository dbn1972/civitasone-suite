// NOTE: audit-service event consumer does not re-emit audit events (would cause infinite loop)

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeHash, nextOccurredAt, type IngestPayload } from "./domain.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** events.events.target is varchar(256). */
const MAX_TARGET_LEN = 256;

/**
 * UAT B10-F83: split permanent from transient ingest failures.
 *
 * A message that can never be stored (tenant or actor not a uuid, payload not
 * an object, a resourceId that does not fit the target column) is rejected
 * once with NonRetryableError: the bus logs it at error level and
 * dead-letters it immediately with the reason, where it can be inspected and
 * replayed after a fix. Before, these failed inside the INSERT and were
 * retried until maxReceiveCount like a transient error, with nothing to tell
 * them apart. Everything else (DB unavailable, lock timeout, pool exhausted)
 * is left retryable: the message is only deleted after the transaction below
 * has committed, so a crash or a DB error never loses an event.
 */
export function assertIngestable(msg: {
  tenantId?: unknown; actorId?: unknown; payload?: unknown; messageId?: unknown;
}): void {
  const reject = (code: string, detail: string): never => {
    throw new NonRetryableError(`${code}: ${detail} (messageId ${String(msg.messageId)})`);
  };
  if (typeof msg.tenantId !== "string" || !UUID_RE.test(msg.tenantId)) reject("AUDIT_INVALID_TENANT", "tenantId must be a uuid");
  if (typeof msg.actorId !== "string" || !UUID_RE.test(msg.actorId)) reject("AUDIT_INVALID_ACTOR", "actorId must be a uuid");
  if (!msg.payload || typeof msg.payload !== "object" || Array.isArray(msg.payload)) reject("AUDIT_INVALID_PAYLOAD", "payload must be an object");
  const rid = (msg.payload as Record<string, unknown>).resourceId;
  if (rid !== undefined && rid !== null && (typeof rid !== "string" || rid.length > MAX_TARGET_LEN)) {
    reject("AUDIT_INVALID_RESOURCE_ID", `resourceId must be a string of at most ${MAX_TARGET_LEN} chars`);
  }
}

/**
 * UAT B10-F83 (review): the event time is the envelope timestamp, which the
 * outbox relay sets to the producer's commit instant for audit topics. Never
 * later than the chain instant (clock skew), and the chain instant when the
 * timestamp is missing or unparseable.
 */
export function resolveEventAt(timestamp: unknown, occurredAt: Date): Date {
  if (typeof timestamp !== "string") return occurredAt;
  const t = new Date(timestamp);
  if (Number.isNaN(t.getTime())) return occurredAt;
  return t.getTime() > occurredAt.getTime() ? occurredAt : t;
}

/** Postgres data-exception (22xxx) and integrity (23xxx) errors cannot succeed on redelivery. */
function isPermanentDbError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^2[23][0-9A-Z]{3}$/.test(code);
}

export function registerAuditConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  const handleAuditEvent = async (msg: {
    messageId: string;
    tenantId: string;
    actorId: string;
    correlationId: string;
    payload: Record<string, unknown>;
    type: string;
    timestamp?: string;
  }): Promise<void> => {
    assertIngestable(msg);
    try {
      await ingest(msg);
    } catch (err) {
      if (isPermanentDbError(err)) {
        throw new NonRetryableError(`AUDIT_INGEST_REJECTED: ${(err as Error).message} (messageId ${msg.messageId})`, err);
      }
      throw err;
    }
  };

  const ingest = async (msg: {
    messageId: string;
    tenantId: string;
    actorId: string;
    correlationId: string;
    payload: Record<string, unknown>;
    type: string;
    timestamp?: string;
  }): Promise<void> => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // P1-4: serialize per-tenant chain appends. Without this, two concurrent
      // inserts can both read the same `latest` row and fork the hash chain.
      // pg_advisory_xact_lock auto-releases at COMMIT/ROLLBACK.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${msg.tenantId}))`);
      const latest = await repo.findLatestForTenantTx(tx, msg.tenantId);
      const id = randomUUID();
      // V4-G-05: this exact instant is hashed AND persisted as occurred_at.
      const occurredAt = nextOccurredAt(latest?.occurredAt);
      const now = occurredAt.toISOString();
      const eventAt = resolveEventAt(msg.timestamp, occurredAt);
      // CERT-In §4: capture actor IP, user agent, and field-level old/new values when provided.
      // retainUntil and CERT-In columns are added by migration 0004_cert_in_audit_fields.sql.
      const retainUntil = new Date(Date.now() + 180 * 86400 * 1000);
      const actor = { actorId: msg.actorId, ...(msg.payload.actor as Record<string, unknown> ?? {}) };
      const target = (msg.payload.resourceId as string) ?? null;
      // Store CERT-In metadata in the payload for queryability.
      const enrichedPayload = {
        ...msg.payload,
        // Bound into the chain hash, so the event time is tamper-evident too.
        _eventAt: eventAt.toISOString(),
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
        occurredAt,
        eventAt,
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

  queue.subscribe<IngestPayload>(CONSUMED_EVENTS.auditEventRecord, async (msg) => {
    await handleAuditEvent(msg);
  });

  queue.subscribe<IngestPayload>(CONSUMED_EVENTS.auditEventIngest, async (msg) => {
    await handleAuditEvent(msg);
  });
}
