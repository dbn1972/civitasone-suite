/**
 * identity-providers consumer — the ONLY code that writes Postgres for IdP / SSO providers.
 * idempotency-check -> tenant-guarded write + outbox (event + audit) in ONE transaction.
 * Secrets never reach the audit trail or the event: only the names of changed fields.
 */
import { and, eq, sql } from "drizzle-orm";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { identityProviders } from "./schema.js";
import { IDP_COMMANDS, IDP_EVENTS } from "./topics.js";

const log = pino({ name: "admin-identity-providers-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "identity_provider";

type Tx = Parameters<typeof enqueue>[0];
type Msg<P> = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: P };

interface Fields {
  name?: string; protocol?: string; endpoint?: string; entityId?: string;
  clientId?: string | null; status?: string;
  clientSecretCiphertext?: string; clientSecretLast4?: string;
}

async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  event: string,
  action: string,
  provider: { providerId: string; kind: string },
  changedFields: string[],
): Promise<void> {
  await enqueue(tx as Tx, {
    topic: event, eventType: event, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { providerId: provider.providerId, kind: provider.kind, changedFields },
  });
  await enqueue(tx as Tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: {
      service: "admin", action, resourceType: RESOURCE, resourceId: provider.providerId, outcome: "success",
      kind: provider.kind, changedFields,
    },
  });
}

/** A command that could not take effect (e.g. name collision): recorded, never silent. No domain event, no secret. */
async function emitFailure(
  tx: unknown,
  msg: { messageId: string; tenantId: string; actorId: string; correlationId: string },
  action: string,
  provider: { providerId: string; kind: string },
  reason: string,
): Promise<void> {
  log.warn({ messageId: msg.messageId, tenantId: msg.tenantId, providerId: provider.providerId, action, reason }, "Identity provider command rejected");
  await enqueue(tx as Tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: {
      service: "admin", action, resourceType: RESOURCE, resourceId: provider.providerId, outcome: "failure",
      kind: provider.kind, reason,
    },
  });
}

const isUniqueViolation = (err: unknown): boolean => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
};

const fieldNames = (f: Fields): string[] =>
  Object.keys(f).filter((k) => k !== "clientSecretLast4").map((k) => (k === "clientSecretCiphertext" ? "clientSecret" : k));

export function registerIdentityProviderConsumers(queue: Queue): void {
  queue.subscribe<{ tenantId: string; providerId: string; kind: string } & Fields>(
    IDP_COMMANDS.create,
    async (msg: Msg<{ tenantId: string; providerId: string; kind: string } & Fields>) => {
      try {
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          const p = msg.payload;
          const inserted = await (tx as any).insert(identityProviders).values({
            id: p.providerId, tenantId: p.tenantId, kind: p.kind, name: p.name, protocol: p.protocol,
            entityId: p.entityId ?? "", endpoint: p.endpoint, clientId: p.clientId ?? null,
            clientSecretCiphertext: p.clientSecretCiphertext ?? null, clientSecretLast4: p.clientSecretLast4 ?? null,
            status: p.status ?? "inactive", createdBy: msg.actorId, updatedBy: msg.actorId,
          }).onConflictDoNothing().returning({ id: identityProviders.id });
          // A concurrent create of the same (kind, name) lost the race: nothing was written; record the failure.
          if (inserted.length === 0) {
            await emitFailure(tx, msg, `identity_provider.${p.kind}.create`, p, "name_conflict");
            return;
          }
          const { tenantId: _t, providerId: _p, kind: _k, ...fields } = p;
          await emit(tx, msg, IDP_EVENTS.created, `identity_provider.${p.kind}.create`, p, fieldNames(fields));
        });
      } catch (err) {
        log.error({ err, messageId: msg.messageId, type: IDP_COMMANDS.create }, "Consumer processing failed");
        throw err;
      }
    },
  );

  queue.subscribe<{ tenantId: string; providerId: string; kind: string } & Fields>(
    IDP_COMMANDS.update,
    async (msg: Msg<{ tenantId: string; providerId: string; kind: string } & Fields>) => {
      try {
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          const p = msg.payload;
          const { tenantId: _t, providerId: _p, kind: _k, ...fields } = p;
          const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${identityProviders.version} + 1` };
          for (const [k, v] of Object.entries(fields)) if (v !== undefined) set[k] = v;
          const updated = await (tx as any).update(identityProviders).set(set)
            .where(and(eq(identityProviders.id, p.providerId), eq(identityProviders.tenantId, p.tenantId), eq(identityProviders.kind, p.kind)))
            .returning({ id: identityProviders.id });
          if (updated.length === 0) return; // deleted meanwhile: nothing changed, nothing audited
          await emit(tx, msg, IDP_EVENTS.updated, `identity_provider.${p.kind}.update`, p, fieldNames(fields));
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          // A rename colliding with an existing (kind, name) can never succeed on redelivery: record it and ack.
          const p = msg.payload;
          await db.transaction(async (tx) => {
            if (!(await markProcessed(tx, msg.messageId))) return;
            await emitFailure(tx, msg, `identity_provider.${p.kind}.update`, p, "name_conflict");
          });
          return;
        }
        log.error({ err, messageId: msg.messageId, type: IDP_COMMANDS.update }, "Consumer processing failed");
        throw err;
      }
    },
  );

  queue.subscribe<{ tenantId: string; providerId: string; kind: string }>(
    IDP_COMMANDS.remove,
    async (msg: Msg<{ tenantId: string; providerId: string; kind: string }>) => {
      try {
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          const p = msg.payload;
          const removed = await (tx as any).delete(identityProviders)
            .where(and(eq(identityProviders.id, p.providerId), eq(identityProviders.tenantId, p.tenantId), eq(identityProviders.kind, p.kind)))
            .returning({ id: identityProviders.id });
          if (removed.length === 0) return; // idempotent
          await emit(tx, msg, IDP_EVENTS.deleted, `identity_provider.${p.kind}.delete`, p, []);
        });
      } catch (err) {
        log.error({ err, messageId: msg.messageId, type: IDP_COMMANDS.remove }, "Consumer processing failed");
        throw err;
      }
    },
  );
}
