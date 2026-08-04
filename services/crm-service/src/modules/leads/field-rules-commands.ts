/** Command publishers for configurable lead field rules (LM-001). */
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import type { UpsertLeadFieldRuleBody } from "./field-rules-validators.js";

export type Accepted = { id: string; status: string; correlationId: string };
const RESOURCE = "lead_field_rule";

export async function upsertLeadFieldRule(
  ctx: RequestContext,
  body: UpsertLeadFieldRuleBody,
): Promise<Accepted> {
  // Scoped per field so a client reusing one idempotency key across two different
  // fields does not collapse both configuration changes into a single command.
  const id = commandId(ctx, `${COMMANDS.upsertLeadFieldRule}:${body.fieldName}`);
  await queue.publish(COMMANDS.upsertLeadFieldRule, {
    messageId: id,
    type: COMMANDS.upsertLeadFieldRule,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      fieldName: body.fieldName,
      required: body.required,
      weight: body.weight ?? 0,
      enabled: body.enabled ?? true,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteLeadFieldRule(
  ctx: RequestContext,
  fieldName: string,
): Promise<Accepted> {
  const messageId = commandId(ctx, `${COMMANDS.deleteLeadFieldRule}:${fieldName}`);
  await queue.publish(COMMANDS.deleteLeadFieldRule, {
    messageId,
    type: COMMANDS.deleteLeadFieldRule,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, fieldName },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}
