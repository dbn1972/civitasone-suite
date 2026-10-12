import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { CreateCycleBody } from "./validators.js";

export type { Accepted };

/**
 * POST /v1/smarttransfer/cycles write path (house rule 1):
 * route → zod → command `smarttransfer.cycle.create` with an explicit
 * messageId → 202 {commandId, statusUrl}. The entity id is generated here and
 * carried in the payload; the command id (messageId) is distinct (publish.ts).
 *
 * jurisdictionUnitId is taken from the SERVER context (the caller's first
 * jurisdiction claim, D-ST-04/D-ST-11) — never from the request body.
 */
export async function createCycle(ctx: RequestContext, body: CreateCycleBody): Promise<Accepted> {
  const id = randomUUID();
  const jurisdictionUnitId = ctx.jurisdictionUnitIds?.[0] ?? null;
  return publishCommand(ctx, COMMANDS.createCycle, {
    id,
    name: body.name,
    movementTypeId: body.movementTypeId,
    calendar: body.calendar,
    jurisdictionUnitId,
  });
}
