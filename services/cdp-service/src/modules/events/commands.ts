/**
 * events/commands.ts — publishes event-ingest commands to the queue.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface IngestEventInput {
  profileId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  source?: string;
}

export async function ingestEvent(ctx: RequestContext, body: IngestEventInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.ingestEventBatch, id, { ...body });
}

export async function ingestEventBatchItem(ctx: RequestContext, body: IngestEventInput): Promise<Accepted> {
  return ingestEvent(ctx, body);
}
