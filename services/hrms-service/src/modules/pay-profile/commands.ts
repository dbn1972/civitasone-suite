import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { DeputationMoneyTerms, CtcTerms } from "./domain.js";

type Accepted = { id: string; status: string; correlationId: string };

async function publish(topic: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(topic, {
    messageId: randomUUID(), type: topic,
    tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface PayProfileRequestPayload {
  employeeId: string;
  payProfile: string;
  effectiveFrom: string;
  deputationId: string | null;
  consolidatedMonthlyMinor: string | null;
  deputationTerms: DeputationMoneyTerms | null;
  /** S8 G1: omitted/null for every profile but ctc_contract. */
  ctcTerms?: CtcTerms | null;
  orderRef: string | null;
  remarks: string | null;
}

export const requestPayProfile = (ctx: RequestContext, p: PayProfileRequestPayload) =>
  publish(COMMANDS.payProfileRequest, ctx, randomUUID(), { ...p });

export const decidePayProfile = (ctx: RequestContext, profileId: string, decision: "approve" | "reject", note: string | null) =>
  publish(COMMANDS.payProfileDecide, ctx, profileId, { profileId, decision, note });
