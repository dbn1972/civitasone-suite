import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { objectExists } from "@civitasone/storage";
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

  // Attachments must be THIS caller's own uploads under THIS tenant's prefix, and must really exist in storage.
  // (`?? []`: in-process callers that skip the route's zod parse have no attachments.)
  const prefix = `uploads/${ctx.tenantId}/`;
  for (const a of body.attachments ?? []) {
    const seg = a.key.split("/"); // uploads / tenant / category / uploader / file
    if (!a.key.startsWith(prefix) || seg[3] !== ctx.actorId) {
      throw new HttpError(400, "INVALID_ATTACHMENT", "an attachment is not one of your own uploads for this tenant");
    }
    let exists: boolean;
    try {
      exists = await objectExists(a.key);
    } catch {
      throw new HttpError(503, "STORAGE_UNAVAILABLE", "document storage could not be checked right now");
    }
    if (!exists) throw new HttpError(400, "ATTACHMENT_NOT_FOUND", `attachment ${a.fileName} was not found in storage; upload it again`);
  }
  const id = randomUUID();
  await queue.publish(COMMANDS.insuranceClaimCreate, {
    messageId: id, type: COMMANDS.insuranceClaimCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** A claim can be approved, settled or rejected only while it is pending or approved -- never re-decided. */
function assertDecidable(status: string): void {
  if (status !== "pending" && status !== "approved") {
    throw new HttpError(409, "CLAIM_NOT_DECIDABLE", `claim is already ${status}`);
  }
}

/**
 * GAP2-ASSETS-INSURANCE-CLAIMS-01 (maker-checker / segregation of duties):
 * a money-bearing claim decision (approve/settle/reject) may never be taken by
 * the same user who filed the claim. Mirrors the write-off SoD guard
 * (verification/commands.ts approveWriteoffRequest → 403 SELF_APPROVAL_FORBIDDEN)
 * and the condemnation maker-checker (condemnation/preflight.ts). Re-asserted in
 * the consumer's conditional UPDATE for defence in depth.
 */
async function loadDecidableClaim(ctx: RequestContext, id: string, enforceSoD = true) {
  const claim = await queries.getClaim(ctx.tenantId, id);
  if (!claim) throw new HttpError(404, "NOT_FOUND", "claim not found");
  if (enforceSoD && claim.createdBy === ctx.actorId) {
    throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "the approver cannot be the person who filed the claim (segregation of duties)");
  }
  assertDecidable(claim.status);
  return claim;
}

export type ClaimDecision = "approve" | "settle" | "reject";

/**
 * GAP2-ASSETS-INSURANCE-CLAIMS-02 (CQRS write path, CLAUDE.md §6): the route
 * only validates (status, SoD, money bounds) and publishes a command; the
 * conditional UPDATE + audit live in the consumer. Returns the accepted
 * envelope so the route answers 202.
 */
async function publishClaimDecision(
  ctx: RequestContext, id: string, decision: ClaimDecision,
  extra: Record<string, unknown>,
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.insuranceClaimDecide, {
    messageId, type: COMMANDS.insuranceClaimDecide,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, decision, ...extra },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveClaim(ctx: RequestContext, id: string): Promise<Accepted> {
  await loadDecidableClaim(ctx, id);
  return publishClaimDecision(ctx, id, "approve", {});
}

export async function settleClaim(ctx: RequestContext, id: string, settlementAmountMinor: number): Promise<Accepted> {
  const claim = await loadDecidableClaim(ctx, id);
  // Money-safety: a settlement can never exceed what was claimed. Preflight here;
  // re-asserted in the consumer before the UPDATE.
  if (BigInt(settlementAmountMinor) > BigInt(claim.claimAmountMinor)) {
    throw new HttpError(400, "SETTLEMENT_EXCEEDS_CLAIM", "settlement amount exceeds the claim amount");
  }
  return publishClaimDecision(ctx, id, "settle", { settlementAmountMinor });
}

export async function rejectClaim(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  await loadDecidableClaim(ctx, id);
  return publishClaimDecision(ctx, id, "reject", { reason });
}

const IS_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(v: string): boolean {
  if (!IS_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export async function updatePolicy(
  ctx: RequestContext,
  id: string,
  body: { status?: string | undefined; expiryDate?: string | undefined; premiumMinor?: number | undefined },
): Promise<Accepted> {
  const existing = await queries.getPolicy(ctx.tenantId, id);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "policy not found");
  if (body.expiryDate !== undefined && !isRealDate(body.expiryDate)) {
    throw new HttpError(400, "VALIDATION_FAILED", "expiryDate must be a real calendar date (yyyy-mm-dd)");
  }
  // No renew path exists yet: a cancelled or expired policy cannot simply be flipped back to active.
  if (body.status === "active" && (existing.status === "cancelled" || existing.status === "expired")) {
    throw new HttpError(409, "POLICY_REACTIVATION_NOT_ALLOWED", `a ${existing.status} policy cannot be set back to active`);
  }
  // GAP2-ASSETS-INSURANCE-CLAIMS-02: validate here, apply the UPDATE + audit in the consumer.
  const messageId = randomUUID();
  await queue.publish(COMMANDS.insurancePolicyUpdate, {
    messageId, type: COMMANDS.insurancePolicyUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId,
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.expiryDate !== undefined ? { endDate: body.expiryDate } : {}),
      ...(body.premiumMinor !== undefined ? { premiumMinor: body.premiumMinor } : {}),
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
