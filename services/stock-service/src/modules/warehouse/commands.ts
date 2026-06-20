import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateWarehouseBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createWarehouse(ctx: RequestContext, body: CreateWarehouseBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.warehouseCreate, {
    messageId: id, type: COMMANDS.warehouseCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
