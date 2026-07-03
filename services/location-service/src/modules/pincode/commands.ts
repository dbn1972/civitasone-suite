import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { BulkImportBody } from "./validators.js";

export type BulkAccepted = { batchId: string; count: number; status: string; correlationId: string };

export async function pincodeBulkImport(ctx: RequestContext, body: BulkImportBody): Promise<BulkAccepted> {
  const batchId = randomUUID();

  await queue.publish(COMMANDS.pincodeBulkImport, {
    messageId: batchId,
    type: COMMANDS.pincodeBulkImport,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { batchId, records: body.records },
  });

  return { batchId, count: body.records.length, status: "accepted", correlationId: ctx.correlationId };
}
