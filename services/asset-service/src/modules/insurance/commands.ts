import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { objectExists } from "@civitasone/storage";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import type { PolicyBody, ClaimBody } from "./validators.js";
import type { PolicyInsert, ClaimInsert, ClaimRow } from "./schema.js";

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

async function loadDecidableClaim(ctx: RequestContext, id: string) {
  const claim = await queries.getClaim(ctx.tenantId, id);
  if (!claim) throw new HttpError(404, "NOT_FOUND", "claim not found");
  assertDecidable(claim.status);
  return claim;
}

const DECIDABLE: string[] = ["pending", "approved"];

function auditFor(ctx: RequestContext, action: string, resourceType: "insurance_claim" | "insurance_policy", before: { status: string; amountMinor: bigint }, reason?: string): repo.DecisionAudit {
  return { actorId: ctx.actorId, correlationId: ctx.correlationId, action, resourceType, before, reason };
}

async function decideClaim(
  ctx: RequestContext, id: string, action: string, patch: Partial<ClaimInsert>, reason?: string,
  check?: (claim: ClaimRow) => void, appendNote?: string,
): Promise<void> {
  const claim = await loadDecidableClaim(ctx, id);
  check?.(claim);
  // The UPDATE itself is conditional on the status, so a concurrent or stale
  // second decision changes 0 rows and is refused rather than silently applied.
  const row = await repo.updateClaim(
    ctx.tenantId, id, { ...patch, updatedAt: new Date(), updatedBy: ctx.actorId }, DECIDABLE,
    auditFor(ctx, action, "insurance_claim", { status: claim.status, amountMinor: claim.settledAmountMinor }, reason),
    appendNote,
  );
  if (!row) throw new HttpError(409, "CLAIM_NOT_DECIDABLE", "claim was already decided");
}

export async function approveClaim(ctx: RequestContext, id: string): Promise<void> {
  await decideClaim(ctx, id, "approve", { status: "approved" });
}

export async function settleClaim(ctx: RequestContext, id: string, settlementAmountMinor: number): Promise<void> {
  await decideClaim(ctx, id, "settle", { status: "settled", settledAmountMinor: BigInt(settlementAmountMinor) }, undefined, (claim) => {
    // Money-safety: a settlement can never exceed what was claimed.
    if (BigInt(settlementAmountMinor) > BigInt(claim.claimAmountMinor)) {
      throw new HttpError(400, "SETTLEMENT_EXCEEDS_CLAIM", "settlement amount exceeds the claim amount");
    }
  });
}

export async function rejectClaim(ctx: RequestContext, id: string, reason: string): Promise<void> {
  // The filer's notes are kept; the reason is appended as "Rejected: <reason>".
  await decideClaim(ctx, id, "reject", { status: "rejected" }, reason, undefined, `Rejected: ${reason}`);
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
): Promise<void> {
  const existing = await queries.getPolicy(ctx.tenantId, id);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "policy not found");
  if (body.expiryDate !== undefined && !isRealDate(body.expiryDate)) {
    throw new HttpError(400, "VALIDATION_FAILED", "expiryDate must be a real calendar date (yyyy-mm-dd)");
  }
  // No renew path exists yet: a cancelled or expired policy cannot simply be flipped back to active.
  if (body.status === "active" && (existing.status === "cancelled" || existing.status === "expired")) {
    throw new HttpError(409, "POLICY_REACTIVATION_NOT_ALLOWED", `a ${existing.status} policy cannot be set back to active`);
  }
  const patch: Partial<PolicyInsert> = { updatedAt: new Date(), updatedBy: ctx.actorId };
  if (body.status !== undefined) patch.status = body.status;
  if (body.expiryDate !== undefined) patch.endDate = body.expiryDate;
  if (body.premiumMinor !== undefined) patch.premiumMinor = BigInt(body.premiumMinor);
  const row = await repo.updatePolicy(
    ctx.tenantId, id, patch,
    auditFor(ctx, "update", "insurance_policy", { status: existing.status, amountMinor: existing.premiumMinor }),
  );
  if (!row) throw new HttpError(404, "NOT_FOUND", "policy not found");
}
