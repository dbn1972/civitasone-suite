import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { cache, queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { MAX_VERSIONS_PER_CONTRACT } from "./domain.js";
import * as repo from "./repo.js";
import { HttpError } from "../../shared/context.js";
import type { CreateVersionBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function invalidateVersionList(ctx: RequestContext, contractId: string): Promise<void> {
  return cache.invalidate(cache.makeKey(ctx.tenantId, "version", `${contractId}:list`));
}

/**
 * Queue creation of a new contract version. The consumer computes the version
 * number and redlines transactionally from the then-current latest version.
 */
export async function createVersion(
  ctx: RequestContext,
  contractId: string,
  body: CreateVersionBody,
): Promise<Accepted> {
  const count = await repo.countVersionsByContract(contractId, ctx.tenantId);
  if (count >= MAX_VERSIONS_PER_CONTRACT) {
    throw new HttpError(
      422,
      "VERSION_LIMIT_REACHED",
      `maximum ${MAX_VERSIONS_PER_CONTRACT} versions per contract reached`,
    );
  }

  const id = randomUUID();
  await queue.publish(COMMANDS.versionCreate, {
    messageId: randomUUID(),
    type: COMMANDS.versionCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, contractId, content: body.content, tenantId: ctx.tenantId },
  });

  await invalidateVersionList(ctx, contractId);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
