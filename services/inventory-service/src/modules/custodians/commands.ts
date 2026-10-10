/**
 * Custodian command handlers (WRITE PATH) — validate, publish a command, and
 * return 202 Accepted. The consumer (custodians/consumer.ts) is the only code
 * that writes Postgres, and it emits an audit event in the same transaction.
 *
 * GAP2-INVENTORY-CUSTODIANS-01: a store-custodian assignment is an
 * accountability/liability record for who is responsible for stock; its
 * creation must go through CQRS and must be audited like every other inventory
 * mutation (CLAUDE.md §6, §8).
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateCustodianBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createCustodian(ctx: RequestContext, body: CreateCustodianBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.custodianCreate, {
    messageId: id,
    type: COMMANDS.custodianCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
