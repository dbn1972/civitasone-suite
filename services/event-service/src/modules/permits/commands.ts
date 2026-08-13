import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function issuePermit(
  ctx: RequestContext,
  applicationId: string,
  validFrom: string,
  validUntil: string,
  conditions?: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issuePermit, id, {
    id,
    applicationId,
    validFrom,
    validUntil,
    conditions,
  });
}

export async function revokePermit(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.revokePermit, id, { id, reason });
}
