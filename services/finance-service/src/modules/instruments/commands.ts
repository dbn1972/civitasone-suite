import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import type { InstrumentRow } from "../treasury/schema.js";
import * as repo from "./repo.js";
import type { Queue } from "@civitasone/queue";
import { recordAudit } from "../../shared/audit-event.js";
import { publishCommand, subscribeApply, type Accepted, type Actor, type Tx } from "../../shared/finance-command.js";
import { COMMANDS } from "../../topics.js";
import { getPolicy, readPolicyWith } from "../masters/policy.js";
import { isStale, todayIso, validUntil } from "./domain.js";
import type { IssueInstrumentBody, BounceInstrumentBody, ReasonedInstrumentBody } from "./validators.js";

function serialize(row: InstrumentRow) {
  return {
    id: row.id,
    instrumentType: row.instrumentType,
    instrumentNo: row.instrumentNo,
    bankAccountId: row.bankAccountId,
    bankName: row.bankName,
    payee: row.payee,
    amountMinor: row.amountMinor.toString(),
    currency: row.currency,
    issueDate: row.issueDate,
    status: row.status,
    presentedAt: row.presentedAt,
    clearedAt: row.clearedAt,
    bouncedAt: row.bouncedAt,
    cancelledAt: row.cancelledAt,
    bounceReason: row.bounceReason,
    paymentId: row.paymentId,
    version: row.version,
    // GAP-FINANCE-TREASURY-CHEQUES-DETAIL-03: the actor behind each lifecycle step (ids; the web
    // resolves names). issuedBy is the creator. Null for steps taken before migration 0085.
    issuedBy: row.createdBy,
    presentedBy: row.presentedBy ?? null,
    clearedBy: row.clearedBy ?? null,
    bouncedBy: row.bouncedBy ?? null,
    cancelledBy: row.cancelledBy ?? null,
    cancelReason: row.cancelReason ?? null,
    representCount: row.representCount,
    lastRepresentedAt: row.lastRepresentedAt ?? null,
    lastRepresentedBy: row.lastRepresentedBy ?? null,
    representReason: row.representReason ?? null,
    staledAt: row.staledAt ?? null,
    staledBy: row.staledBy ?? null,
  };
}
export type InstrumentView = ReturnType<typeof serialize>;

type AuditableAction = "issue" | "present" | "clear" | "bounce" | "cancel";

/** Audit event for an instrument mutation, enqueued inside the mutation's own transaction. */
async function auditInstrumentTx(
  tx: Parameters<typeof enqueue>[0], ctx: RequestContext, action: AuditableAction,
  row: Pick<InstrumentRow, "id" | "instrumentType" | "instrumentNo">, fromStatus: string | null, toStatus: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: {
      service: "finance", action, resourceType: "instrument", resourceId: row.id, outcome: "success",
      details: { instrumentType: row.instrumentType, instrumentNo: row.instrumentNo, fromStatus, toStatus },
    },
  });
}

/**
 * GAP-FINANCE-TREASURY-CHEQUES-03: maker != checker. The officer who issued an
 * instrument may not also record its clearance or dishonour -- the bank outcome
 * of a payment instrument is confirmed by a second person. Always enforced, with
 * no switch (a deployment-wide off-switch would disable the control for every
 * tenant); any per-tenant opt-out belongs on the tenant finance policy.
 */
export function assertInstrumentChecker(issuerId: string, actorId: string): void {
  if (issuerId === actorId) {
    throw new HttpError(403, "MAKER_CHECKER_VIOLATION",
      "the officer who issued this instrument cannot also record its clearance or dishonour (maker-checker)");
  }
}

/** Issue a cheque/DD. Idempotent on (tenant, type, number). */
export async function issueInstrument(ctx: RequestContext, body: IssueInstrumentBody): Promise<InstrumentView> {
  const issueDate = body.issueDate ?? new Date().toISOString().slice(0, 10);
  const { row } = await db.transaction(async (tx) => {
    const res = await repo.insertInstrumentTx(tx, {
      tenantId: ctx.tenantId,
      instrumentType: body.instrumentType,
      instrumentNo: body.instrumentNo,
      bankName: body.bankName,
      payee: body.payee,
      amountMinor: BigInt(body.amountMinor),
      currency: body.currency,
      issueDate,
      status: "issued",
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      ...(body.bankAccountId ? { bankAccountId: body.bankAccountId } : {}),
      ...(body.paymentId ? { paymentId: body.paymentId } : {}),
    });
    // Only the request that actually creates the row is audited; an idempotent re-issue is not.
    if (res.created) await auditInstrumentTx(tx, ctx, "issue", res.row, null, "issued");
    return res;
  });
  // Re-issue with mismatched material terms is a conflict, not a silent no-op.
  if (!sameTerms(row, body)) {
    throw new HttpError(409, "INSTRUMENT_CONFLICT",
      `instrument ${body.instrumentType} ${body.instrumentNo} already issued with different terms`);
  }
  return serialize(row);
}

function sameTerms(row: InstrumentRow, body: IssueInstrumentBody): boolean {
  return row.amountMinor === BigInt(body.amountMinor) && row.payee === body.payee;
}

async function load(ctx: RequestContext, id: string): Promise<InstrumentRow> {
  const row = await repo.findById(ctx.tenantId, id);
  if (!row) throw new HttpError(404, "NOT_FOUND", "instrument not found");
  return row;
}

/**
 * present: issued -> presented. Idempotent (already presented returns the row).
 * Illegal from a terminal state (cleared/bounced/cancelled) -> 409.
 */
export async function presentInstrument(ctx: RequestContext, id: string): Promise<InstrumentView> {
  const current = await load(ctx, id);
  if (current.status === "presented") return serialize(current);
  // consistent with re-present: a cheque past its validity horizon can no longer be presented
  if (current.status === "issued") {
    const policy = await getPolicy(ctx.tenantId);
    if (isStale(String(current.issueDate), policy.chequeValidityMonths, todayIso())) {
      throw new HttpError(409, "INSTRUMENT_STALE",
        `instrument is past its ${policy.chequeValidityMonths}-month validity (valid until ${validUntil(String(current.issueDate), policy.chequeValidityMonths)}); it cannot be presented`);
    }
  }
  const updated = await db.transaction(async (tx) => {
    const row = await repo.transitionTx(tx, ctx.tenantId, id, ["issued"], "presented", {}, "presentedAt", ctx.actorId);
    if (row) await auditInstrumentTx(tx, ctx, "present", row, current.status, "presented");
    return row;
  });
  if (!updated) throw illegal(current.status, "presented");
  return serialize(updated);
}

/** clear: issued|presented -> cleared. Idempotent. */
export async function clearInstrument(ctx: RequestContext, id: string): Promise<InstrumentView> {
  const current = await load(ctx, id);
  if (current.status === "cleared") return serialize(current);
  assertInstrumentChecker(current.createdBy, ctx.actorId);
  const updated = await db.transaction(async (tx) => {
    const row = await repo.transitionTx(tx, ctx.tenantId, id, ["issued", "presented"], "cleared", {}, "clearedAt", ctx.actorId);
    if (row) await auditInstrumentTx(tx, ctx, "clear", row, current.status, "cleared");
    return row;
  });
  if (!updated) throw illegal(current.status, "cleared");
  return serialize(updated);
}

/** bounce: presented -> bounced (dishonoured). Idempotent. */
export async function bounceInstrument(ctx: RequestContext, id: string, body: BounceInstrumentBody): Promise<InstrumentView> {
  const current = await load(ctx, id);
  if (current.status === "bounced") return serialize(current);
  assertInstrumentChecker(current.createdBy, ctx.actorId);
  const updated = await db.transaction(async (tx) => {
    const row = await repo.transitionTx(
      tx, ctx.tenantId, id, ["issued", "presented"], "bounced",
      { bounceReason: body.reason ?? "dishonoured" }, "bouncedAt", ctx.actorId,
    );
    if (row) await auditInstrumentTx(tx, ctx, "bounce", row, current.status, "bounced");
    return row;
  });
  if (!updated) throw illegal(current.status, "bounced");
  return serialize(updated);
}

/**
 * cancel: only an un-presented (issued) instrument may be cancelled/stopped; a reason is mandatory
 * (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04). Idempotent.
 *
 * The guarded UPDATE and the audit event are written in ONE transaction, so a
 * cancel is audited exactly once: only the request that actually flips
 * issued -> cancelled (the UPDATE's WHERE pins the source status) enqueues the
 * audit.event.record; a replay or a concurrent loser sees the already-cancelled
 * row and writes nothing.
 */
export async function cancelInstrument(ctx: RequestContext, id: string, body: ReasonedInstrumentBody): Promise<InstrumentView> {
  const current = await load(ctx, id);
  if (current.status === "cancelled") return serialize(current);
  const updated = await db.transaction(async (tx) => {
    const row = await repo.transitionTx(tx, ctx.tenantId, id, ["issued"], "cancelled", { cancelReason: body.reason }, "cancelledAt", ctx.actorId);
    if (row) {
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          service: "finance", action: "cancel", resourceType: "instrument", resourceId: id,
          outcome: "success",
          details: { instrumentType: row.instrumentType, instrumentNo: row.instrumentNo, fromStatus: current.status, toStatus: "cancelled", reason: body.reason },
        },
      });
    }
    return row;
  });
  if (!updated) {
    // Lost a race: if the winner cancelled it, this is the idempotent replay (no second audit).
    const latest = await load(ctx, id);
    if (latest.status === "cancelled") return serialize(latest);
    throw illegal(latest.status, "cancelled");
  }
  return serialize(updated);
}

/**
 * re-present: bounced -> presented again, with a reason. Refused once the instrument is past its validity horizon
 * (it can no longer be presented, only re-issued). Consumer side: one guarded UPDATE + audit in the caller's tx.
 */
export async function applyRepresent(tx: Tx, actor: Actor, input: { id: string; reason: string }): Promise<void> {
  const cur = await repo.findByIdTx(tx, actor.tenantId, input.id);
  if (!cur) throw new HttpError(404, "NOT_FOUND", "instrument not found");
  if (cur.status !== "bounced") throw illegal(cur.status, "presented");
  const policy = await readPolicyWith(tx, actor.tenantId);
  if (isStale(String(cur.issueDate), policy.chequeValidityMonths, todayIso())) {
    throw new HttpError(409, "INSTRUMENT_STALE",
      `instrument is past its ${policy.chequeValidityMonths}-month validity (valid until ${validUntil(String(cur.issueDate), policy.chequeValidityMonths)}); re-issue it instead`);
  }
  const row = await repo.representTx(tx, actor.tenantId, input.id, input.reason, actor.actorId);
  if (!row) throw illegal("changed concurrently", "presented");
  await recordAudit(tx, actor, {
    action: "represent", resourceType: "instrument", resourceId: input.id,
    details: { instrumentType: row.instrumentType, instrumentNo: row.instrumentNo, fromStatus: "bounced", toStatus: "presented", reason: input.reason, representCount: row.representCount },
  });
}

/** mark stale: issued -> stale, only once older than the tenant's validity horizon (default 3 months, RBI). Idempotent. */
export async function applyMarkStale(tx: Tx, actor: Actor, input: { id: string; reason?: string | undefined }): Promise<void> {
  const cur = await repo.findByIdTx(tx, actor.tenantId, input.id);
  if (!cur) throw new HttpError(404, "NOT_FOUND", "instrument not found");
  if (cur.status === "stale") return;
  if (cur.status !== "issued") throw illegal(cur.status, "stale");
  const policy = await readPolicyWith(tx, actor.tenantId);
  if (!isStale(String(cur.issueDate), policy.chequeValidityMonths, todayIso())) {
    throw new HttpError(409, "INSTRUMENT_NOT_STALE",
      `instrument is valid until ${validUntil(String(cur.issueDate), policy.chequeValidityMonths)}; it cannot be marked stale before then`);
  }
  const row = await repo.staleTx(tx, actor.tenantId, input.id, actor.actorId);
  if (!row) throw illegal("changed concurrently", "stale");
  await recordAudit(tx, actor, {
    action: "mark_stale", resourceType: "instrument", resourceId: input.id,
    details: { instrumentType: row.instrumentType, instrumentNo: row.instrumentNo, fromStatus: "issued", toStatus: "stale", ...(input.reason ? { reason: input.reason } : {}) },
  });
}

/** Route side of re-present: read-only pre-checks (immediate 409) then publish; the consumer is authoritative. */
export async function representInstrument(ctx: RequestContext, id: string, body: ReasonedInstrumentBody): Promise<Accepted> {
  const cur = await load(ctx, id);
  if (cur.status !== "bounced") throw illegal(cur.status, "presented");
  const policy = await getPolicy(ctx.tenantId);
  if (isStale(String(cur.issueDate), policy.chequeValidityMonths, todayIso())) {
    throw new HttpError(409, "INSTRUMENT_STALE",
      `instrument is past its ${policy.chequeValidityMonths}-month validity (valid until ${validUntil(String(cur.issueDate), policy.chequeValidityMonths)}); re-issue it instead`);
  }
  return publishCommand(ctx, COMMANDS.instrumentRepresent, { id, reason: body.reason }, id);
}

export async function markInstrumentStale(ctx: RequestContext, id: string, body: { reason?: string | undefined }): Promise<Accepted> {
  const cur = await load(ctx, id);
  if (cur.status !== "stale") {
    if (cur.status !== "issued") throw illegal(cur.status, "stale");
    const policy = await getPolicy(ctx.tenantId);
    if (!isStale(String(cur.issueDate), policy.chequeValidityMonths, todayIso())) {
      throw new HttpError(409, "INSTRUMENT_NOT_STALE",
        `instrument is valid until ${validUntil(String(cur.issueDate), policy.chequeValidityMonths)}; it cannot be marked stale before then`);
    }
  }
  return publishCommand(ctx, COMMANDS.instrumentMarkStale, { id, ...(body.reason ? { reason: body.reason } : {}) }, id);
}

export function registerInstrumentWorkflowConsumers(q: Queue): void {
  subscribeApply<{ id: string; reason: string }>(q, COMMANDS.instrumentRepresent, async (tx, actor, p) => { await applyRepresent(tx, actor, p); });
  subscribeApply<{ id: string; reason?: string }>(q, COMMANDS.instrumentMarkStale, async (tx, actor, p) => { await applyMarkStale(tx, actor, p); });
}

/**
 * Audited reveal of the drawn-on account number (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-01). The audit
 * event carries the instrument id, the actor and the reason, never the number itself.
 */
export async function revealInstrumentAccount(ctx: RequestContext, id: string, reason: string): Promise<{ accountNo: string }> {
  return db.transaction(async (tx) => {
    const cur = await repo.findByIdTx(tx, ctx.tenantId, id);
    if (!cur) throw new HttpError(404, "NOT_FOUND", "instrument not found");
    if (!cur.bankAccountId) throw new HttpError(404, "NO_BANK_ACCOUNT", "this instrument is not linked to a bank account");
    const accountNo = await repo.accountNoForInstrumentTx(tx, ctx.tenantId, cur.bankAccountId);
    if (!accountNo) throw new HttpError(404, "NO_BANK_ACCOUNT", "the linked bank account was not found");
    await recordAudit(tx, ctx, {
      action: "account_reveal", resourceType: "instrument", resourceId: id,
      details: { instrumentNo: cur.instrumentNo, bankAccountId: cur.bankAccountId, reason },
    });
    return { accountNo };
  });
}

export async function getInstrument(ctx: RequestContext, id: string) {
  const row = await load(ctx, id);
  const policy = await getPolicy(ctx.tenantId);
  const last4 = row.bankAccountId ? (await repo.accountLast4ByBankId(ctx.tenantId, [row.bankAccountId])).get(row.bankAccountId) ?? null : null;
  return {
    ...serialize(row),
    accountNoLast4: last4,
    // The last day the instrument is valid; the web offers "Mark stale" only after this date.
    validUntil: validUntil(String(row.issueDate), policy.chequeValidityMonths),
  };
}

export async function listInstruments(
  ctx: RequestContext,
  filters: { status?: string; type?: string; limit: number },
): Promise<InstrumentView[]> {
  const rows = await repo.listInstruments(ctx.tenantId, filters);
  const bankIds = [...new Set(rows.map((r) => r.bankAccountId).filter((id): id is string => !!id))];
  const last4 = await repo.accountLast4ByBankId(ctx.tenantId, bankIds);
  return rows.map((r) => ({ ...serialize(r), accountNoLast4: r.bankAccountId ? last4.get(r.bankAccountId) ?? null : null }));
}

function illegal(from: string, to: string): HttpError {
  return new HttpError(409, "ILLEGAL_TRANSITION", `cannot move instrument from '${from}' to '${to}'`);
}
