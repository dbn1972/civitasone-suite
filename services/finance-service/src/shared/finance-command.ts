import { randomUUID } from "node:crypto";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import type { RequestContext } from "@civitasone/types";
import { HttpError } from "./context.js";
import { db } from "./db.js";
import { queue } from "./infra.js";
import { markProcessed } from "./outbox.js";

/** What a consumer knows about who asked: the command envelope's tenant, actor and correlation id. */
export type Actor = Pick<RequestContext, "tenantId" | "actorId" | "correlationId">;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Accepted = { id: string; status: "accepted"; correlationId: string };

/**
 * Publish a finance command. Routes never write the DB: they validate, run read-only pre-checks (so the common
 * conflict is an immediate 409), then publish here with a FRESH messageId per request. A deterministic id would
 * silently drop a later, legitimate repeat of the same decision.
 */
export async function publishCommand(ctx: RequestContext, topic: string, payload: Record<string, unknown>, resourceId: string): Promise<Accepted> {
  await queue.publish(topic, {
    messageId: randomUUID(),
    type: topic,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  });
  return { id: resourceId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Subscribe a consumer whose whole effect is ONE transaction: the idempotency marker, the guarded conditional
 * UPDATE(s) and the audit.event.record outbox row commit together or not at all. A business refusal (HttpError
 * thrown by the apply function: lost race, maker == checker, stale version) is permanent, so it dead-letters
 * immediately instead of being retried; the web sees the unchanged state when it polls.
 */
export function subscribeApply<P>(
  q: Queue,
  topic: string,
  apply: (tx: Tx, actor: Actor, payload: P) => Promise<void>,
): void {
  q.subscribe(topic, async (msg) => {
    const actor: Actor = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await apply(tx as Tx, actor, msg.payload as P);
      });
    } catch (err) {
      if (err instanceof HttpError) throw new NonRetryableError(`[finance] ${err.code}: ${err.message}`, err);
      throw err;
    }
  });
}
