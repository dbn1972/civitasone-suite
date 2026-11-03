import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE_TENANT } from "../../topics.js";
import * as repo from "./repo.js";
import type { TenantView } from "./domain.js";
import type { TenantCreatedEvent } from "@civitasone/events/contracts";
import { resolveTenantCreated, makeTenantServiceFetcher, type FetchTenant } from "./tenant-created.js";

const log = pino({ name: "admin-tenants-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const TENANT_BOOTSTRAP = "tenant.tenant.create";

function keyFor(id: string) { return cache.makeKey(id, RESOURCE_TENANT, id); }

export function registerTenantConsumers(queue: Queue, deps: { fetchTenant?: FetchTenant } = {}): void {
  queue.subscribe<TenantView>(COMMANDS.tenantCreate, async (msg) => {
    try {
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
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.tenantCreate }, "Consumer processing failed");
    }
  });

  // F133 (UAT b15): tenant-service owns tenants; this registers a tenant it created in the admin directory. The event
  // used to carry only { tenantId, plan } while this read id/name/domain/..., so the insert had no id and no new tenant
  // ever reached /admin/tenants. resolveTenantCreated reads the v1.1 payload and, for a v1.0 event, fetches the missing
  // directory fields from tenant-service. A failure is logged AND rethrown so the queue retries / dead-letters it:
  // swallowing it here is how every new tenant went missing without a trace.
  queue.subscribe<TenantCreatedEvent>(
    "tenant.tenant.created",
    async (msg) => {
    try {
      const fetchTenant = deps.fetchTenant ?? makeTenantServiceFetcher({ correlationId: msg.correlationId });
      const t = await resolveTenantCreated(msg.payload, fetchTenant);
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const existing = await repo.findByIdTx(tx, t.id);
        if (existing) {
          await repo.update(tx, t.id, { name: t.name, domain: t.domain, edition: t.edition, updatedBy: msg.actorId });
        } else {
          await repo.insert(tx, {
            id: t.id, tenantId: t.id, name: t.name, domain: t.domain,
            edition: t.edition, status: t.status, region: t.region, residency: t.residency,
            settings: {}, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
          });
        }
      });
      await cache.invalidate(keyFor(t.id));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "tenant.tenant.created" }, "Consumer processing failed");
      throw err;
    }
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
