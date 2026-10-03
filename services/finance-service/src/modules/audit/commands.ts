import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { recordAudit } from "../../shared/audit-event.js";
import { publishCommand, subscribeApply, type Accepted, type Actor, type Tx } from "../../shared/finance-command.js";
import { COMMANDS } from "../../topics.js";
import { getPolicy, readPolicyWith } from "../masters/policy.js";
import { getAuditParaById } from "./repo.js";
import { financeAuditParas, financeAuditParaEvents, type AuditParaRow } from "./schema.js";

/**
 * Audit-para workflow (GAP-FINANCE-AUDIT-PARAS-DETAIL-04): record the department reply, escalate,
 * settle. Status vocabulary is the enforced CHECK (open | responded | settled | escalated | dropped).
 *
 *   respond   open | escalated        -> responded   (reply text required; remembers who replied)
 *   escalate  open | responded        -> escalated   (reason required)
 *   settle    responded               -> settled     (note required; with the tenant's
 *                                       audit_para_maker_checker policy ON, the user who recorded the
 *                                       reply cannot also settle it)
 *
 * Each transition is ONE conditional UPDATE whose WHERE pins the source status (race-safe: a lost race
 * matches no row and is a 409, never a second event) in the same transaction as the event row and the
 * audit.event.record outbox row.
 */
export type ParaAction = "respond" | "escalate" | "settle";

const FROM: Record<ParaAction, string[]> = {
  respond: ["open", "escalated"],
  escalate: ["open", "responded"],
  settle: ["responded"],
};
const TO: Record<ParaAction, string> = { respond: "responded", escalate: "escalated", settle: "settled" };

/**
 * Consumer side: ONE guarded conditional UPDATE + the event row + the audit outbox row, in the caller's transaction.
 * The settle guard is `responded_by IS NULL OR responded_by <> actor`: a para that was already 'responded' before
 * migration 0085 has no recorded replier, and must stay settleable (a NULL comparison would otherwise match no row).
 */
export async function transitionAuditPara(tx: Tx, actor: Actor, input: { id: string; action: ParaAction; note: string }): Promise<void> {
  const { id, action, note } = input;
  const policy = await readPolicyWith(tx, actor.tenantId);
  const now = new Date();
  // Lock the row so from_status on the event is the real predecessor; the conditional UPDATE below stays the
  // authority (it still pins the source status and the maker != checker rule).
  const before = (await tx.select().from(financeAuditParas)
    .where(and(eq(financeAuditParas.tenantId, actor.tenantId), eq(financeAuditParas.id, id)))
    .limit(1).for("update"))[0];
  if (!before) throw new HttpError(404, "NOT_FOUND", "audit para not found");
  const updated = await tx.update(financeAuditParas)
    .set({
      status: TO[action],
      ...(action === "respond" ? { respondedBy: actor.actorId } : {}),
      updatedBy: actor.actorId,
      updatedAt: now,
      version: sql`${financeAuditParas.version} + 1`,
    })
    .where(and(
      eq(financeAuditParas.tenantId, actor.tenantId),
      eq(financeAuditParas.id, id),
      inArray(financeAuditParas.status, FROM[action]),
      action === "settle" && policy.auditParaMakerChecker
        ? or(isNull(financeAuditParas.respondedBy), ne(financeAuditParas.respondedBy, actor.actorId))
        : undefined,
    ))
    .returning();
  const row = updated[0];
  if (!row) {
    if (!FROM[action].includes(before.status)) {
      throw new HttpError(409, "ILLEGAL_TRANSITION", `cannot ${action} an audit para that is '${before.status}'`);
    }
    throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "the user who recorded the department reply cannot also settle the para");
  }
  await tx.insert(financeAuditParaEvents).values({
    tenantId: actor.tenantId, paraId: id, action, fromStatus: before.status, toStatus: TO[action], note, actorId: actor.actorId,
  });
  await recordAudit(tx, actor, {
    action: `audit_para_${action}`, resourceType: "audit_para", resourceId: id,
    details: { paraNo: row.paraNo, toStatus: TO[action], note },
  });
}

/** Route side: read-only pre-checks (immediate 409 for the common refusals), then publish; the consumer is authoritative. */
export async function requestAuditParaTransition(ctx: RequestContext, id: string, action: ParaAction, note: string): Promise<Accepted> {
  const para = await getAuditParaById(ctx.tenantId, id);
  if (!para) throw new HttpError(404, "NOT_FOUND", "audit para not found");
  if (!FROM[action].includes(para.status)) {
    throw new HttpError(409, "ILLEGAL_TRANSITION", `cannot ${action} an audit para that is '${para.status}'`);
  }
  if (action === "settle" && para.respondedBy && para.respondedBy === ctx.actorId && (await getPolicy(ctx.tenantId)).auditParaMakerChecker) {
    throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "the user who recorded the department reply cannot also settle the para");
  }
  return publishCommand(ctx, COMMANDS.auditParaTransition, { id, action, note }, id);
}

export function registerAuditConsumers(q: Queue): void {
  subscribeApply<{ id: string; action: ParaAction; note: string }>(
    q, COMMANDS.auditParaTransition, async (tx, actor, p) => { await transitionAuditPara(tx, actor, p); });
}

export async function listAuditParaEvents(tenantId: string, paraId: string) {
  return scopedRead((tx) => tx.select().from(financeAuditParaEvents)
    .where(and(eq(financeAuditParaEvents.tenantId, tenantId), eq(financeAuditParaEvents.paraId, paraId)))
    .orderBy(asc(financeAuditParaEvents.createdAt)));
}
