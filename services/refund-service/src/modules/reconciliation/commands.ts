import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import { encryptPii, isEncrypted } from "../../shared/pii-crypto.js";

export type { Accepted };

export async function initiateDisbursement(
  ctx: RequestContext,
  requestId: string,
  bankAccountDetails: { accountNumber: string; ifscCode: string; accountHolderName: string; bankName?: string | undefined },
  disbursedAmountMinor: string,
): Promise<Accepted> {
  const id = randomUUID();
  // SECURITY (UAT g3 #6): the account number is encrypted HERE, before it is
  // published, so neither the queue payload nor refund_disbursements.
  // bank_account_details ever holds it in cleartext.
  const sealed = {
    ...bankAccountDetails,
    accountNumber: isEncrypted(bankAccountDetails.accountNumber)
      ? bankAccountDetails.accountNumber
      : encryptPii(bankAccountDetails.accountNumber),
  };
  return publishCommand(ctx, COMMANDS.initiateDisbursement, id, {
    id,
    requestId,
    bankAccountDetails: sealed,
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
