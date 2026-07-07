/**
 * warehouses module — command publishers (CQRS write side).
 */
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateWarehouseInput, UpdateWarehouseInput } from "./validators.js";
import { randomUUID } from "node:crypto";

export async function createWarehouse(ctx: RequestContext, body: CreateWarehouseInput) {
  const id = randomUUID();
  await queue.publish(COMMANDS.warehouseCreate, {
    messageId: id,
    type: COMMANDS.warehouseCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateWarehouse(ctx: RequestContext, id: string, body: UpdateWarehouseInput) {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.warehouseUpdate, {
    messageId,
    type: COMMANDS.warehouseUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
