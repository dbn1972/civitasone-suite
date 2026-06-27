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
