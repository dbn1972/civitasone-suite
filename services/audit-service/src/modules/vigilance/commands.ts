import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  IntakeBody, ScreenBody, AssignIoBody, EvidenceBody, FindingsBody, ProposeActionBody, DecideActionBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function invalidate(ctx: RequestContext, id: string): Promise<void> {
  return cache.invalidate(cache.makeKey(ctx.tenantId, "vigilance", id));
}

export async function intakeCase(ctx: RequestContext, body: IntakeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.vigilanceIntake, {
    messageId: id, type: COMMANDS.vigilanceIntake,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "vigilance", "list:50:0"));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function screenCase(ctx: RequestContext, caseId: string, body: ScreenBody): Promise<Accepted> {
  await queue.publish(COMMANDS.vigilanceScreen, {
    messageId: randomUUID(), type: COMMANDS.vigilanceScreen,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { caseId, tenantId: ctx.tenantId, ...body },
  });
  await invalidate(ctx, caseId);
  return { id: caseId, status: "accepted", correlationId: ctx.correlationId };
}

export async function assignIo(ctx: RequestContext, caseId: string, body: AssignIoBody): Promise<Accepted> {
  await queue.publish(COMMANDS.vigilanceAssignIo, {
    messageId: randomUUID(), type: COMMANDS.vigilanceAssignIo,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { caseId, tenantId: ctx.tenantId, ...body },
  });
  await invalidate(ctx, caseId);
  return { id: caseId, status: "accepted", correlationId: ctx.correlationId };
}

export async function addEvidence(ctx: RequestContext, caseId: string, body: EvidenceBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.vigilanceEvidence, {
    messageId: id, type: COMMANDS.vigilanceEvidence,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, caseId, tenantId: ctx.tenantId, ...body },
  });
  await invalidate(ctx, caseId);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordFindings(ctx: RequestContext, caseId: string, body: FindingsBody): Promise<Accepted> {
  await queue.publish(COMMANDS.vigilanceFindings, {
    messageId: randomUUID(), type: COMMANDS.vigilanceFindings,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { caseId, tenantId: ctx.tenantId, ...body },
  });
  await invalidate(ctx, caseId);
  return { id: caseId, status: "accepted", correlationId: ctx.correlationId };
}

export async function proposeAction(ctx: RequestContext, caseId: string, body: ProposeActionBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.vigilanceProposeAction, {
    messageId: id, type: COMMANDS.vigilanceProposeAction,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, caseId, tenantId: ctx.tenantId, ...body },
  });
  await invalidate(ctx, caseId);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Maker-checker: a different disciplinary authority approves/rejects the action. */
export async function decideAction(ctx: RequestContext, actionId: string, body: DecideActionBody): Promise<Accepted> {
  await queue.publish(COMMANDS.vigilanceDecideAction, {
    messageId: randomUUID(), type: COMMANDS.vigilanceDecideAction,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { actionId, tenantId: ctx.tenantId, ...body },
  });
  return { id: actionId, status: "accepted", correlationId: ctx.correlationId };
}
