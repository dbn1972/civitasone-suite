/**
 * rates/commands.ts — publishes rate mutation commands to the queue.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateRateInput {
  productId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** bigint paise serialised as string for JSON-safe queue payloads */
  rateValueMinor: string;
  source: string;
}

export async function createRate(ctx: RequestContext, body: CreateRateInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createRate, id, { id, ...body });
}

export async function updateRate(
  ctx: RequestContext,
  id: string,
  body: { version: number; productId: string; patch: Record<string, unknown>; eventPatch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateRate, id, {
    id,
    version: body.version,
    productId: body.productId,
    patch: body.patch,
    eventPatch: body.eventPatch,
  });
}

export async function recordRateExternalRef(
  ctx: RequestContext,
  rateId: string,
  body: {
    productId: string;
    sourceSystem: string;
    externalId: string;
    syncedAt: string;
    previousVersion: number;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.recordRateExternalRef, rateId, { rateId, ...body });
}

