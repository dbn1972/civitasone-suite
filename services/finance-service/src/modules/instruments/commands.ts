import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import type { InstrumentRow } from "../treasury/schema.js";
import * as repo from "./repo.js";
import type { IssueInstrumentBody, BounceInstrumentBody } from "./validators.js";

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
  };
}
export type InstrumentView = ReturnType<typeof serialize>;

/** Issue a cheque/DD. Idempotent on (tenant, type, number). */
export async function issueInstrument(ctx: RequestContext, body: IssueInstrumentBody): Promise<InstrumentView> {
  const issueDate = body.issueDate ?? new Date().toISOString().slice(0, 10);
  const { row } = await repo.insertInstrument({
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
  const updated = await repo.transition(ctx.tenantId, id, ["issued"], "presented", {}, "presentedAt", ctx.actorId);
  if (!updated) throw illegal(current.status, "presented");
  return serialize(updated);
}

/** clear: issued|presented -> cleared. Idempotent. */
export async function clearInstrument(ctx: RequestContext, id: string): Promise<InstrumentView> {
  const current = await load(ctx, id);
  if (current.status === "cleared") return serialize(current);
  const updated = await repo.transition(ctx.tenantId, id, ["issued", "presented"], "cleared", {}, "clearedAt", ctx.actorId);
  if (!updated) throw illegal(current.status, "cleared");
  return serialize(updated);
}

/** bounce: presented -> bounced (dishonoured). Idempotent. */
export async function bounceInstrument(ctx: RequestContext, id: string, body: BounceInstrumentBody): Promise<InstrumentView> {
  const current = await load(ctx, id);
  if (current.status === "bounced") return serialize(current);
  const updated = await repo.transition(
    ctx.tenantId, id, ["issued", "presented"], "bounced",
    { bounceReason: body.reason ?? "dishonoured" }, "bouncedAt", ctx.actorId,
  );
  if (!updated) throw illegal(current.status, "bounced");
  return serialize(updated);
}

/**
 * cancel: only an un-presented (issued) instrument may be cancelled/stopped. Idempotent.
 *
 * The guarded UPDATE and the audit event are written in ONE transaction, so a
 * cancel is audited exactly once: only the request that actually flips
 * issued -> cancelled (the UPDATE's WHERE pins the source status) enqueues the
 * audit.event.record; a replay or a concurrent loser sees the already-cancelled
 * row and writes nothing.
 */
export async function cancelInstrument(ctx: RequestContext, id: string): Promise<InstrumentView> {
  const current = await load(ctx, id);
  if (current.status === "cancelled") return serialize(current);
  const updated = await db.transaction(async (tx) => {
    const row = await repo.transitionTx(tx, ctx.tenantId, id, ["issued"], "cancelled", {}, "cancelledAt", ctx.actorId);
    if (row) {
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          service: "finance", action: "cancel", resourceType: "instrument", resourceId: id,
          outcome: "success",
          details: { instrumentType: row.instrumentType, instrumentNo: row.instrumentNo, fromStatus: current.status, toStatus: "cancelled" },
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

export async function getInstrument(ctx: RequestContext, id: string): Promise<InstrumentView> {
  return serialize(await load(ctx, id));
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
