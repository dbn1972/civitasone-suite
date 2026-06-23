import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { assertJournalBalances } from "./domain.js";
import type { PostJournalBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function postJournal(ctx: RequestContext, body: PostJournalBody): Promise<Accepted> {
  assertJournalBalances(body.lines);
  // EVT-4: stable id from the client idempotency key → double-submit dedupes.
  const id = idempotentId(ctx);
  await queue.publish(COMMANDS.journalPost, {
    messageId: id, type: COMMANDS.journalPost,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
