/**
 * exports/commands.ts — Command publishing helpers for export jobs.
 *
 * Follows the existing pattern from queries/commands.ts.
 * Routes call createExport → command queued → ExportConsumer processes.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { ExportFormat } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface CreateExportBody {
  queryRunId: string;
  format: ExportFormat;
}

/**
 * Publish a createExport command to the analytics export queue.
 * Returns an accepted receipt (202 pattern).
 */
export async function createExport(ctx: RequestContext, body: CreateExportBody): Promise<Accepted> {
  const id = ctx.idempotencyKey ?? randomUUID();
  await queue.publish(COMMANDS.createExport, {
    messageId: id,
    type: COMMANDS.createExport,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      queryRunId: body.queryRunId,
      format: body.format,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
