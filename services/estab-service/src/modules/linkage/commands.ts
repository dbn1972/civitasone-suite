import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { FileFromModuleBody } from "./validators.js";

export type Accepted = { id: string; fileNo: string; status: string; correlationId: string };

function nextFileNo(refType: string): string {
  const year = new Date().getFullYear();
  const prefix = refType.split("_")[0]?.toUpperCase().slice(0, 3) ?? "GEN";
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `${prefix}/${year}/${seq}`;
}

/**
 * Any module raises an eFile for formal approval.
 * Creates the file with source linkage, adds the proposal noting,
 * and immediately submits it for workflow approval.
 */
export async function raiseFileFromModule(
  ctx: RequestContext,
  body: FileFromModuleBody,
): Promise<Accepted> {
  const id = randomUUID();
  const fileNo = nextFileNo(body.refType);

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
