import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateCpioBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** GAP-CITIZEN-RTI-03 — register a CPIO directory entry (officer-maintained). */
export async function createCpio(ctx: RequestContext, body: CreateCpioBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.cpioDirectoryCreate, {
    messageId: id, type: COMMANDS.cpioDirectoryCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
