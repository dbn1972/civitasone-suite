import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { RegisterMigrationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function registerMigration(ctx: RequestContext, body: RegisterMigrationBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.migrationRegister, {
    messageId: id, type: COMMANDS.migrationRegister,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function linkMigration(ctx: RequestContext, id: string, efileId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.migrationLink, {
    messageId: randomUUID(), type: COMMANDS.migrationLink,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, efileId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
