import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export const enableMfaBody = z.object({
  method: z.enum(["totp", "sms", "email"]).default("totp"),
});
export type EnableMfaBody = z.infer<typeof enableMfaBody>;

export type Accepted = { id: string; status: string; correlationId: string };

export async function enableMfa(ctx: RequestContext, userId: string, body: EnableMfaBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.enableMfa, {
    messageId: id,
    type: COMMANDS.enableMfa,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, userId, method: body.method, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function setupMfa(
  ctx: RequestContext,
  body: { encryptedSecret: string; method: "totp"; existing: boolean; currentVersion?: number },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.setupMfa, {
    messageId: id,
    type: COMMANDS.setupMfa,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      userId: ctx.actorId,
      tenantId: ctx.tenantId,
      encryptedSecret: body.encryptedSecret,
      method: body.method,
      existing: body.existing,
      currentVersion: body.currentVersion ?? 0,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordMfaVerifyFailure(
  ctx: RequestContext,
  body: { nextFailed: number; lock: boolean; lockUntilMs: number; currentVersion: number },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.mfaVerifyFail, {
    messageId: id,
    type: COMMANDS.mfaVerifyFail,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      userId: ctx.actorId,
      tenantId: ctx.tenantId,
      nextFailed: body.nextFailed,
      lock: body.lock,
      lockUntilMs: body.lockUntilMs,
      currentVersion: body.currentVersion,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordMfaVerifySuccess(
  ctx: RequestContext,
  body: { matchedStep: number; enable: boolean; currentVersion: number },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.mfaVerifySuccess, {
    messageId: id,
    type: COMMANDS.mfaVerifySuccess,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      userId: ctx.actorId,
      tenantId: ctx.tenantId,
      matchedStep: body.matchedStep,
      enable: body.enable,
      currentVersion: body.currentVersion,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
