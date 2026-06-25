/** queries command handlers (WRITE PATH) — publish command, prime cache. */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, QUERY_RESOURCE } from "../../topics.js";
import type { RunQueryBody, ScheduleQueryBody, CreateExportBody } from "./validators.js";
import type { QueryRunView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

function publish(ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>) {
  return queue.publish(type, {
    messageId: id,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
}

export async function runQuery(ctx: RequestContext, body: RunQueryBody): Promise<Accepted> {
  // Deterministic id from idempotency key (if supplied) so a double-submit dedupes.
  const id = ctx.idempotencyKey ?? randomUUID();
  const projected: QueryRunView = {
    id,
    tenantId: ctx.tenantId,
    dashboardId: body.dashboardId ?? null,
    queryName: body.queryName,
    status: "running",
    kind: "adhoc",
    spec: body.spec as unknown as Record<string, unknown>,
    result: null,
    resultRows: 0,
    error: null,
    version: 1,
  };
  await cache.put(cache.makeKey(ctx.tenantId, QUERY_RESOURCE, id), projected);
  await publish(ctx, COMMANDS.runQuery, id, { ...projected });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function scheduleQuery(ctx: RequestContext, body: ScheduleQueryBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.scheduleQuery, id, {
    id,
    name: body.name,
    spec: body.spec,
    cadence: body.cadence,
    enabled: body.enabled,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createExport(ctx: RequestContext, body: CreateExportBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.createExport, id, {
    id,
    queryRunId: body.queryRunId,
    format: body.format,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
