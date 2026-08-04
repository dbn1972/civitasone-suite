/**
 * LQ-003 lead classification consumer.
 *
 * Persists temperature/priority/segment/product/region/expected-value on a contact
 * and records an audit event. Idempotent via markProcessed; the write is a guarded,
 * tenant-scoped UPDATE so a redelivery converges on the same row and a cross-tenant
 * message is a no-op (FORCE RLS + the explicit tenant_id predicate).
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";

const log = pino({ name: "crm-classification-consumer" });

export interface ClassifyContactPayload {
  id: string;
  tenantId: string;
  temperature?: string | null;
  priority?: string | null;
  segment?: string | null;
  product?: string | null;
  region?: string | null;
  expectedValueMinor?: number | null;
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): RequestContext {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as RequestContext;
}

export function registerClassificationConsumer(queue: Queue): void {
  queue.subscribe<ClassifyContactPayload>(COMMANDS.classifyContact, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // COALESCE(new, existing): only fields present in the payload are changed.
        // `undefined` never reaches here (JSON), so a key that was omitted arrives
        // as absent and its param resolves to null → COALESCE keeps the old value.
        // An explicit null clears the field (payload carries null).
        const has = (k: keyof ClassifyContactPayload): boolean =>
          Object.prototype.hasOwnProperty.call(p, k);
        await tx.execute(sql`
          UPDATE crm.contacts SET
            temperature = ${has("temperature") ? p.temperature ?? null : sql`temperature`},
            priority = ${has("priority") ? p.priority ?? null : sql`priority`},
            segment = ${has("segment") ? p.segment ?? null : sql`segment`},
            product = ${has("product") ? p.product ?? null : sql`product`},
            region = ${has("region") ? p.region ?? null : sql`region`},
            expected_value_minor = ${has("expectedValueMinor") ? p.expectedValueMinor ?? null : sql`expected_value_minor`},
            updated_at = now(),
            updated_by = ${msg.actorId},
            version = version + 1
          WHERE id = ${p.id} AND tenant_id = ${msg.tenantId} AND status = 'active'
        `);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.contactClassified,
          action: "classify",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: {
            contactId: p.id,
            fields: {
              ...(has("temperature") ? { temperature: p.temperature ?? null } : {}),
              ...(has("priority") ? { priority: p.priority ?? null } : {}),
              ...(has("segment") ? { segment: p.segment ?? null } : {}),
              ...(has("product") ? { product: p.product ?? null } : {}),
              ...(has("region") ? { region: p.region ?? null } : {}),
              ...(has("expectedValueMinor") ? { expectedValueMinor: p.expectedValueMinor ?? null } : {}),
            },
          },
        });
      });
      await cache.invalidate(cache.makeKey(p.tenantId, RESOURCE, p.id));
      await cache.invalidateResource(p.tenantId, RESOURCE);
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "classifyContact failed");
      throw err;
    }
  });
}
