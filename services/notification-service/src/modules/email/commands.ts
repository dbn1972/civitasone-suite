import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { DmarcPolicy } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface RegisterSendingDomainPayload {
  domain: string;
  dkimSelector: string;
  dkimValue: string;
  spfInclude: string;
  dmarcPolicy: DmarcPolicy;
}

export interface RecordAuthCheckPayload {
  sendingDomainId: string;
  dkimTxt: string[];
  spfTxt: string[];
  dmarcTxt: string[];
  source: "scheduled" | "manual";
  checkedAt?: string | undefined;
}

export async function registerSendingDomain(
  ctx: RequestContext, payload: RegisterSendingDomainPayload,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.registerSendingDomain, {
    messageId: id, type: COMMANDS.registerSendingDomain, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordDomainAuthCheck(
  ctx: RequestContext, payload: RecordAuthCheckPayload,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.recordDomainAuthCheck, {
    messageId: id, type: COMMANDS.recordDomainAuthCheck, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
