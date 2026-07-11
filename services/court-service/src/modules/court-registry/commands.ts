import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deriveCourtId, deriveBenchId } from "./domain.js";
import {
  createCourtBody, type CreateCourtBody,
  createBenchBody, type CreateBenchBody,
} from "./validators.js";

export type CreateCourtResult = { accepted: true; courtId: string };
export type CreateBenchResult = { accepted: true; benchId: string };

/**
 * Create a court/authority (§7). The court id is deterministic on
 * (tenantId + establishmentCode) when a code is supplied, so a duplicate submit
 * produces the SAME messageId AND the SAME courtId → the consumer's
 * markProcessed dedupe is a true no-op (idempotent end-to-end).
 */
export async function createCourt(ctx: RequestContext, input: CreateCourtBody): Promise<CreateCourtResult> {
  const body = createCourtBody.parse(input);
  const courtId = deriveCourtId(ctx.tenantId, body.establishmentCode, randomUUID());

  await queue.publish(COMMANDS.createCourt, {
    messageId: courtId,
    type: COMMANDS.createCourt,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: courtId, tenantId: ctx.tenantId },
  });

  return { accepted: true, courtId };
}

/** Create a bench under a court (§5.2). Bench id is deterministic per (court, name). */
export async function createBench(ctx: RequestContext, courtId: string, input: CreateBenchBody): Promise<CreateBenchResult> {
  const body = createBenchBody.parse(input);
  const benchId = deriveBenchId(ctx.tenantId, courtId, body.name);

  await queue.publish(COMMANDS.createBench, {
    messageId: benchId,
    type: COMMANDS.createBench,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: benchId, courtId, tenantId: ctx.tenantId },
  });

  return { accepted: true, benchId };
}
