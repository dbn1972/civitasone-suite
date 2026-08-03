import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface SubmitDeclarationBody {
  employeeId: string;
  fy: string;
  regime: "old" | "new";
  section80c: number;
  section80d: number;
  otherDeductions: number;
  rentPaidMinor: number;
  prevEmployerSalaryMinor?: number | undefined;
  otherSourcesIncomeMinor?: number | undefined;
  perquisitesMinor?: number | undefined;
}

export interface UpsertExemptionCeilingBody {
  fyStartYear: number;
  section: "10_10" | "10_10AA" | "10_10B" | "10_10C";
  ceilingMinor: string;
  notes?: string | undefined;
}

export interface UpsertPerquisiteComponentBody {
  employeeId: string;
  fy: string;
  nature: string;
  description?: string | undefined;
  valueByEmployer: number;
  amountRecovered?: number | undefined;
}

export async function submitDeclaration(ctx: RequestContext, body: SubmitDeclarationBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.taxDeclarationSubmit, {
    messageId: id,
    type: COMMANDS.taxDeclarationSubmit,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function upsertExemptionCeiling(
  ctx: RequestContext,
  body: UpsertExemptionCeilingBody,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.exemptionCeilingUpsert, {
    messageId: id,
    type: COMMANDS.exemptionCeilingUpsert,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function upsertPerquisiteComponent(
  ctx: RequestContext,
  body: UpsertPerquisiteComponentBody,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.perquisiteComponentUpsert, {
    messageId: id,
    type: COMMANDS.perquisiteComponentUpsert,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
