import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { assertValidFY } from "./domain.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import type { CreateBudgetBody, ReappropriateBody, CreateSanctionBody, UpdateHeadHoABody, RejectSanctionBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createBudget(ctx: RequestContext, body: CreateBudgetBody): Promise<Accepted> {
  assertValidFY(body.fy);
  const id = randomUUID();
  await queue.publish(COMMANDS.budgetCreate, {
    messageId: id, type: COMMANDS.budgetCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reappropriateBudget(ctx: RequestContext, id: string, body: ReappropriateBody): Promise<Accepted> {
  await queue.publish(COMMANDS.budgetReappropriate, {
    type: COMMANDS.budgetReappropriate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "budget", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createSanction(ctx: RequestContext, body: CreateSanctionBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.sanctionCreate, {
    messageId: id, type: COMMANDS.sanctionCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateHeadHoA(ctx: RequestContext, id: string, body: UpdateHeadHoABody): Promise<void> {
  const head = await repo.findHeadById(id);
  if (!head || head.tenantId !== ctx.tenantId) throw new Error("head not found");
  await repo.updateHead(db, id, { hoaCode: body.hoaCode, updatedBy: ctx.actorId });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "accounts", "list:50"));
}

export async function rejectSanction(ctx: RequestContext, id: string, body: RejectSanctionBody): Promise<Accepted> {
  await queue.publish(COMMANDS.sanctionReject, {
    type: COMMANDS.sanctionReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "sanction", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * H1 — mark a sanction as submitted to eOffice for administrative approval.
 * The eFile itself is raised via the eOffice integration; once it is approved
 * the `finance.sanction.file_decided` callback (see eoffice-consumer) moves the
 * sanction to `approved`. This transition makes the source state honest while
 * the file is under approval.
 */
export async function submitSanctionForApproval(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.sanctionSubmitApproval, {
    type: COMMANDS.sanctionSubmitApproval,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "sanction", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
