/**
 * Command handlers (WRITE PATH) — validate, publish command, return accepted.
 * The consumer is the only code that writes Postgres.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { and, eq } from "drizzle-orm";
import { queue } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { storeReceiptNotes } from "./schema.js";
import { COMMANDS } from "../../topics.js";
import type { CreateSrnBody, SignSrnBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId: id,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
}

export async function createSrn(ctx: RequestContext, body: CreateSrnBody): Promise<Accepted> {
  // GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-06: one SRN per GRN. Reject a second create
  // synchronously with 409 (an uncached read - the by-grn read model may hold a
  // stale "none") instead of returning 202 and failing later in the consumer. The
  // consumer keeps its in-transaction check + the unique index for races.
  const existing = await scopedRead((tx) => tx.select({ id: storeReceiptNotes.id }).from(storeReceiptNotes)
    .where(and(eq(storeReceiptNotes.tenantId, ctx.tenantId), eq(storeReceiptNotes.grnId, body.grnId)))
    .limit(1));
  if (existing[0]) {
    throw new HttpError(409, "SRN_ALREADY_EXISTS", "a Store Receipt Note already exists for this GRN");
  }
  const id = randomUUID();
  await publish(COMMANDS.srnCreate, ctx, id, {
    id,
    tenantId: ctx.tenantId,
    grnId: body.grnId,
    storeOfficerId: ctx.actorId,
    remarks: body.remarks,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function signSrn(ctx: RequestContext, id: string, body: SignSrnBody): Promise<Accepted> {
  // A fresh messageId for the command envelope — the target SRN id lives in the
  // payload. Reusing the SRN id as the messageId collides with srn.create in the
  // idempotency inbox (that command's messageId IS the SRN id), which would
  // silently dedupe (drop) the sign command.
  const messageId = randomUUID();
  await publish(COMMANDS.srnSign, ctx, messageId, {
    id,
    tenantId: ctx.tenantId,
    receivedAt: body.receivedAt,
    remarks: body.remarks,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
