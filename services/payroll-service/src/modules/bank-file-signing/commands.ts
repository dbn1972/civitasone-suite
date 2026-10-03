import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { BankFileSigningConfig } from "./types.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface UpdateBankFileSigningBody extends BankFileSigningConfig {
  /** Operator-stated reason, recorded on the audit event. */
  reason?: string | null;
}

export async function updateBankFileSigning(ctx: RequestContext, body: UpdateBankFileSigningBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.bankFileSigningUpdate, {
    messageId: id,
    type: COMMANDS.bankFileSigningUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
