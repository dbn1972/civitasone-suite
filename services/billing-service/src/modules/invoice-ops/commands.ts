/** invoice-ops command publishers (WRITE PATH): validate -> publish -> 202. Consumers do the writes. */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { OPS_COMMANDS } from "./topics.js";
import type { Recipient } from "./identity-client.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(ctx: RequestContext, type: string, payload: Record<string, unknown>, id: string = randomUUID()): Promise<Accepted> {
  await queue.publish(type, {
    // Fresh id per request: these are repeatable decisions, a deterministic id would silently drop later ones.
    messageId: randomUUID(), type, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    schemaVersion: "1.0", payload,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const requestOfflinePayment = (ctx: RequestContext, p: { invoiceId: string; mode: string; reference: string; referenceNorm: string; paidOn: string; amountMinor: bigint; reason: string }) => {
  const requestId = randomUUID();
  return publish(ctx, OPS_COMMANDS.offlineRequest, { requestId, ...p, amountMinor: p.amountMinor.toString() }, requestId);
};
export const decideOfflinePayment = (ctx: RequestContext, p: { requestId: string; invoiceId: string; approve: boolean; reason?: string | undefined }) =>
  publish(ctx, OPS_COMMANDS.offlineDecide, { ...p }, p.requestId);
export const setMakerChecker = (ctx: RequestContext, p: { enabled: boolean; reason: string }) => {
  const requestId = randomUUID();
  return publish(ctx, OPS_COMMANDS.makerCheckerSet, { requestId, ...p }, requestId);
};
export const decideMakerChecker = (ctx: RequestContext, p: { requestId: string; approve: boolean; reason?: string | undefined }) =>
  publish(ctx, OPS_COMMANDS.makerCheckerDecide, { ...p }, p.requestId);
export const setReminderDays = (ctx: RequestContext, days: number | null) => publish(ctx, OPS_COMMANDS.reminderDays, { days });
export const sendReminder = (ctx: RequestContext, p: { invoiceId: string; trigger: "manual" | "scheduled"; recipients: Recipient[] }) => {
  const reminderId = randomUUID();
  return publish(ctx, OPS_COMMANDS.reminderSend, { reminderId, ...p }, reminderId);
};
