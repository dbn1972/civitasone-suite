import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";
import type { PolicyBody, ClaimBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createPolicy(ctx: RequestContext, body: PolicyBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.insurancePolicyCreate, {
    messageId: id, type: COMMANDS.insurancePolicyCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createClaim(ctx: RequestContext, body: ClaimBody): Promise<Accepted> {
  // Money-safety: the CUMULATIVE total of every non-rejected claim against a
  // policy can never exceed its sum insured — not just this one claim in
  // isolation. A 10,000 policy must not accept a 9,000 claim followed by
  // another 9,000 claim. Enforced server-side; fail closed on a missing or
  // cross-tenant policy rather than silently accepting an unbounded claim.
  const policy = await queries.getPolicy(ctx.tenantId, body.policyId);
  if (!policy) throw new HttpError(404, "POLICY_NOT_FOUND", "referenced insurance policy not found");

  const coverage = BigInt(policy.coverageMinor);
  const existingTotal = await queries.sumClaimsByPolicy(ctx.tenantId, body.policyId);
  const newAmount = BigInt(body.claimAmountMinor);
  const projectedTotal = existingTotal + newAmount;

  if (projectedTotal > coverage) {
    const remaining = coverage - existingTotal;
    const remainingStr = remaining > 0n ? remaining.toString() : "0";
    throw new HttpError(
      400,
      "CLAIM_EXCEEDS_COVERAGE",
      `claim amount exceeds the policy's remaining sum insured (remaining: ${remainingStr} minor units of ${policy.currency})`,
    );
  }

  const id = randomUUID();
  await queue.publish(COMMANDS.insuranceClaimCreate, {
    messageId: id, type: COMMANDS.insuranceClaimCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
