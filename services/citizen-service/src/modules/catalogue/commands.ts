import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertDefinitionPublishable } from "./domain.js";
import type { CreateDefinitionBody } from "./validators.js";

async function audit(tx: Parameters<typeof enqueue>[0], ctx: RequestContext, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "citizen", action, resourceType: "service_definition", resourceId, outcome: "success" },
  });
}

/** Create a new DRAFT service definition at the next version for the service_key. */
export async function createDefinition(ctx: RequestContext, body: CreateDefinitionBody): Promise<{ id: string; version: number; status: string }> {
  const id = randomUUID();
  const version = await db.transaction(async (tx) => {
    const next = (await repo.latestVersionForKey(tx, ctx.tenantId, body.serviceKey)) + 1;
    await repo.insertDefinition(tx, {
      id, tenantId: ctx.tenantId, serviceKey: body.serviceKey,
      serviceId: body.serviceId ?? null, name: body.name,
      ownerDepartment: body.ownerDepartment ?? null,
      version: next, status: "draft",
      eligibilityRuleSetId: body.eligibilityRuleSetId ?? null,
      feeScheduleId: body.feeScheduleId ?? null,
      issuanceType: body.issuanceType ?? null,
      requiredDocuments: body.requiredDocuments,
      slaDays: body.slaDays ?? null,
      channels: body.channels, forms: body.forms, outputs: body.outputs,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "definition_create", id);
    return next;
  });
  return { id, version, status: "draft" };
}

/** Maker step — record the submitter requesting publication (does NOT publish). */
export async function submitDefinition(ctx: RequestContext, id: string): Promise<{ id: string; status: string }> {
  return db.transaction(async (tx) => {
    const def = await repo.findDefinitionByIdTx(tx, id, ctx.tenantId);
    if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
    if (def.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be submitted");
    assertDefinitionPublishable(def);
    await repo.updateDefinition(tx, id, ctx.tenantId, { submittedBy: ctx.actorId, updatedBy: ctx.actorId });
    await audit(tx, ctx, "definition_submit", id);
    return { id, status: "submitted" };
  });
}

/**
 * Checker step — publish (maker-checker: publisher MUST differ from submitter).
 * Publishing freezes the definition (immutable, versioned). Emits a domain event.
 */
export async function publishDefinition(ctx: RequestContext, id: string): Promise<{ id: string; status: string; version: number }> {
  return db.transaction(async (tx) => {
    const def = await repo.findDefinitionByIdTx(tx, id, ctx.tenantId);
    if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
    if (def.status === "published") throw new HttpError(409, "ALREADY_PUBLISHED", "definition is immutable once published");
    if (def.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be published");
    if (!def.submittedBy) throw new HttpError(409, "NOT_SUBMITTED", "definition must be submitted before publish");
    if (def.submittedBy === ctx.actorId) {
      throw new HttpError(403, "MAKER_CHECKER", "publisher must differ from the submitter");
    }
    assertDefinitionPublishable(def);
    await repo.updateDefinition(tx, id, ctx.tenantId, {
      status: "published", publishedBy: ctx.actorId, publishedAt: new Date(), updatedBy: ctx.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.serviceDefinitionPublished, eventType: EVENTS.serviceDefinitionPublished,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { id, serviceKey: def.serviceKey, version: def.version, serviceId: def.serviceId },
    });
    await audit(tx, ctx, "definition_publish", id);
    return { id, status: "published", version: def.version };
  });
}
