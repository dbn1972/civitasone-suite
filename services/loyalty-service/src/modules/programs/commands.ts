/**
 * programs/commands.ts — publishes program mutation commands to the queue.
 * No DB access here; the consumer applies the write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateProgramInput {
  name: string;
  earnRatio: number;
  expiryDays: number | null;
  tierConfig: Record<string, unknown>;
}

export async function createProgram(ctx: RequestContext, body: CreateProgramInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createProgram, id, { id, ...body, status: "draft" });
}

export async function updateProgram(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateProgram, id, { id, version: body.version, patch: body.patch });
}

export async function transitionProgram(
  ctx: RequestContext,
  id: string,
  body: { status: string; version: number },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.transitionProgram, id, { id, status: body.status, version: body.version });
}

export async function archiveProgram(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.archiveProgram, id, { id, version });
}
