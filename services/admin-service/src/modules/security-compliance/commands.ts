import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function pub(ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(type, {
    messageId: randomUUID(), type, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const ingestVaptReport = (ctx: RequestContext, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.vaptReportIngest, randomUUID(), body);

export const seedComplianceControls = (ctx: RequestContext) =>
  pub(ctx, COMMANDS.complianceControlsSeed, randomUUID(), {});

export const createComplianceControl = (ctx: RequestContext, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.complianceControlCreate, randomUUID(), body);

export const updateComplianceControl = (ctx: RequestContext, id: string, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.complianceControlUpdate, id, body);

export const attachControlEvidence = (ctx: RequestContext, controlId: string, body: Record<string, unknown>) =>
  pub(ctx, COMMANDS.complianceEvidenceAttach, randomUUID(), { controlId, ...body });
