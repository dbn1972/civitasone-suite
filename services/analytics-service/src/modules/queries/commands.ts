import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, QUERY_RESOURCE } from "../../topics.js";
import type { RunQueryBody } from "./validators.js";
import type { QueryRunView } from "./schema.js";
export type Accepted = { id: string; status: string; correlationId: string };
export async function runQuery(ctx: RequestContext, body: RunQueryBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: QueryRunView = {
    id,
    tenantId: ctx.tenantId,
    dashboardId: body.dashboardId ?? null,
    queryName: body.queryName,
    status: "running",
    resultRows: 0,
    version: 1,
  };
  await cache.put(cache.makeKey(ctx.tenantId, QUERY_RESOURCE, id), projected);
  await queue.publish(COMMANDS.runQuery, {
    messageId: id,
    type: COMMANDS.runQuery,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
