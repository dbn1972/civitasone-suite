import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function generateBill(ctx: RequestContext, connectionId: string, billingPeriod: string, amountMinor: string, dueDate: string): Promise<Accepted> {
  const id = randomUUID();
  // billNumber is no longer generated here: it used to be a bare
  // `SEWB-${Date.now()}` computed synchronously in this command handler,
  // which could collide under concurrent load. It is now reserved from a
  // real Postgres sequence inside the consumer's own transaction (see
  // repo.ts's nextBillNumber) — see migrations/0003_number_sequences.sql.
  //
  // amountMinor is a canonical minor-unit STRING (zMoneyMinorStringNonNeg at
  // the route boundary — see billing/routes.ts), not a raw number: a bigint
  // isn't JSON-serializable on the real SQS/RabbitMQ queue.publish() drivers,
  // and a plain number can silently lose precision above 2^53 before it ever
  // reaches BigInt(). The consumer rebuilds the exact bigint with
  // BigInt(string) right before the Drizzle insert.
  return publishCommand(ctx, COMMANDS.billGenerate, id, { id, connectionId, billingPeriod, amountMinor, dueDate });
}

export async function payBill(ctx: RequestContext, id: string, paymentRef: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.billPay, id, { id, paymentRef, version });
}
