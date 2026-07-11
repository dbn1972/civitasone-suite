import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deriveCauseListId, deriveItemId } from "./domain.js";
import {
  createCauseListBody, type CreateCauseListBody,
  listCaseBody, type ListCaseBody,
} from "./validators.js";

export type CreateCauseListResult = { accepted: true; causeListId: string };
export type ListCaseResult = { accepted: true; itemId: string };

/** Generate (materialize) a cause-list for a court/day (§17). Idempotent per (court + date). */
export async function createCauseList(
  ctx: RequestContext, input: CreateCauseListBody,
): Promise<CreateCauseListResult> {
  const body = createCauseListBody.parse(input);
  const causeListId = deriveCauseListId(ctx.tenantId, body.courtId, body.listDate);

  await queue.publish(COMMANDS.generateCauseList, {
    messageId: causeListId,
    type: COMMANDS.generateCauseList,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: causeListId, tenantId: ctx.tenantId },
  });

  return { accepted: true, causeListId };
}

/** List a case onto a slot/courtroom of a cause-list (§17). Idempotent per (list + case). */
export async function listCaseOnCauseList(
  ctx: RequestContext, causeListId: string, input: ListCaseBody,
): Promise<ListCaseResult> {
  const body = listCaseBody.parse(input);
  const itemId = deriveItemId(ctx.tenantId, causeListId, body.caseId);

  await queue.publish(COMMANDS.listCaseOnCauseList, {
    messageId: itemId,
    type: COMMANDS.listCaseOnCauseList,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: itemId, causeListId, tenantId: ctx.tenantId },
  });

  return { accepted: true, itemId };
}
