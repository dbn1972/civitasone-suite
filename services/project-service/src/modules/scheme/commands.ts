import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { CreateSchemeBody, CreateComponentBody, CreateFundReleaseBody, DisburseBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createScheme(ctx: RequestContext, body: CreateSchemeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.schemeCreate, {
    messageId: id, type: COMMANDS.schemeCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createComponent(ctx: RequestContext, schemeId: string, body: CreateComponentBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.schemeComponentCreate, {
    messageId: id, type: COMMANDS.schemeComponentCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, schemeId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createFundRelease(ctx: RequestContext, schemeId: string, body: CreateFundReleaseBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.fundReleaseCreate, {
    messageId: id, type: COMMANDS.fundReleaseCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, schemeId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function disburseFundRelease(ctx: RequestContext, schemeId: string, rId: string, body: DisburseBody): Promise<Accepted> {
  // GAP2-PROJECTS-FUND-RELEASES-07: separation of duties — the actor who
  // created the fund release may not disburse it. Enforced here synchronously
  // (returns 403 SOD_VIOLATION before any command is published) and again in
  // the consumer transaction as defence in depth. Mirrors grant-service's
  // submitDisbursementForApproval SoD guard.
  const release = await repo.findFundReleaseById(rId, ctx.tenantId);
  if (!release) throw new HttpError(404, "NOT_FOUND", "fund release not found");
  if (release.createdBy && release.createdBy === ctx.actorId) {
    throw new HttpError(403, "SOD_VIOLATION", "the actor who created a fund release may not disburse it (separation of duties)");
  }
  await queue.publish(COMMANDS.fundReleaseDisburse, {
    messageId: randomUUID(), type: COMMANDS.fundReleaseDisburse,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { rId, tenantId: ctx.tenantId, schemeId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "scheme", schemeId));
  return { id: rId, status: "accepted", correlationId: ctx.correlationId };
}
