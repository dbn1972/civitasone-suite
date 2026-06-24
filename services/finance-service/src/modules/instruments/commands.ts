import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
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

/** cancel: only an un-presented (issued) instrument may be cancelled/stopped. Idempotent. */
export async function cancelInstrument(ctx: RequestContext, id: string): Promise<InstrumentView> {
  const current = await load(ctx, id);
  if (current.status === "cancelled") return serialize(current);
  const updated = await repo.transition(ctx.tenantId, id, ["issued"], "cancelled", {}, "cancelledAt", ctx.actorId);
  if (!updated) throw illegal(current.status, "cancelled");
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
  return rows.map(serialize);
}

function illegal(from: string, to: string): HttpError {
  return new HttpError(409, "ILLEGAL_TRANSITION", `cannot move instrument from '${from}' to '${to}'`);
}
