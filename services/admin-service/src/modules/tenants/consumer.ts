import { pino } from "pino";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, processed } from "../../shared/outbox.js";
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
      // PR #2450 review: worker.ts registers this on the plain queue, and tenants.admin_tenants is FORCE RLS with
      // WITH CHECK (tenant_id = current_tenant_id()). The row belongs to the tenant being created, so the write runs
      // in THAT tenant context (not the envelope tenant, which is the creator).
      await runWithTenant(msg.payload.id, () => db.transaction(async (tx) => {
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
      }));
      await cache.put(keyFor(msg.payload.id), msg.payload);
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.tenantCreate }, "Consumer processing failed");
    }
  });

  // F133 (UAT b15): tenant-service owns tenants; this registers a tenant it created in the admin directory. The event
  // used to carry only { tenantId, plan } while this read id/name/domain/..., so the insert had no id and no new tenant
  // ever reached /admin/tenants. resolveTenantCreated reads the v1.1 payload and, for a v1.0 event, fetches the missing
  // directory fields from tenant-service.
  //  - Dedupe first: an already-processed delivery is acked without calling tenant-service.
  //  - The write runs in the resolved tenant context (runWithTenant): worker.ts registers this on the plain queue and
  //    tenants.admin_tenants is FORCE RLS (WITH CHECK tenant_id = current_tenant_id()).
  //  - A payload that cannot become a row (contract violation, tenant unknown to tenant-service, a domain already
  //    registered for another tenant) is a NonRetryableError: straight to the DLQ. Other failures are retried.
  queue.subscribe<TenantCreatedEvent>(
    "tenant.tenant.created",
    async (msg) => {
    try {
      if (await alreadyProcessed(msg.messageId)) return;
      const fetchTenant = deps.fetchTenant ?? makeTenantServiceFetcher({ correlationId: msg.correlationId });
      const t = await resolveTenantCreated(msg.payload, fetchTenant);
      try {
        await runWithTenant(t.id, () => db.transaction(async (tx) => {
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
        }));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new NonRetryableError(`tenant ${t.id}: domain ${t.domain} is already registered for another tenant`, err);
        }
        throw err;
      }
      await cache.invalidate(keyFor(t.id));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: "tenant.tenant.created" }, "Consumer processing failed");
      throw err;
    }
  });
}

/** True when this delivery was already applied (checked before any tenant-service call). */
async function alreadyProcessed(messageId: string): Promise<boolean> {
  const rows = await db.select({ id: processed.messageId }).from(processed).where(eq(processed.messageId, messageId)).limit(1);
  return rows.length > 0;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
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
