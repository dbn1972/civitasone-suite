import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import { encryptPii, decryptPii } from "../../shared/pii-crypto.js";
import { publishCommand, subscribeApply, type Accepted } from "../../shared/finance-command.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as workflow from "./vendor-workflow.js";
import { getPolicy, getPolicyChange, applyPolicyChange, decidePolicyChange, splitPolicyPatch, type PolicyPatch } from "./policy.js";

/**
 * Route-side half of the vendor / policy workflows: read-only pre-checks (so the common refusal is an immediate 409,
 * exactly like payments' synchronous guards) then publish a command with a fresh messageId. The consumer below is
 * authoritative and runs ONE transaction per command.
 */
const violation = (m: string) => new HttpError(409, "MAKER_CHECKER_VIOLATION", m);

export async function requestVendorDecision(
  ctx: RequestContext, id: string, decision: "approve" | "reject", reason: string | undefined, version: number,
): Promise<Accepted> {
  const v = await repo.getVendorById(ctx.tenantId, id);
  if (!v) throw new HttpError(404, "NOT_FOUND", "vendor not found");
  if (v.status !== "pending") throw new HttpError(409, "VENDOR_NOT_PENDING", `vendor is '${v.status}', only a pending vendor can be ${decision}d`);
  if (v.version !== version) throw new HttpError(409, "VERSION_CONFLICT", "the vendor was changed after you opened it; reload and review it again");
  if (decision === "approve" && v.createdBy === ctx.actorId && (await getPolicy(ctx.tenantId)).vendorMakerChecker) {
    throw violation("a vendor you created cannot be approved by you");
  }
  return publishCommand(ctx, COMMANDS.vendorDecide, { id, decision, expectedVersion: version, ...(reason ? { reason } : {}) }, id);
}

export async function requestBankChangePropose(
  ctx: RequestContext, vendorId: string, input: workflow.BankChangeInput,
): Promise<Accepted> {
  const v = await repo.getVendorById(ctx.tenantId, vendorId);
  if (!v) throw new HttpError(404, "NOT_FOUND", "vendor not found");
  if (v.status === "pending" || v.status === "rejected") throw new HttpError(409, "VENDOR_NOT_APPROVED", "bank details of a vendor that is not approved are edited on the vendor, not through a change request");
  if (await workflow.getPendingBankChange(ctx.tenantId, vendorId)) throw new HttpError(409, "BANK_CHANGE_PENDING", "a bank-detail change for this vendor is already awaiting approval");
  const changeId = randomUUID();
  // the account number travels encrypted: queue messages are not a place for clear bank details
  return publishCommand(ctx, COMMANDS.vendorBankChangePropose, {
    changeId, vendorId, bankName: input.bankName, bankAccountEnc: encryptPii(input.bankAccount), ifsc: input.ifsc, reason: input.reason,
  }, changeId);
}

export async function requestBankChangeDecision(
  ctx: RequestContext, vendorId: string, changeId: string, decision: "approve" | "reject", reason: string | undefined,
): Promise<Accepted> {
  const pending = await workflow.getPendingBankChange(ctx.tenantId, vendorId);
  if (!pending || pending.id !== changeId) {
    throw new HttpError(404, "NOT_FOUND", "no pending bank change request with that id for this vendor");
  }
  if (decision === "approve" && pending.proposedBy === ctx.actorId && (await getPolicy(ctx.tenantId)).vendorMakerChecker) {
    throw violation("a bank change you proposed cannot be approved by you");
  }
  return publishCommand(ctx, COMMANDS.vendorBankChangeDecide, { vendorId, changeId, decision, ...(reason ? { reason } : {}) }, changeId);
}

/** PUT /policy: tightening applies at once, loosening becomes a pending request; the 202 says which. */
export async function requestPolicyChange(ctx: RequestContext, patch: PolicyPatch): Promise<Accepted & { requiresApproval: boolean; changeId: string | null }> {
  const current = await getPolicy(ctx.tenantId);
  const { needsApproval } = splitPolicyPatch(current, patch);
  const requiresApproval = Object.keys(needsApproval).length > 0;
  const changeId = randomUUID();
  const accepted = await publishCommand(ctx, COMMANDS.policyChange, { changeId, patch }, requiresApproval ? changeId : ctx.tenantId);
  return { ...accepted, requiresApproval, changeId: requiresApproval ? changeId : null };
}

export async function requestPolicyChangeDecision(
  ctx: RequestContext, changeId: string, decision: "approve" | "reject", reason: string | undefined,
): Promise<Accepted> {
  const row = await getPolicyChange(ctx.tenantId, changeId);
  if (!row) throw new HttpError(404, "NOT_FOUND", "policy change request not found");
  if (row.status !== "pending") throw new HttpError(409, "POLICY_CHANGE_NOT_PENDING", `request is already ${row.status}`);
  if (decision === "approve" && row.proposedBy === ctx.actorId) throw violation("the admin who proposed this policy change cannot approve it");
  return publishCommand(ctx, COMMANDS.policyChangeDecide, { changeId, decision, ...(reason ? { reason } : {}) }, changeId);
}

export function registerVendorConsumers(q: Queue): void {
  subscribeApply<{ id: string; decision: "approve" | "reject"; reason?: string; expectedVersion: number }>(
    q, COMMANDS.vendorDecide, async (tx, actor, p) => { await workflow.decideVendor(tx, actor, p); });
  subscribeApply<{ changeId: string; vendorId: string; bankName: string; bankAccountEnc: string; ifsc: string; reason: string }>(
    q, COMMANDS.vendorBankChangePropose, async (tx, actor, p) => {
      await workflow.proposeBankChange(tx, actor, {
        changeId: p.changeId, vendorId: p.vendorId, bankName: p.bankName, bankAccount: decryptPii(p.bankAccountEnc), ifsc: p.ifsc, reason: p.reason,
      });
    });
  subscribeApply<{ vendorId: string; changeId: string; decision: "approve" | "reject"; reason?: string }>(
    q, COMMANDS.vendorBankChangeDecide, async (tx, actor, p) => { await workflow.decideBankChange(tx, actor, p); });
  subscribeApply<{ changeId: string; patch: PolicyPatch }>(
    q, COMMANDS.policyChange, async (tx, actor, p) => { await applyPolicyChange(tx, actor, p); });
  subscribeApply<{ changeId: string; decision: "approve" | "reject"; reason?: string }>(
    q, COMMANDS.policyChangeDecide, async (tx, actor, p) => { await decidePolicyChange(tx, actor, p); });
}
