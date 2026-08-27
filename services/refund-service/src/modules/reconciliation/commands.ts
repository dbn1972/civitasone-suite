import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function initiateDisbursement(
  ctx: RequestContext,
  requestId: string,
  bankAccountDetails: { accountNumber: string; ifscCode: string; accountHolderName: string; bankName?: string | undefined },
  disbursedAmountMinor: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.initiateDisbursement, id, {
    id,
    requestId,
    bankAccountDetails,
    disbursedAmountMinor,
  });
}

export async function completeDisbursement(ctx: RequestContext, id: string, disbursementRef: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.completeDisbursement, id, { id, disbursementRef });
}

export async function failDisbursement(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.failDisbursement, id, { id, reason });
}

export async function reconcile(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.reconcile, id, { id });
}
