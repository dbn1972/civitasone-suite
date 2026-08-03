import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { withTenantConsumer, setTenantGuc } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { applyLifecycle, changeTypeForAction, type ApiAction, type ApiStatus } from "./domain.js";
import { seedFromRegistry } from "./seed.js";

const AUDIT_TOPIC = "audit.event.record";

type RegisterPayload = {
  id: string;
  tenantId: string;
  name: string;
  module: string;
  version: string;
  path: string;
  method: string;
  status: "draft" | "active";
  source: "manual";
  upstream?: string;
  owner?: string;
  description?: string;
};

type LifecyclePayload = {
  id: string;
  action: ApiAction;
  deprecationDate?: string;
  sunsetDate?: string;
  note?: string;
};

type CatalogueMsg<T> = CommandEnvelope & { payload: T };

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: "gateway",
      action,
      resourceType: "catalogue_api",
      resourceId,
      outcome: "success",
    },
  });
}

export function registerCatalogueConsumers(q: Queue): void {
  q.subscribe<RegisterPayload>(
    COMMANDS.registerApi,
    withTenantConsumer(async (msg: CatalogueMsg<RegisterPayload>) => {
      const p = msg.payload;
      await db.transaction(async (tx) => {
        await setTenantGuc(tx as { execute: (q: unknown) => Promise<unknown> }, msg.tenantId);
        if (!(await markProcessed(tx, msg.messageId))) return;
        const existing = await repo.findByKey(tx as any, p.tenantId, {
          name: p.name,
          version: p.version,
          method: p.method,
          path: p.path,
        });
        if (existing) return; // idempotent / duplicate publish — already registered
        const created = await repo.upsertEntry(tx as any, {
          id: p.id,
          tenantId: p.tenantId,
          name: p.name,
          module: p.module,
          version: p.version,
          path: p.path,
          method: p.method,
          status: p.status,
          source: "manual",
          createdBy: msg.actorId,
          ...(p.upstream ? { upstream: p.upstream } : {}),
          ...(p.owner ? { owner: p.owner } : {}),
          ...(p.description ? { description: p.description } : {}),
        });
        await repo.insertChangelog(tx as any, {
          tenantId: p.tenantId,
          apiId: created.id,
          changeType: "registered",
          toStatus: created.status,
          note: "registered via catalogue API",
          actorId: msg.actorId,
        });
        await emit(tx, msg, EVENTS.apiRegistered, { apiId: created.id, name: p.name }, "register_api", created.id);
        await cache.put(cache.makeKey(msg.tenantId, RESOURCE, created.id), created);
      });
    }),
  );

  q.subscribe<LifecyclePayload>(
    COMMANDS.lifecycleApi,
    withTenantConsumer(async (msg: CatalogueMsg<LifecyclePayload>) => {
      const p = msg.payload;
      await db.transaction(async (tx) => {
        await setTenantGuc(tx as { execute: (q: unknown) => Promise<unknown> }, msg.tenantId);
        if (!(await markProcessed(tx, msg.messageId))) return;
        const entry = await repo.getEntry(tx as any, msg.tenantId, p.id);
        if (!entry) return;
        const from = entry.status as ApiStatus;
        let to: ApiStatus;
        try {
          to = applyLifecycle(from, p.action);
        } catch {
          return; // invalid transition — already validated on the command path
        }
        const patch: { status: string; deprecationDate?: string | null; sunsetDate?: string | null } = {
          status: to,
        };
        if (p.action === "deprecate") {
          patch.deprecationDate = p.deprecationDate ?? new Date().toISOString().slice(0, 10);
          if (p.sunsetDate) patch.sunsetDate = p.sunsetDate;
        }
        const updated = await repo.updateStatus(tx as any, msg.tenantId, p.id, patch);
        await repo.insertChangelog(tx as any, {
          tenantId: msg.tenantId,
          apiId: p.id,
          changeType: changeTypeForAction(p.action),
          fromStatus: from,
          toStatus: to,
          note: p.note ?? null,
          actorId: msg.actorId,
        });
        await emit(
          tx,
          msg,
          EVENTS.apiLifecycleChanged,
          { apiId: p.id, from, to, action: p.action },
          `lifecycle_${p.action}`,
          p.id,
        );
        if (updated) {
          await cache.put(cache.makeKey(msg.tenantId, RESOURCE, p.id), updated);
        }
      });
    }),
  );

  q.subscribe<{ tenantId: string }>(
    COMMANDS.seedCatalogue,
    withTenantConsumer(async (msg: CatalogueMsg<{ tenantId: string }>) => {
      await db.transaction(async (tx) => {
        await setTenantGuc(tx as { execute: (q: unknown) => Promise<unknown> }, msg.tenantId);
        if (!(await markProcessed(tx, msg.messageId))) return;
        const result = await seedFromRegistry(tx as any, msg.tenantId, msg.actorId);
        await emit(
          tx,
          msg,
          EVENTS.catalogueSeeded,
          { total: result.total, created: result.created },
          "seed_catalogue",
          msg.messageId,
        );
      });
      await cache.invalidateResource(msg.tenantId, RESOURCE);
    }),
  );
}
