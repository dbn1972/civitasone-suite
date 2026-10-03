import { and, desc, eq, ne, sql } from "drizzle-orm";
import { HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { recordAudit } from "../../shared/audit-event.js";
import type { Actor, Tx } from "../../shared/finance-command.js";
import { financePolicy, financePolicyChanges } from "./schema.js";

/**
 * Per-tenant finance policy switches (migrations/0084). Conservative defaults: every maker != checker rule is ON
 * until a tenant turns it off, and the stale-cheque horizon is the RBI three-month validity. A tenant with no row
 * simply gets the defaults (no row is created on read).
 *
 * TIGHTENING is immediate. LOOSENING (turning a maker != checker switch OFF, or raising the cheque validity above
 * the RBI 3 months) is itself a two-person act: it becomes a pending request that a DIFFERENT admin approves
 * (one conditional UPDATE: status = pending AND proposed_by <> actor), applied only on approval, audited.
 */
export type FinancePolicy = {
  vendorMakerChecker: boolean;
  auditParaMakerChecker: boolean;
  chequeValidityMonths: number;
};

export const DEFAULT_POLICY: FinancePolicy = {
  vendorMakerChecker: true,
  auditParaMakerChecker: true,
  chequeValidityMonths: 3,
};
/** The RBI cheque validity: a tenant may not set more than this without a second admin's approval. */
export const RBI_CHEQUE_VALIDITY_MONTHS = 3;

type Reader = Pick<typeof db, "select">;

export async function readPolicyWith(reader: Reader, tenantId: string): Promise<FinancePolicy> {
  const rows = await (reader as typeof db).select().from(financePolicy).where(eq(financePolicy.tenantId, tenantId)).limit(1);
  const r = rows[0];
  if (!r) return { ...DEFAULT_POLICY };
  return {
    vendorMakerChecker: r.vendorMakerChecker,
    auditParaMakerChecker: r.auditParaMakerChecker,
    chequeValidityMonths: r.chequeValidityMonths,
  };
}

export async function getPolicy(tenantId: string): Promise<FinancePolicy> {
  return scopedRead((tx) => readPolicyWith(tx, tenantId));
}

export type PolicyPatch = { [K in keyof FinancePolicy]?: FinancePolicy[K] | undefined };

function definedOnly(o: PolicyPatch): Partial<FinancePolicy> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<FinancePolicy>;
}

/** Split a patch into the part that tightens (applied at once) and the part that loosens (needs a second admin). */
export function splitPolicyPatch(current: FinancePolicy, patch: PolicyPatch): { immediate: Partial<FinancePolicy>; needsApproval: Partial<FinancePolicy> } {
  const p = definedOnly(patch);
  const immediate: Partial<FinancePolicy> = {};
  const needsApproval: Partial<FinancePolicy> = {};
  for (const key of ["vendorMakerChecker", "auditParaMakerChecker"] as const) {
    const v = p[key];
    if (v === undefined) continue;
    if (v === false && current[key] === true) needsApproval[key] = false;
    else immediate[key] = v;
  }
  const m = p.chequeValidityMonths;
  if (m !== undefined) {
    if (m > current.chequeValidityMonths && m > RBI_CHEQUE_VALIDITY_MONTHS) needsApproval.chequeValidityMonths = m;
    else immediate.chequeValidityMonths = m;
  }
  return { immediate, needsApproval };
}

async function upsertFields(tx: Tx, actor: Actor, fields: Partial<FinancePolicy>): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const base = { ...DEFAULT_POLICY, ...fields };
  await tx.insert(financePolicy).values({
    tenantId: actor.tenantId,
    vendorMakerChecker: base.vendorMakerChecker,
    auditParaMakerChecker: base.auditParaMakerChecker,
    chequeValidityMonths: base.chequeValidityMonths,
    updatedBy: actor.actorId,
  }).onConflictDoUpdate({
    target: financePolicy.tenantId,
    // only the fields being changed: a concurrent change to a different field is never overwritten
    set: { ...fields, updatedBy: actor.actorId, updatedAt: new Date(), version: sql`${financePolicy.version} + 1` },
  });
}

/**
 * Consumer side of PUT /v1/finance/policy: apply the tightening part now, and record the loosening part as a pending
 * request (id supplied by the route so the 202 can name it). Both are audited in this transaction.
 */
export async function applyPolicyChange(tx: Tx, actor: Actor, input: { changeId: string; patch: PolicyPatch }): Promise<void> {
  const before = await readPolicyWith(tx, actor.tenantId);
  const { immediate, needsApproval } = splitPolicyPatch(before, input.patch);
  if (Object.keys(immediate).length > 0) {
    await upsertFields(tx, actor, immediate);
    await recordAudit(tx, actor, {
      action: "policy_update", resourceType: "finance_policy", resourceId: actor.tenantId,
      details: { before, applied: immediate },
    });
  }
  if (Object.keys(needsApproval).length > 0) {
    await tx.insert(financePolicyChanges).values({
      id: input.changeId, tenantId: actor.tenantId, patch: needsApproval, proposedBy: actor.actorId,
    });
    await recordAudit(tx, actor, {
      action: "policy_change_propose", resourceType: "finance_policy", resourceId: input.changeId,
      details: { requested: needsApproval },
    });
  }
}

/** Consumer side of approve / reject of a pending loosening: proposer != approver, applied only on approval. */
export async function decidePolicyChange(
  tx: Tx, actor: Actor, input: { changeId: string; decision: "approve" | "reject"; reason?: string | undefined },
): Promise<void> {
  const updated = await tx.update(financePolicyChanges)
    .set({
      status: input.decision === "approve" ? "approved" : "rejected",
      decidedBy: actor.actorId, decidedAt: new Date(), decisionReason: input.reason ?? null,
      version: sql`${financePolicyChanges.version} + 1`,
    })
    .where(and(
      eq(financePolicyChanges.tenantId, actor.tenantId),
      eq(financePolicyChanges.id, input.changeId),
      eq(financePolicyChanges.status, "pending"),
      // approving needs a DIFFERENT admin; the proposer may withdraw (reject) their own request
      input.decision === "approve" ? ne(financePolicyChanges.proposedBy, actor.actorId) : undefined,
    ))
    .returning();
  const row = updated[0];
  if (!row) {
    const cur = (await tx.select().from(financePolicyChanges)
      .where(and(eq(financePolicyChanges.tenantId, actor.tenantId), eq(financePolicyChanges.id, input.changeId))).limit(1))[0];
    if (!cur) throw new HttpError(404, "NOT_FOUND", "policy change request not found");
    if (cur.status !== "pending") throw new HttpError(409, "POLICY_CHANGE_NOT_PENDING", `request is already ${cur.status}`);
    throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "the admin who proposed this policy change cannot approve it");
  }
  if (input.decision === "approve") await upsertFields(tx, actor, row.patch as Partial<FinancePolicy>);
  await recordAudit(tx, actor, {
    action: input.decision === "approve" ? "policy_change_approve" : "policy_change_reject",
    resourceType: "finance_policy", resourceId: input.changeId,
    details: { patch: row.patch, proposedBy: row.proposedBy, ...(input.reason ? { reason: input.reason } : {}) },
  });
}

export async function listPendingPolicyChanges(tenantId: string) {
  return scopedRead((tx) => tx.select().from(financePolicyChanges)
    .where(and(eq(financePolicyChanges.tenantId, tenantId), eq(financePolicyChanges.status, "pending")))
    .orderBy(desc(financePolicyChanges.proposedAt)));
}

export async function getPolicyChange(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(financePolicyChanges)
    .where(and(eq(financePolicyChanges.tenantId, tenantId), eq(financePolicyChanges.id, id))).limit(1));
  return rows[0] ?? null;
}
