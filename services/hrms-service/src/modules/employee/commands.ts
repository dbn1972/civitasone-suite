import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateEmployeeBody, ConfirmEmployeeBody } from "./validators.js";
import type { TransferBody, SeparateBody } from "../lifecycle/validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createEmployee(ctx: RequestContext, body: CreateEmployeeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.employeeCreate, {
    messageId: id, type: COMMANDS.employeeCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.put(cache.makeKey(ctx.tenantId, "employee", id), { id, ...body, status: "probation" });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function confirmEmployee(ctx: RequestContext, id: string, body: ConfirmEmployeeBody): Promise<Accepted> {
  await queue.publish(COMMANDS.employeeConfirm, {
    type: COMMANDS.employeeConfirm,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "employee", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function transferEmployee(ctx: RequestContext, id: string, body: TransferBody): Promise<Accepted> {
  await queue.publish(COMMANDS.employeeTransfer, {
    type: COMMANDS.employeeTransfer,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { employeeId: id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "employee", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function separateEmployee(ctx: RequestContext, id: string, body: SeparateBody): Promise<Accepted> {
  await queue.publish(COMMANDS.employeeSeparate, {
    type: COMMANDS.employeeSeparate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { employeeId: id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "employee", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
