/**
 * visitor-service: check-in / check-out command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern, per
 * structure.md). Each function publishes a check-in or check-out command
 * to SQS for the consumer (./consumer.ts) to process transactionally.
 *
 * The verify endpoint (POST /v1/visitor/passes/verify) is synchronous and
 * does NOT use these publishers — it reads directly, never writes.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface CheckInRecordInput {
  passId: string;
  gateId: string;
  gateTerminalId?: string | null;
  offlineRecorded?: boolean;
  verificationMethod?: string | null;
  timestamp?: string | null; // ISO; consumer defaults to now() when absent
}

/**
 * Publishes a check-in record command (Requirement 6.1). The consumer
 * (./consumer.ts) will insert the check-in row, transition the pass status
 * via domain.ts, and emit outbox events.
 */
export async function checkInRecord(ctx: RequestContext, input: CheckInRecordInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.checkInRecord, {
    messageId: id,
    type: COMMANDS.checkInRecord,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      checkInId: id,
      passId: input.passId,
      gateId: input.gateId,
      ...(input.gateTerminalId != null ? { gateTerminalId: input.gateTerminalId } : {}),
      offlineRecorded: input.offlineRecorded ?? false,
      ...(input.verificationMethod != null ? { verificationMethod: input.verificationMethod } : {}),
      ...(input.timestamp != null ? { timestamp: input.timestamp } : {}),
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface CheckOutRecordInput {
  passId: string;
  gateId: string;
  gateTerminalId?: string | null;
  offlineRecorded?: boolean;
  verificationMethod?: string | null;
  timestamp?: string | null;
}

/**
 * Publishes a check-out record command (Requirement 6.1). The consumer
 * (./consumer.ts) will insert the check-out row, transition the pass status,
 * compute visit duration, and emit outbox events.
 */
export async function checkOutRecord(ctx: RequestContext, input: CheckOutRecordInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.checkOutRecord, {
    messageId: id,
    type: COMMANDS.checkOutRecord,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      checkOutId: id,
      passId: input.passId,
      gateId: input.gateId,
      ...(input.gateTerminalId != null ? { gateTerminalId: input.gateTerminalId } : {}),
      offlineRecorded: input.offlineRecorded ?? false,
      ...(input.verificationMethod != null ? { verificationMethod: input.verificationMethod } : {}),
      ...(input.timestamp != null ? { timestamp: input.timestamp } : {}),
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
