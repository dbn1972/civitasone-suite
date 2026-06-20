/**
 * Consumer (the ONLY code that writes Postgres).
 * For each command: idempotency-check → apply write + enqueue domain & audit events in
 * the SAME transaction (outbox) → refresh/invalidate cache. The outbox relay publishes
 * the events after commit.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { assertTransition, type TenantView } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(id: string) { return cache.makeKey(id, RESOURCE, id); }

export function registerTenantConsumers(queue: Queue): void {
  queue.subscribe<TenantView>(COMMANDS.createTenant, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // already handled
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id, tenantId: p.id, name: p.name, domain: p.domain, edition: p.edition,
        status: "draft", region: p.region, residency: p.residency, settings: {},
        createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await emit(tx, msg, EVENTS.tenantCreated, { tenantId: p.id, plan: p.edition }, "create", p.id);
    });
    await cache.put(keyFor(msg.payload.id), msg.payload); // refresh
  });

  queue.subscribe<{ id: string; name?: string; settings?: Record<string, unknown> }>(
    COMMANDS.updateTenant,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const cur = await repo.findByIdTx(tx, msg.payload.id);
        if (!cur) throw new Error(`tenant ${msg.payload.id} not found`);
        const patch: Record<string, unknown> = { updatedBy: msg.actorId, version: cur.version + 1 };
        if (msg.payload.name !== undefined) patch.name = msg.payload.name;
        if (msg.payload.settings !== undefined) patch.settings = msg.payload.settings;
        await repo.update(tx, msg.payload.id, patch);
        await emit(tx, msg, EVENTS.tenantUpdated, { tenantId: msg.payload.id }, "update", msg.payload.id);
      });
      await cache.invalidate(keyFor(msg.payload.id));
    }
  );

  queue.subscribe<{ id: string; reason: string }>(COMMANDS.suspendTenant, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.payload.id);
      if (!cur) throw new Error(`tenant ${msg.payload.id} not found`);
      assertTransition(cur.status, "suspended"); // domain rule
      await repo.update(tx, msg.payload.id, { status: "suspended", updatedBy: msg.actorId, version: cur.version + 1 });
      await emit(tx, msg, EVENTS.tenantSuspended, { tenantId: msg.payload.id, reason: msg.payload.reason }, "suspend", msg.payload.id);
    });
    await cache.invalidate(keyFor(msg.payload.id));
  });
}

/** Enqueue the domain event + the mandatory audit event (CLAUDE.md §3: every mutation audits). */
async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "tenant", action, resourceType: "tenant", resourceId, outcome: "success" },
  });
}
