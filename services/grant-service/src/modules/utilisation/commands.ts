import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { SubmitUcBody, ComplianceReportBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function submitUc(ctx: RequestContext, applicationId: string, body: SubmitUcBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.ucSubmit, {
    messageId: id, type: COMMANDS.ucSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, applicationId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "uc", applicationId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitComplianceReport(ctx: RequestContext, applicationId: string, body: ComplianceReportBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.complianceReport, {
    messageId: id, type: COMMANDS.complianceReport,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, applicationId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "compliance", applicationId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function validateUc(
  ctx: RequestContext,
  ucId: string,
  body: { status: "validated" | "rejected"; remarks?: string | undefined },
  meta: { applicationId: string; installmentNo: number },
): Promise<Accepted> {
  const id = randomUUID();
  const validatedAt = new Date().toISOString();
  await queue.publish(COMMANDS.ucValidate, {
    messageId: id, type: COMMANDS.ucValidate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId, ucId,
      status: body.status,
      remarks: body.remarks ?? null,
      validatedAt,
      applicationId: meta.applicationId,
      installmentNo: meta.installmentNo,
    },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "uc", meta.applicationId));
  await cache.invalidate(cache.makeKey(ctx.tenantId, "uc", ucId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
