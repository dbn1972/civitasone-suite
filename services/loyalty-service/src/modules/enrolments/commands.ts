/**
 * enrolments/commands.ts — publishes enrolment mutation commands to the queue.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface EnrolMemberInput {
  programId: string;
  profileId: string;
  tier: string;
}

export async function enrolMember(ctx: RequestContext, body: EnrolMemberInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.enrolMember, id, { id, ...body, status: "active" });
}

export async function updateEnrolmentStatus(
  ctx: RequestContext,
  id: string,
  body: { status: string; version: number },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateEnrolmentStatus, id, { id, status: body.status, version: body.version });
}
