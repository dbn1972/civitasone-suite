/**
 * Custom Domains command handlers (WRITE PATH).
 * Route → validate → publish command to SQS → return 202.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { RegisterDomainBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function generateToken(): string {
  return `civitasone-verify-${randomUUID().replace(/-/g, "").slice(0, 32)}`;
}

export async function domainRegister(ctx: RequestContext, body: RegisterDomainBody): Promise<Accepted & { verificationToken: string }> {
  const id = randomUUID();
  const verificationToken = generateToken();
  await queue.publish(COMMANDS.customDomainRegister, {
    messageId: id,
    type: COMMANDS.customDomainRegister,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, domain: body.domain, verificationMethod: body.verificationMethod, verificationToken },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId, verificationToken };
}

export async function domainVerify(ctx: RequestContext, domainId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.customDomainVerify, {
    messageId: id,
    type: COMMANDS.customDomainVerify,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { domainId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function domainDelete(ctx: RequestContext, domainId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.customDomainDelete, {
    messageId: id,
    type: COMMANDS.customDomainDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { domainId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
