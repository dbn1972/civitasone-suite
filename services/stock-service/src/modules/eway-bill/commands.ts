import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateEwayBillBody, CancelEwayBillBody, UpdateVehicleBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function generateEwayBill(ctx: RequestContext, body: CreateEwayBillBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.ewbGenerate, {
    messageId: id, type: COMMANDS.ewbGenerate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function cancelEwayBill(ctx: RequestContext, ewayBillId: string, body: CancelEwayBillBody): Promise<Accepted> {
  await queue.publish(COMMANDS.ewbCancel, {
    messageId: randomUUID(), type: COMMANDS.ewbCancel,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ewayBillId, tenantId: ctx.tenantId, reason: body.reason },
  });
  return { id: ewayBillId, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateEwayBillVehicle(ctx: RequestContext, ewayBillId: string, body: UpdateVehicleBody): Promise<Accepted> {
  await queue.publish(COMMANDS.ewbUpdateVehicle, {
    messageId: randomUUID(), type: COMMANDS.ewbUpdateVehicle,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ewayBillId, tenantId: ctx.tenantId, vehicleNo: body.vehicleNo, transportMode: body.transportMode },
  });
  return { id: ewayBillId, status: "accepted", correlationId: ctx.correlationId };
}
