import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateQuarterBody, ApplyAllotmentBody, AllotBody,
  OccupyBody, VacationNoticeBody, VacateBody, CreateLicenceFeeRateBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId: id, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
}

export async function createQuarter(ctx: RequestContext, body: CreateQuarterBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.quarterCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function applyForAllotment(ctx: RequestContext, body: ApplyAllotmentBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.quarterApply, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function allotQuarter(ctx: RequestContext, allotmentId: string, body: AllotBody): Promise<Accepted> {
  await publish(COMMANDS.quarterAllot, ctx, allotmentId, { id: allotmentId, tenantId: ctx.tenantId, ...body });
  return { id: allotmentId, status: "accepted", correlationId: ctx.correlationId };
}

export async function occupyQuarter(ctx: RequestContext, allotmentId: string, body: OccupyBody): Promise<Accepted> {
  await publish(COMMANDS.quarterOccupy, ctx, allotmentId, { id: allotmentId, tenantId: ctx.tenantId, ...body });
  return { id: allotmentId, status: "accepted", correlationId: ctx.correlationId };
}

export async function issueVacationNotice(ctx: RequestContext, allotmentId: string, body: VacationNoticeBody): Promise<Accepted> {
  await publish(COMMANDS.quarterVacationNotice, ctx, allotmentId, { id: allotmentId, tenantId: ctx.tenantId, ...body });
  return { id: allotmentId, status: "accepted", correlationId: ctx.correlationId };
}

export async function vacateQuarter(ctx: RequestContext, allotmentId: string, body: VacateBody): Promise<Accepted> {
  await publish(COMMANDS.quarterVacate, ctx, allotmentId, { id: allotmentId, tenantId: ctx.tenantId, ...body });
  return { id: allotmentId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createLicenceFeeRate(ctx: RequestContext, body: CreateLicenceFeeRateBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.quarterLicenceFeeRate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
