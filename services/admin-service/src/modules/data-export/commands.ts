/**
 * Data export command handlers (WRITE PATH).
 * Route → validate → publish command → return 202.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface ExportRequestPayload {
  type: "full" | "module" | "entity";
  moduleFilter?: string;
  format: "csv" | "json" | "pdf";
}

const COMMAND_REQUEST = "admin.data_export.request";
const COMMAND_PROCESS = "admin.data_export.process";

export async function exportRequest(ctx: RequestContext, payload: ExportRequestPayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMAND_REQUEST, {
    messageId: id,
    type: COMMAND_REQUEST,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      requestedBy: ctx.actorId,
      type: payload.type,
      moduleFilter: payload.moduleFilter ?? null,
      format: payload.format,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function exportProcess(ctx: RequestContext, exportId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMAND_PROCESS, {
    messageId: id,
    type: COMMAND_PROCESS,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { exportId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
