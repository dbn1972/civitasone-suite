import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { derivePartyId } from "./domain.js";
import { getPartyForPrecheck } from "./repo.js";
import { httpError } from "../../shared/context.js";
import {
  addPartyBody, type AddPartyBody,
  updateAdvocateBody, type UpdateAdvocateBody,
} from "./validators.js";

export type AddPartyResult = { accepted: true; partyId: string };
export type UpdateAdvocateResult = { accepted: true; partyId: string };

/**
 * Add a party (§14) or advocate (§15) to a case. Idempotent per
 * (case + role + seq). The cleartext PII travels inside the outbox command
 * payload (the existing pattern); it is encrypted at rest only when the consumer
 * writes it through the encryptedText columns — never pre-encrypted here.
 */
export async function addParty(
  ctx: RequestContext, caseId: string, input: AddPartyBody, seq = 0,
): Promise<AddPartyResult> {
  const body = addPartyBody.parse(input);
  // Prefer the caller-supplied ordinal; fall back to the seq arg (default 0).
  const effectiveSeq = body.partyIndex ?? seq;
  const partyId = derivePartyId(ctx.tenantId, caseId, body.partyRole, effectiveSeq);

  await queue.publish(COMMANDS.addParty, {
    messageId: partyId,
    type: COMMANDS.addParty,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: partyId, caseId, tenantId: ctx.tenantId },
  });

  return { accepted: true, partyId };
}

/** Update an advocate's details (§15). messageId is idempotent per (party + expectedVersion). */
export async function updateAdvocate(
  ctx: RequestContext, partyId: string, input: UpdateAdvocateBody,
): Promise<UpdateAdvocateResult> {
  const body = updateAdvocateBody.parse(input);

  // Synchronous pre-check: the consumer enforces this SAME version guard inside
  // its transaction (party/consumer.ts) and NonRetryable-dead-letters a stale
  // expectedVersion with zero signal back to the caller. A foreseeable conflict
  // is rejected here instead of behind a fake 202. Uncached, narrow read --
  // never the cached/cross-module party list.
  const current = await getPartyForPrecheck(ctx.tenantId, partyId);
  if (!current) throw httpError("PARTY_NOT_FOUND", `Party not found: ${partyId}`);
  if (current.version !== body.expectedVersion) {
    throw httpError(
      "PARTY_VERSION_CONFLICT",
      `Expected version ${body.expectedVersion}, found ${current.version}`,
    );
  }

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:party-advocate:${partyId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.updateAdvocate, {
    messageId,
    type: COMMANDS.updateAdvocate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { partyId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, partyId };
}
