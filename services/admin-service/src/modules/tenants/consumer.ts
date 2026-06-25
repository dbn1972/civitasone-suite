import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE_TENANT } from "../../topics.js";
import * as repo from "./repo.js";
import { assertTransition, type TenantView } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const TENANT_BOOTSTRAP = "tenant.tenant.create";

function keyFor(id: string) { return cache.makeKey(id, RESOURCE_TENANT, id); }

export function registerTenantConsumers(queue: Queue): void {
  queue.subscribe<TenantView>(COMMANDS.tenantCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id, tenantId: p.id, name: p.name, domain: p.domain, edition: p.edition,
        status: "draft", region: p.region, residency: p.residency, settings: {},
        createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await emit(tx, msg, EVENTS.tenantCreated, { tenantId: p.id, edition: p.edition }, "create", p.id);
      await enqueue(tx, {
        topic: TENANT_BOOTSTRAP, eventType: TENANT_BOOTSTRAP,
        tenantId: p.id, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, name: p.name, domain: p.domain, edition: p.edition, region: p.region, residency: p.residency },
      });
    });
    await cache.put(keyFor(msg.payload.id), msg.payload);
  });

  queue.subscribe<{ id: string; edition: string }>(COMMANDS.tenantEditionChange, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.payload.id);
      if (!cur) throw new Error(`tenant ${msg.payload.id} not found`);
      // Bump version on every state mutation so optimistic-concurrency consumers
      // see edition changes the same way they see suspend/reactivate.
      await repo.update(tx, msg.payload.id, { edition: msg.payload.edition, updatedBy: msg.actorId, version: cur.version + 1 });
      await audit(tx, msg, "edition_change", msg.payload.id);
    });
    await cache.invalidate(keyFor(msg.payload.id));
  });

  queue.subscribe<{ id: string; reason: string }>(COMMANDS.tenantSuspend, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.payload.id);
      if (!cur) throw new Error(`tenant ${msg.payload.id} not found`);
      assertTransition(cur.status, "suspended");
      await repo.update(tx, msg.payload.id, { status: "suspended", updatedBy: msg.actorId, version: cur.version + 1 });
      await emit(tx, msg, EVENTS.tenantSuspended, { tenantId: msg.payload.id, reason: msg.payload.reason }, "suspend", msg.payload.id);
    });
    await cache.invalidate(keyFor(msg.payload.id));
  });

  queue.subscribe<{ id: string }>(COMMANDS.tenantReactivate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTx(tx, msg.payload.id);
      if (!cur) throw new Error(`tenant ${msg.payload.id} not found`);
      assertTransition(cur.status, "active");
      await repo.update(tx, msg.payload.id, { status: "active", updatedBy: msg.actorId, version: cur.version + 1 });
      await audit(tx, msg, "reactivate", msg.payload.id);
    });
    await cache.invalidate(keyFor(msg.payload.id));
  });

  queue.subscribe<{ id: string; tenantId: string; name: string; domain: string; edition: string; status?: string; region: string; residency: string; settings?: Record<string, unknown> }>(
    "tenant.tenant.created",
    async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const edition = p.edition === "govt" ? "govt_dept" : p.edition;
      const existing = await repo.findByIdTx(tx, p.id);
      if (existing) {
        await repo.update(tx, p.id, { name: p.name, domain: p.domain, edition, updatedBy: msg.actorId });
      } else {
        await repo.insert(tx, {
          id: p.id, tenantId: p.id, name: p.name, domain: p.domain,
          edition, status: p.status ?? "draft", region: p.region, residency: p.residency,
          settings: p.settings ?? {}, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
        });
      }
    });
    await cache.invalidate(keyFor(msg.payload.id));
  });
}

async function emit(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as any;
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await audit(t, msg, action, resourceId);
}

async function audit(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  const t = tx as any;
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "admin", action, resourceType: "tenant", resourceId, outcome: "success" },
  });
}
