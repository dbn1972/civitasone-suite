import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { assertJournalBalances } from "./domain.js";
import type { PostJournalBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * DOM-024 R11 — maker-checker gate for MANUAL journal entries. This no
 * longer posts: it records the request as `pending_approval` (created_by =
 * this maker) via finance.gl.create — see gl/consumer.ts. A distinct
 * checker must call approveJournal() (PATCH .../:id/approve) to actually
 * post it. Automated/system-generated journals (gl/spine.ts) are unaffected
 * — they still publish finance.gl.post directly and post in one step.
 */
export async function createJournal(ctx: RequestContext, body: PostJournalBody): Promise<Accepted> {
  assertJournalBalances(body.lines);
  // EVT-4: stable id from the client idempotency key → double-submit dedupes.
  const id = idempotentId(ctx);
  await queue.publish(COMMANDS.journalCreate, {
    messageId: id, type: COMMANDS.journalCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * DOM-024 R11 — maker-checker approval of a manual journal entry by a
 * checker (an officer other than the drafter). The SoD check (approver ≠
 * maker) is enforced in the consumer inside the write transaction — see
 * gl/consumer.ts's finance.gl.approve handler (assertDistinctMakerChecker,
 * the same payments/domain.js function journalReverse already uses). On
 * approval the journal becomes `posted`: double-entry ledger lines, the
 * budget check, and period-close gating all run at THIS point, not at
 * draft-creation time.
 */
export async function approveJournal(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.journalApprove, {
    type: COMMANDS.journalApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reverseJournal(ctx: RequestContext, journalId: string): Promise<Accepted> {
  // Deterministic message + reversing-journal id keyed off the source journal,
  // so a double-submit / redelivery cannot create two mirror journals.
  // BUG FIX (accounting-critical #4): tenantId must be passed here too — see
  // idempotentId's doc comment (@civitasone/auth). Without it, a caller
  // supplying (or guessing) another tenant's journalId in :id would derive
  // the SAME messageId that tenant's own reversal of it would/will use,
  // silently discarding whichever reversal the consumer processed second.
  const id = idempotentId({ idempotencyKey: `reverse:${journalId}`, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.journalReverse, {
    messageId: id, type: COMMANDS.journalReverse,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, originalJournalId: journalId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
