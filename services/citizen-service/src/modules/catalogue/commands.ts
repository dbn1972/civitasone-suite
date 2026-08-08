import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertDefinitionPublishable } from "./domain.js";
import type { CreateDefinitionBody, UpdateDefinitionBody } from "./validators.js";
import { assertLatestTestPassed } from "../sandbox-test/commands.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(
  ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}

/** Create a new DRAFT service definition at the next version for the service_key. */
export async function createDefinition(ctx: RequestContext, body: CreateDefinitionBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(ctx, COMMANDS.catalogueDefinitionCreate, id, { id, ...body });
}

/** Patch a DRAFT service definition (B1 catalogue fields, FN-01). */
export async function updateDefinition(ctx: RequestContext, id: string, body: UpdateDefinitionBody): Promise<Accepted> {
  const def = await repo.findDefinitionById(id, ctx.tenantId);
  if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
  if (def.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be edited");
  const accepted = await publish(ctx, COMMANDS.catalogueDefinitionUpdate, randomUUID(), { id, ...body });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "catalogue", id));
  return { ...accepted, id };
}

function ensurePublishable(def: Parameters<typeof assertDefinitionPublishable>[0]): void {
  try {
    assertDefinitionPublishable(def);
  } catch (err) {
    const code = err instanceof Error ? err.message : "INVALID_DEFINITION";
    if (code === "DEF_MISSING_HOA") {
      throw new HttpError(422, code, "fee-bearing services require an HOA code before submit/publish");
    }
    throw new HttpError(422, code, "service definition is not publishable");
  }
}

/** Maker step — record the submitter requesting publication (does NOT publish). */
export async function submitDefinition(ctx: RequestContext, id: string): Promise<Accepted> {
  const def = await repo.findDefinitionById(id, ctx.tenantId);
  if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
  if (def.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be submitted");
  ensurePublishable(def);
  await assertLatestTestPassed(ctx, id);
  const accepted = await publish(ctx, COMMANDS.catalogueDefinitionSubmit, randomUUID(), { id });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "catalogue", id));
  return { ...accepted, id };
}

/** Checker step — publish (maker-checker: publisher MUST differ from submitter). */
export async function publishDefinition(ctx: RequestContext, id: string): Promise<Accepted> {
  const def = await repo.findDefinitionById(id, ctx.tenantId);
  if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
  if (def.status === "published") throw new HttpError(409, "ALREADY_PUBLISHED", "definition is immutable once published");
  if (def.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be published");
  if (!def.submittedBy) throw new HttpError(409, "NOT_SUBMITTED", "definition must be submitted before publish");
  if (def.submittedBy === ctx.actorId) {
    throw new HttpError(403, "MAKER_CHECKER", "publisher must differ from the submitter");
  }
  ensurePublishable(def);
  const accepted = await publish(ctx, COMMANDS.catalogueDefinitionPublish, randomUUID(), { id });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "catalogue", id));
  return { ...accepted, id };
}

/** Checker step — reject a submitted draft (clears submitter, stays draft). */
export async function rejectDefinition(ctx: RequestContext, id: string, comment: string): Promise<Accepted> {
  const def = await repo.findDefinitionById(id, ctx.tenantId);
  if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
  if (def.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be rejected");
  if (!def.submittedBy) throw new HttpError(409, "NOT_SUBMITTED", "definition must be submitted before reject");
  if (def.submittedBy === ctx.actorId) {
    throw new HttpError(403, "MAKER_CHECKER", "rejector must differ from the submitter");
  }
  const trimmed = comment.trim();
  if (trimmed.length === 0) throw new HttpError(400, "COMMENT_REQUIRED", "rejection comment is mandatory");
  const accepted = await publish(ctx, COMMANDS.catalogueDefinitionReject, randomUUID(), { id, comment: trimmed });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "catalogue", id));
  return { ...accepted, id };
}
