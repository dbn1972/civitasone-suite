import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function reportViolation(ctx: RequestContext, input: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.reportViolation, id, { id, ...input });
}

export async function issueNotice(ctx: RequestContext, violationId: string, noticeDetails: Record<string, unknown>): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.issueNotice, violationId, { violationId, noticeDetails });
}

export async function imposePenalty(ctx: RequestContext, violationId: string, penaltyMinor: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.imposePenalty, violationId, { violationId, penaltyMinor });
}

export async function orderRemoval(ctx: RequestContext, violationId: string, removalDeadline: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.orderRemoval, violationId, { violationId, removalDeadline });
}

export async function recordRemoval(ctx: RequestContext, violationId: string, removalNotes: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.recordRemoval, violationId, { violationId, removalNotes });
}
