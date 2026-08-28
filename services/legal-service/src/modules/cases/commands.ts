import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateCaseBody, DisposeCaseBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createCase(ctx: RequestContext, body: CreateCaseBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.caseCreate, {
    messageId: id, type: COMMANDS.caseCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, id, tenantId: ctx.tenantId },
  });
  await cache.put(cache.makeKey(ctx.tenantId, "case", id), { id, ...body, status: "pending" });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function disposeCase(ctx: RequestContext, caseId: string, body: DisposeCaseBody): Promise<Accepted> {
  await queue.publish(COMMANDS.caseDispose, {
    // Unlike createCase above, this had no messageId at all -- envelope()
    // defaults to a fresh random UUID per publish (bus.ts), so the
    // consumer's markProcessed() dedup could never recognize a retried
    // dispose as a duplicate: a client retry after a timeout would reach
    // assertCanDispose() a second time and throw INVALID_STATUS (already
    // disposed) instead of being idempotently absorbed as a no-op. A case
    // can only ever be meaningfully disposed once (no "reopen" action
    // exists in the domain model), so the case id itself is a safe,
    // deterministic dedup key for this specific command.
    messageId: caseId,
    type: COMMANDS.caseDispose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, caseId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "case", caseId));
  return { id: caseId, status: "accepted", correlationId: ctx.correlationId };
}
