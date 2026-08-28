import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import { getCaseById } from "../case-registry/repo.js";
import { COMMANDS } from "../../topics.js";
import { deriveCauseListId, deriveItemId } from "./domain.js";
import * as repo from "./repo.js";
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

/**
 * List a case onto a slot/courtroom of a cause-list (§17). Idempotent per
 * (list + case) — the deterministic itemId means a repeat of the SAME
 * (causeListId, caseId, slot, courtroom, itemNumber) is a genuine no-op retry.
 *
 * Synchronous pre-checks run BEFORE publish so the caller gets an honest
 * answer immediately instead of a 202 that silently fails or no-ops downstream:
 *
 *   1. The case must exist (otherwise the consumer's insert would hit the
 *      `cause_list_items_case_id_fkey` FK violation asynchronously — 404).
 *   2. The target cause-list must exist (otherwise the consumer would hit its
 *      own `CAUSELIST_NOT_FOUND` asynchronously — 404 here instead).
 *   3. A resubmission of the SAME (causeListId, caseId) with DIFFERENT
 *      slot/courtroom/itemNumber is an edit attempt, which isn't supported —
 *      reject it (409) rather than silently leaving the original untouched
 *      while claiming success. An IDENTICAL resubmission falls through as the
 *      idempotent no-op it already correctly is.
 *   4. Any OTHER item — same or different case, same or different cause-list —
 *      already occupying the same (listDate, slot, courtroom) is a
 *      double-booking (otherwise the consumer's insert would hit the
 *      `cause_list_items_no_double_booking` EXCLUDE constraint asynchronously
 *      — 409 here instead). That constraint has no case_id dimension — a
 *      courtroom can't be double-booked even by the SAME case via a different
 *      cause-list — so neither does this check; it only runs once check 3
 *      confirms this is a genuinely new (causeListId, caseId) pair, so there's
 *      no pre-existing row of "its own" for it to false-positive against. The
 *      DB constraint remains the authoritative backstop for the rare
 *      concurrent-race case this pre-check can't see.
 *
 * Known accepted race (mirrors check 4's DB backstop, not closed here): two
 * near-simultaneous resubmissions of the SAME (causeListId, caseId) with
 * DIFFERENT slots can both read "no existing item" (check 3) before either
 * has written, publish under the same deterministic itemId, and have the
 * consumer's `markProcessed` dedupe silently drop whichever loses the race —
 * with no error surfaced for that one. Same narrow, sub-request window as the
 * slot-conflict race already accepted above; not chased further here.
 */
export async function listCaseOnCauseList(
  ctx: RequestContext, causeListId: string, input: ListCaseBody,
): Promise<ListCaseResult> {
  const body = listCaseBody.parse(input);
  const itemId = deriveItemId(ctx.tenantId, causeListId, body.caseId);

  // Independent reads — run concurrently rather than sequentially.
  const [kase, existing] = await Promise.all([
    getCaseById(ctx.tenantId, body.caseId),
    repo.getItemById(ctx.tenantId, itemId),
  ]);
  if (!kase) {
    throw new HttpError(404, "CASE_NOT_FOUND", `Case not found: ${body.caseId}`);
  }

  if (existing) {
    const identical =
      existing.slot === body.slot &&
      existing.courtroom === body.courtroom &&
      existing.itemNumber === body.itemNumber;
    if (!identical) {
      throw new HttpError(
        409,
        "CAUSELIST_ITEM_ALREADY_LISTED",
        "This case is already listed on this cause-list; editing an existing listing is not yet supported",
      );
    }
    // Identical resubmission: fall through to publish as the idempotent no-op
    // it already is (markProcessed dedupe on the consumer side).
  } else {
    // Only a genuinely NEW (causeListId, caseId) pair needs the parent/slot
    // checks below — a resubmission (handled above) can't newly collide.
    const parent = await repo.getCauseList(ctx.tenantId, causeListId);
    if (!parent) {
      throw new HttpError(404, "CAUSELIST_NOT_FOUND", `Cause-list not found: ${causeListId}`);
    }
    const conflict = await repo.findSlotConflict(ctx.tenantId, parent.listDate, body.slot, body.courtroom);
    if (conflict) {
      throw new HttpError(
        409,
        "CAUSELIST_SLOT_CONFLICT",
        `Courtroom ${body.courtroom} slot ${body.slot} is already booked on ${parent.listDate}`,
      );
    }
  }

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
