import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface BookInput {
  address: Record<string, unknown> | null;
  tankCapacityLitres: number | null;
  requestedDate: string | null;
  requestedSlot: string | null;
  // Canonical minor-unit STRING (see zMoneyMinorStringNonNeg in
  // desludging/routes.ts), not a number and not bigint: a bigint isn't
  // JSON-serializable on the real SQS/RabbitMQ queue.publish() drivers, and
  // a plain number can silently lose precision above 2^53. The consumer
  // rebuilds the exact bigint with BigInt(string) right before the insert.
  feeMinor: string | null;
}

export async function bookDesludging(ctx: RequestContext, body: BookInput): Promise<Accepted> {
  const id = randomUUID();
  // bookingNumber is no longer generated here: it used to be a bare
  // `SEWD-${Date.now()}` computed synchronously in this command handler,
  // which could collide under concurrent load. It is now reserved from a
  // real Postgres sequence inside the consumer's own transaction (see
  // repo.ts's nextBookingNumber) — see migrations/0003_number_sequences.sql.
  return publishCommand(ctx, COMMANDS.desludgingBook, id, { id, requestedBy: ctx.actorId, ...body });
}

export async function scheduleDesludging(ctx: RequestContext, id: string, vehicleId: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.desludgingSchedule, id, { id, vehicleId, version });
}

export async function dispatchDesludging(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.desludgingDispatch, id, { id, version });
}

export async function completeDesludging(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.desludgingComplete, id, { id, version });
}

export async function cancelDesludging(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.desludgingCancel, id, { id, version });
}
