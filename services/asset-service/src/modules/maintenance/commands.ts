import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { MaintenancePlanBody, WorkOrderBody, CompleteWorkOrderBody, MeterReadingBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createMaintenancePlan(ctx: RequestContext, assetId: string, body: MaintenancePlanBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.maintenancePlan, {
    messageId: id, type: COMMANDS.maintenancePlan,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, assetId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createWorkOrder(ctx: RequestContext, body: WorkOrderBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.workOrderCreate, {
    messageId: id, type: COMMANDS.workOrderCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeWorkOrder(ctx: RequestContext, workOrderId: string, body: CompleteWorkOrderBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.workOrderComplete, {
    messageId: id, type: COMMANDS.workOrderComplete,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: workOrderId, tenantId: ctx.tenantId, ...body },
  });
  return { id: workOrderId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createMeterReading(ctx: RequestContext, assetId: string, body: MeterReadingBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.meterReadingRecord, {
    messageId: id, type: COMMANDS.meterReadingRecord,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, assetId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
