/**
 * Section 8 NF-1: inter-fund transfer and release-from-restriction as NEW maker-checker journals (design 2.2, 2.4).
 *
 * Both are manual journals of their own type (fund_transfer / fund_release): published as finance.gl.create (a
 * pending_approval draft, maker = this officer) and posted only when a DISTINCT checker approves it through the existing
 * PATCH /v1/finance/journals/:id/approve. All posting-time rules (per-fund balance, restricted-spend, release source/target,
 * FCRA boundary, fund row locks) run in gl/consumer.ts postJournal -> prepareFundPostingTx at approval, which is authoritative.
 */
import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { assertJournalBalances, assertJournalHasAmount } from "./domain.js";
import { buildFundRelease, buildInterFundTransfer, type FundMoveInput } from "./funds.js";
import type { Accepted } from "./commands.js";

export type FundMoveKind = "fund_transfer" | "fund_release";

export async function createFundMove(
  ctx: RequestContext, kind: FundMoveKind, input: FundMoveInput & { postingDate: string },
): Promise<Accepted> {
  const lines = kind === "fund_transfer" ? buildInterFundTransfer(input) : buildFundRelease(input);
  assertJournalBalances(lines);
  assertJournalHasAmount(lines);
  const id = idempotentId(ctx);
  await queue.publish(COMMANDS.journalCreate, {
    messageId: id, type: COMMANDS.journalCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, voucherNo: "AUTO", type: kind, postingDate: input.postingDate, lines, budgetOverride: false },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
