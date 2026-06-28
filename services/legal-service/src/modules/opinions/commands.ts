import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { SeekOpinionBody, DraftOpinionBody, IssueOpinionBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function seekOpinion(ctx: RequestContext, body: SeekOpinionBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.opinionSeek, {
    messageId: id, type: COMMANDS.opinionSeek,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.put(cache.makeKey(ctx.tenantId, "opinion", id), { id, ...body, status: "sought" });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function draftOpinion(ctx: RequestContext, opinionId: string, body: DraftOpinionBody): Promise<Accepted> {
  await queue.publish(COMMANDS.opinionDraft, {
    type: COMMANDS.opinionDraft,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { opinionId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "opinion", opinionId));
  return { id: opinionId, status: "accepted", correlationId: ctx.correlationId };
}

export async function issueOpinion(ctx: RequestContext, opinionId: string, body: IssueOpinionBody): Promise<Accepted> {
  await queue.publish(COMMANDS.opinionIssue, {
    type: COMMANDS.opinionIssue,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { opinionId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "opinion", opinionId));
  return { id: opinionId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Submit a legal opinion to eOffice for administrative approval. The eFile is
 * raised via the eOffice integration; once the approval chain concludes the
 * `legal.opinion.file_decided` callback (see eoffice-consumer) moves the opinion
 * to issued/rejected. This transition makes the source state honest while the
 * file is under approval.
 */
export async function submitOpinionForApproval(ctx: RequestContext, opinionId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.opinionSubmitApproval, {
    type: COMMANDS.opinionSubmitApproval,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { opinionId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "opinion", opinionId));
  return { id: opinionId, status: "accepted", correlationId: ctx.correlationId };
}
