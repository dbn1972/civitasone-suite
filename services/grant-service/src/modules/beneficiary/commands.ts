import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { maskAadhaar } from "./domain.js";
import type { CreateBeneficiaryBody, LinkBankBody, SeedAadhaarBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createBeneficiary(ctx: RequestContext, body: CreateBeneficiaryBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.beneficiaryCreate, {
    messageId: id, type: COMMANDS.beneficiaryCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function linkBank(ctx: RequestContext, beneficiaryId: string, body: LinkBankBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.beneficiaryLinkBank, {
    messageId: id, type: COMMANDS.beneficiaryLinkBank,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, beneficiaryId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "beneficiary", beneficiaryId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function seedAadhaar(ctx: RequestContext, beneficiaryId: string, body: SeedAadhaarBody): Promise<Accepted> {
  const id = randomUUID();
  // P1-3 DPDP: mask Aadhaar at the COMMAND boundary. Raw Aadhaar is converted to
  // (last4, HMAC token) here and NEVER placed on the queue payload.
  const { last4, token } = maskAadhaar(body.aadhaar);
  await queue.publish(COMMANDS.beneficiarySeedAadhaar, {
    messageId: id, type: COMMANDS.beneficiarySeedAadhaar,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, beneficiaryId, aadhaarLast4: last4, aadhaarToken: token, bankAccountId: body.bankAccountId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
