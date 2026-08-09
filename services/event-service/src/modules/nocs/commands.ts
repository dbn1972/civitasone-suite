import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function requestNoc(
  ctx: RequestContext,
  applicationId: string,
  department: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestNoc, id, { id, applicationId, department });
}

export async function respondNoc(
  ctx: RequestContext,
  id: string,
  status: string,
  conditions?: Record<string, unknown>,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.respondNoc, id, { id, status, conditions });
}
