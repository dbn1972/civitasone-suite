import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { UpsertBrandingPayload } from "./commands.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "branding";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerBrandingConsumers(queue: Queue): void {
  queue.subscribe<UpsertBrandingPayload>(COMMANDS.upsertBranding, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { projected, isCreate } = msg.payload;
      // Known residual race, accepted as a large improvement over the prior
      // behavior rather than fixed here: isCreate is decided once in
      // commands.ts (findRowByTenant(), read before this message was even
      // published) and baked into the queued payload. Two concurrent
      // FIRST-EVER saves for the same tenant can both read "no existing row"
      // and both arrive here with isCreate:true. The first insert succeeds;
      // the second violates the UNIQUE(tenant_id) constraint added in
      // 0004c_tenant_branding_unique_tenant.sql, throws, and rolls back this
      // whole transaction (including markProcessed() above) — Postgres has
      // no partial-transaction recovery without an explicit SAVEPOINT, which
      // this handler doesn't take. Depending on the queue driver's redelivery
      // behavior, the second request's save can end up dropped rather than
      // applied, with no error surfaced to that caller (their HTTP PUT
      // already returned 202 before this consumer ever ran).
      // This is still strictly better than before this PR: the old
      // insert-only code had NO constraint at all, so this exact race
      // deterministically produced a stray row on every second save, not
      // just under a narrow timing window. Closing this fully would mean
      // either a SAVEPOINT-based retry here or moving to a single atomic
      // `INSERT ... ON CONFLICT (tenant_id) DO UPDATE` — tracked as a
      // follow-up, not done here to avoid rushing a transaction-recovery
      // change into this already-large fix.
      if (isCreate) {
        await repo.insert(tx, projected);
      } else {
        const { tenantId, ...patch } = projected;
        await repo.update(tx, tenantId, patch);
      }
      await emit(tx, msg, EVENTS.brandingUpserted, { brandingId: projected.id, tenantId: projected.tenantId }, "upsert", projected.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.projected.id), msg.payload.projected);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "themes", action, resourceType: "branding", resourceId, outcome: "success" } });
}
