/**
 * metrics/consumer.ts — the ONLY code that writes reports.metric_definitions.
 *
 * Every handler follows the mandated shape:
 *   markProcessed(tx, messageId)  ← first statement, returns false on redelivery
 *   → repo write
 *   → enqueue domain event + audit event to the outbox (same transaction)
 *   → invalidate the cache keys (after the transaction)
 */
import type { CommandEnvelope, Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { statusTransitionPatch } from "./domain.js";
import { byKeyCacheKey, keyFor, RESOURCE } from "./queries.js";
import * as repo from "./repo.js";
import type { MetricDefinitionInsert } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

/** Payload for create + version commands (a full definition row projection). */
export interface MetricDefinitionCommandPayload {
  id: string;
  tenantId: string;
  metricKey: string;
  displayName: string;
  description: string | null;
  module: string;
  unit: string;
  aggregation: string;
  numeratorSource: string;
  denominatorSource: string | null;
  dimensions: string[];
  period: string;
  targetValue: string | null;
  higherIsBetter: boolean;
  governance: string;
  versionNumber: number;
  status: string;
  version: number;
  /** Present only on the version command — the row this draft was copied from. */
  sourceId?: string;
}

export interface MetricUpdatePayload {
  id: string;
  version: number;
  patch: Record<string, unknown>;
}

export interface MetricTransitionPayload {
  id: string;
  version: number;
  metricKey: string;
}

type Ctx = Pick<CommandEnvelope, "tenantId" | "actorId" | "correlationId">;

async function audit(
  tx: Parameters<typeof enqueue>[0],
  ctx: Ctx,
  action: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: {
      service: "reports",
      action,
      resourceType: "metric_definition",
      resourceId,
      outcome: "success",
    },
  });
}

async function emit(
  tx: Parameters<typeof enqueue>[0],
  ctx: Ctx,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: eventType,
    eventType,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload,
  });
}

async function invalidate(tenantId: string, id: string, metricKey: string): Promise<void> {
  await cache.invalidate(keyFor(tenantId, id));
  await cache.invalidate(byKeyCacheKey(tenantId, metricKey));
  await cache.invalidateResource(tenantId, RESOURCE);
}

function toInsert(p: MetricDefinitionCommandPayload, actorId: string): MetricDefinitionInsert {
  return {
    id: p.id,
    tenantId: p.tenantId,
    metricKey: p.metricKey,
    displayName: p.displayName,
    description: p.description,
    module: p.module,
    unit: p.unit,
    aggregation: p.aggregation,
    numeratorSource: p.numeratorSource,
    denominatorSource: p.denominatorSource,
    dimensions: p.dimensions,
    period: p.period,
    targetValue: p.targetValue,
    higherIsBetter: p.higherIsBetter,
    governance: p.governance,
    versionNumber: p.versionNumber,
    status: p.status,
    createdBy: actorId,
    updatedBy: actorId,
    version: 1,
  };
}

export async function handleCreateMetricDefinition(
  msg: CommandEnvelope<MetricDefinitionCommandPayload>,
): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await repo.insert(tx, toInsert(p, msg.actorId));
    await emit(tx, msg, EVENTS.metricDefinitionCreated, {
      id: p.id,
      metricKey: p.metricKey,
      versionNumber: p.versionNumber,
      governance: p.governance,
    });
    await audit(tx, msg, "metric_definition.create", p.id);
  });
  await invalidate(msg.tenantId, p.id, p.metricKey);
}

export async function handleVersionMetricDefinition(
  msg: CommandEnvelope<MetricDefinitionCommandPayload>,
): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await repo.insert(tx, toInsert(p, msg.actorId));
    await emit(tx, msg, EVENTS.metricDefinitionVersioned, {
      id: p.id,
      sourceId: p.sourceId ?? null,
      metricKey: p.metricKey,
      versionNumber: p.versionNumber,
    });
    await audit(tx, msg, "metric_definition.version", p.id);
  });
  await invalidate(msg.tenantId, p.id, p.metricKey);
}

export async function handleUpdateMetricDefinition(
  msg: CommandEnvelope<MetricUpdatePayload>,
): Promise<void> {
  const p = msg.payload;
  let metricKey = "";
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const applied = await repo.updateByVersion(tx, p.id, msg.tenantId, p.version, {
      ...p.patch,
      updatedBy: msg.actorId,
    } as Parameters<typeof repo.updateByVersion>[4]);
    // Optimistic-lock loss: the command is a no-op, no event, no audit.
    if (!applied) return;
    metricKey = typeof p.patch.metricKey === "string" ? p.patch.metricKey : "";
    await emit(tx, msg, EVENTS.metricDefinitionUpdated, {
      id: p.id,
      metricKey,
      patch: p.patch,
    });
    await audit(tx, msg, "metric_definition.update", p.id);
  });
  await invalidate(msg.tenantId, p.id, metricKey);
}

export async function handlePublishMetricDefinition(
  msg: CommandEnvelope<MetricTransitionPayload>,
): Promise<void> {
  const p = msg.payload;
  const at = new Date();
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const applied = await repo.updateByVersion(tx, p.id, msg.tenantId, p.version, {
      ...statusTransitionPatch("published", at),
      updatedBy: msg.actorId,
    });
    if (!applied) return;
    await emit(tx, msg, EVENTS.metricDefinitionPublished, {
      id: p.id,
      metricKey: p.metricKey,
      publishedAt: at.toISOString(),
    });
    await audit(tx, msg, "metric_definition.publish", p.id);
  });
  await invalidate(msg.tenantId, p.id, p.metricKey);
}

export async function handleDeprecateMetricDefinition(
  msg: CommandEnvelope<MetricTransitionPayload>,
): Promise<void> {
  const p = msg.payload;
  const at = new Date();
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const applied = await repo.updateByVersion(tx, p.id, msg.tenantId, p.version, {
      ...statusTransitionPatch("deprecated", at),
      updatedBy: msg.actorId,
    });
    if (!applied) return;
    await emit(tx, msg, EVENTS.metricDefinitionDeprecated, {
      id: p.id,
      metricKey: p.metricKey,
      deprecatedAt: at.toISOString(),
    });
    await audit(tx, msg, "metric_definition.deprecate", p.id);
  });
  await invalidate(msg.tenantId, p.id, p.metricKey);
}

/**
 * RLS (#146): tenantScoped puts every handler inside the message's tenant context
 * so the FORCE ROW LEVEL SECURITY policy sees a populated app.tenant_id GUC.
 */
export function registerMetricConsumers(queue: Queue): void {
  const scoped = tenantScoped(queue);
  scoped.subscribe<MetricDefinitionCommandPayload>(
    COMMANDS.createMetricDefinition,
    handleCreateMetricDefinition,
  );
  scoped.subscribe<MetricDefinitionCommandPayload>(
    COMMANDS.versionMetricDefinition,
    handleVersionMetricDefinition,
  );
  scoped.subscribe<MetricUpdatePayload>(
    COMMANDS.updateMetricDefinition,
    handleUpdateMetricDefinition,
  );
  scoped.subscribe<MetricTransitionPayload>(
    COMMANDS.publishMetricDefinition,
    handlePublishMetricDefinition,
  );
  scoped.subscribe<MetricTransitionPayload>(
    COMMANDS.deprecateMetricDefinition,
    handleDeprecateMetricDefinition,
  );
}
