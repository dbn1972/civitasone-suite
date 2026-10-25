import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { allocateModuleFileNo } from "../../shared/numbers.js";
import { COMMANDS } from "../../topics.js";
import type { FileFromModuleBody } from "./validators.js";

export type Accepted = { id: string; fileNo: string; status: string; correlationId: string };


/**
 * Any module raises an eFile for formal approval.
 * Creates the file with source linkage, adds the proposal noting,
 * and immediately submits it for workflow approval.
 */
export async function raiseFileFromModule(
  ctx: RequestContext,
  body: FileFromModuleBody & { initiatedBy: string },
): Promise<Accepted> {
  const id = randomUUID();
  // The file number is part of the 202 body (the web UI shows it), so it is drawn from a Postgres SEQUENCE here
  // rather than in the consumer. A sequence value is unique by construction and a replayed command carries its
  // own number, so a retry can never collide (unlike the old random 4-digit suffix).
  const fileNo = await allocateModuleFileNo(body.refType);

  await queue.publish(COMMANDS.fileFromModule, {
    messageId: id,
    type: COMMANDS.fileFromModule,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      fileNo,
      subject: body.subject,
      dept: body.dept,
      classification: body.classification,
      priority: body.priority,
      currentWith: body.currentWith,
      sourceRefType: body.refType,
      sourceRefId: body.refId,
      initiatedBy: body.initiatedBy,
      approvalChain: body.approvalChain,
      initialNote: body.initialNote,
      sourceContext: body.context ?? {},
    },
  });

  return { id, fileNo, status: "accepted", correlationId: ctx.correlationId };
}
