import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./reconcile-repo.js";
import { isIntegrationConfigured } from "./integration-adapter.js";
import type { Provider } from "./reconcile-domain.js";
import type { ExchangeBody } from "./reconcile-validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * Create an outbound integration ref and schedule the exchange.
 * Honest not-configured fallback: if the provider is not configured we throw
 * 503 INTEGRATION_NOT_CONFIGURED — no ref is created and no fake success is
 * returned to the caller.
 */
export async function exchange(ctx: RequestContext, body: ExchangeBody): Promise<Accepted> {
  if (!isIntegrationConfigured(body.provider)) {
    throw new HttpError(503, "INTEGRATION_NOT_CONFIGURED", `${body.provider} integration is not configured`);
  }
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await repo.insertRef(tx, {
      id, tenantId: ctx.tenantId, provider: body.provider, entityType: body.entityType,
      entityId: body.entityId, direction: "outbound", status: "pending", attempts: 0,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
  });
  await queue.publish(COMMANDS.gemExchange, {
    messageId: id, type: COMMANDS.gemExchange,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, provider: body.provider, entityType: body.entityType, entityId: body.entityId, payload: body.payload ?? {} },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reconcileRef(ctx: RequestContext, id: string): Promise<Accepted> {
  const ref = await repo.findRefById(id, ctx.tenantId);
  if (!ref) throw new HttpError(404, "NOT_FOUND", "integration ref not found");
  if (!isIntegrationConfigured(ref.provider as Provider)) {
    throw new HttpError(503, "INTEGRATION_NOT_CONFIGURED", `${ref.provider} integration is not configured`);
  }
  await queue.publish(COMMANDS.gemReconcile, {
    messageId: randomUUID(), type: COMMANDS.gemReconcile,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
