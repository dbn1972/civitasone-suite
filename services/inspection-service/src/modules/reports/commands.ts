/**
 * reports write commands — publish to queue for CQRS processing.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface CreateReportBody {
  inspectionId: string;
  entityId: string;
  reportType?: string | undefined;
  summary?: string | undefined;
  recommendations?: string | undefined;
  overallGrade?: string | undefined;
}

export interface AddObservationBody {
  category: string;
  severity: "critical" | "major" | "minor" | "observation";
  description: string;
  location?: string | undefined;
  evidenceIds?: string[] | undefined;
}

export interface SubmitReportBody {
  reportId: string;
}

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId: id, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
}

export async function createReport(ctx: RequestContext, body: CreateReportBody): Promise<Accepted> {
  const id = randomUUID();
  await publish("inspection.report.create", ctx, id, {
    id, tenantId: ctx.tenantId, inspectorId: ctx.actorId, ...body,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function addObservation(ctx: RequestContext, reportId: string, body: AddObservationBody): Promise<Accepted> {
  const id = randomUUID();
  await publish("inspection.report.observation.add", ctx, id, {
    id, tenantId: ctx.tenantId, reportId, ...body,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitReport(ctx: RequestContext, reportId: string): Promise<Accepted> {
  await publish("inspection.report.submit", ctx, reportId, {
    id: reportId, tenantId: ctx.tenantId,
  });
  return { id: reportId, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveReport(ctx: RequestContext, reportId: string): Promise<Accepted> {
  await publish("inspection.report.approve", ctx, reportId, {
    id: reportId, tenantId: ctx.tenantId, approverId: ctx.actorId,
  });
  return { id: reportId, status: "accepted", correlationId: ctx.correlationId };
}
