import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export async function createApplication(
  ctx: RequestContext,
  input: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createApplication, id, { id, ...input });
}

export async function submitApplication(
  ctx: RequestContext,
  applicationId: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.submitApplication, applicationId, { applicationId });
}

export async function withdrawApplication(
  ctx: RequestContext,
  applicationId: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.withdrawApplication, applicationId, { applicationId });
}
