/**
 * queries consumer — the ONLY code that writes query/scheduled/export tables
 * and the place where user queries actually execute.
 *
 * SAFETY: the query is built by the whitelisted registry builder and run with a
 * mandatory tenant predicate. The spec is re-validated at this consume boundary
 * (defence in depth) before it ever reaches the builder. A bad spec produces a
 * recorded 'failed' run — never a crash and never raw SQL.
 *
 * Idempotent via inbox markProcessed; events + audit flow through the outbox.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, AUDIT_TOPIC, QUERY_RESOURCE, SCHEDULED_RESOURCE, EXPORT_RESOURCE } from "../../topics.js";
import { querySpecSchema } from "../registry/spec.js";
import { runAggregateQuery } from "../registry/builder.js";
import * as repo from "./repo.js";
import type { QueryRunView } from "./schema.js";

type Tx = Parameters<typeof enqueue>[0];

async function audit(
  tx: Tx,
  msg: CommandEnvelope,
  action: string,
  resourceType: string,
  resourceId: string,
  outcome: "success" | "failure",
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "analytics", action, resourceType, resourceId, outcome },
  });
}

async function emit(tx: Tx, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>): Promise<void> {
  await enqueue(tx, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
}

export function registerQueriesConsumers(queue: Queue): void {
  queue.subscribe<QueryRunView>(COMMANDS.runQuery, async (msg) => {
    const p = msg.payload;

    // Execute the read OUTSIDE the write tx. Validation/registry errors are
    // deterministic, so we capture them and record a 'failed' run rather than
    // throwing (which would loop on redelivery).
    let result: Record<string, unknown> | null = null;
    let resultRows = 0;
    let error: string | null = null;
    try {
      const spec = querySpecSchema.parse(p.spec);
      const res = await runAggregateQuery(db, msg.tenantId, spec); // tenant-scoped, parameterised
      result = res as unknown as Record<string, unknown>;
      resultRows = res.rowCount;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        dashboardId: p.dashboardId,
        queryName: p.queryName,
        status: "running",
        kind: "adhoc",
        spec: p.spec,
        resultRows: 0,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      if (error) {
        await repo.fail(tx, p.id, error, msg.actorId);
        await emit(tx, msg, EVENTS.queryFailed, { queryRunId: p.id, error });
        await audit(tx, msg, "run", "query_run", p.id, "failure");
      } else {
        await repo.complete(tx, p.id, resultRows, result ?? {}, msg.actorId);
        await emit(tx, msg, EVENTS.queryRun, { queryRunId: p.id, queryName: p.queryName, resultRows });
        await audit(tx, msg, "run", "query_run", p.id, "success");
      }
    });

    const finalView: QueryRunView = {
      ...p,
      status: error ? "failed" : "completed",
      result: error ? null : (result as Record<string, unknown>),
      resultRows,
      error,
    };
    await cache.put(cache.makeKey(msg.tenantId, QUERY_RESOURCE, p.id), finalView);
    await cache.invalidateResource(msg.tenantId, QUERY_RESOURCE);
  });

  queue.subscribe<Record<string, unknown>>(COMMANDS.scheduleQuery, async (msg) => {
    const p = msg.payload as { id: string; name: string; spec: Record<string, unknown>; cadence: string; enabled: boolean };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertScheduled(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        name: p.name,
        spec: p.spec,
        cadence: p.cadence,
        enabled: p.enabled,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.scheduledCreated, { scheduledId: p.id, name: p.name });
      await audit(tx, msg, "schedule", "scheduled_query", p.id, "success");
    });
    await cache.invalidateResource(msg.tenantId, SCHEDULED_RESOURCE);
  });

  queue.subscribe<Record<string, unknown>>(COMMANDS.createExport, async (msg) => {
    const p = msg.payload as { id: string; queryRunId: string; format: string };
    // Resolve row count from the source run (tenant-scoped) for the artifact.
    const run = await repo.findById(p.queryRunId, msg.tenantId);
    const rowCount = run?.resultRows ?? 0;
    const downloadUrl = `/v1/analytics/exports/${p.id}/download`;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertExport(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        queryRunId: run ? p.queryRunId : null,
        format: p.format,
        status: "queued",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await repo.completeExport(tx, p.id, rowCount, downloadUrl, msg.actorId);
      await emit(tx, msg, EVENTS.exportCreated, { exportId: p.id, queryRunId: p.queryRunId, rowCount });
      await audit(tx, msg, "export", "export_job", p.id, "success");
    });
    await cache.invalidateResource(msg.tenantId, EXPORT_RESOURCE);
  });
}
