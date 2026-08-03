import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
export type Accepted = { id: string; status: string; correlationId: string };
export async function upsertRoleMember(ctx: RequestContext, body: { roleRef: string; userId: string; reportsTo?: string; active: boolean }): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.upsertRoleMember, { messageId: id, type: COMMANDS.upsertRoleMember, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { ...body, id, tenantId: ctx.tenantId } });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
