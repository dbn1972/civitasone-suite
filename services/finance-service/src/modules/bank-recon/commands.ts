import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function importStatement(
  ctx: RequestContext,
  body: {
    bankAccountId: string;
    lines: Array<{
      date: string;
      amountMinor: number;
      direction: "debit" | "credit";
      narration?: string | undefined;
      reference?: string | undefined;
    }>;
    statementRef?: string | undefined;
    periodFrom?: string | undefined;
    periodTo?: string | undefined;
    openingMinor?: number | undefined;
    closingMinor?: number | undefined;
  },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.bankStatementImport, {
    messageId: id,
    type: COMMANDS.bankStatementImport,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reconcileStatement(
  ctx: RequestContext,
  statementId: string,
  nearDays: number,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.bankStatementReconcile, {
    messageId: id,
    type: COMMANDS.bankStatementReconcile,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: statementId, tenantId: ctx.tenantId, nearDays },
  });
  return { id: statementId, status: "accepted", correlationId: ctx.correlationId };
}
