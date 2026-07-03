/**
 * Setting command handlers (WRITE PATH).
 * Validate → publish command → return 202. Consumer does the durable DB write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { SettingUpsertBody, SettingDeleteBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "setting";

export async function settingUpsert(ctx: RequestContext, body: SettingUpsertBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.settingUpsert, {
    messageId: id,
    type: COMMANDS.settingUpsert,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, key: body.key, value: body.value },
  });
  // Invalidate cached value for key
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, body.key));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function settingDelete(ctx: RequestContext, body: SettingDeleteBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.settingDelete, {
    messageId: id,
    type: COMMANDS.settingDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, key: body.key },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, body.key));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
