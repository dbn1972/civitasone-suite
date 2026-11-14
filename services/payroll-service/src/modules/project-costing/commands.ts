import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

type Accepted = { id: string; status: string; correlationId: string };

export type AllocationRequestPayload = {
  id: string; employeeId: string; targetType: "project" | "cost_center"; projectId: string | null; costCenterId: string;
  splitPct: number; effectiveFrom: string; effectiveTo: string | null; note: string | null;
};
export type AllocationDecidePayload = { id: string; decision: "approve" | "reject"; note: string | null };
export type AllocationEndPayload = { id: string; effectiveTo: string };
export type CostingSettingsPayload = { enabled?: boolean | undefined; minCohort?: number | undefined };
export type CostGeneratePayload = { runId: string };

async function publish(ctx: RequestContext, type: string, id: string, payload: unknown): Promise<Accepted> {
  await queue.publish(type, {
    messageId: randomUUID(), type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const requestAllocation = (ctx: RequestContext, p: Omit<AllocationRequestPayload, "id">): Promise<Accepted> => {
  const id = randomUUID();
  return publish(ctx, COMMANDS.costAllocationRequest, id, { ...p, id });
};
export const decideAllocation = (ctx: RequestContext, p: AllocationDecidePayload): Promise<Accepted> =>
  publish(ctx, COMMANDS.costAllocationDecide, p.id, p);
export const endAllocation = (ctx: RequestContext, p: AllocationEndPayload): Promise<Accepted> =>
  publish(ctx, COMMANDS.costAllocationEnd, p.id, p);
export const updateCostingSettings = (ctx: RequestContext, p: CostingSettingsPayload): Promise<Accepted> =>
  publish(ctx, COMMANDS.projectCostingSettings, ctx.tenantId, p);
export const generateRunCost = (ctx: RequestContext, p: CostGeneratePayload): Promise<Accepted> =>
  publish(ctx, COMMANDS.projectCostGenerate, p.runId, p);
