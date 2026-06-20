import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateLoanBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createLoan(ctx: RequestContext, body: CreateLoanBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.loanCreate, {
    messageId: id, type: COMMANDS.loanCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function disburseLoan(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.loanDisburse, {
    type: COMMANDS.loanDisburse,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "payroll_loan", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
