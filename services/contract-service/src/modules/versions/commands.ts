import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { cache } from "../../shared/infra.js";
import { computeRedlines, MAX_VERSIONS_PER_CONTRACT } from "./domain.js";
import * as repo from "./repo.js";
import { HttpError } from "../../shared/context.js";
import type { CreateVersionBody } from "./validators.js";

export type Accepted = { id: string; versionNumber: number; status: string; correlationId: string };

function invalidateVersionList(ctx: RequestContext, contractId: string): Promise<void> {
  return cache.invalidate(cache.makeKey(ctx.tenantId, "version", `${contractId}:list`));
}

/**
 * Create a new contract version. Computes redlines from the previous version automatically.
 * Enforces max 100 versions per contract at the route level.
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

  const latestVersion = await repo.getLatestVersion(contractId, ctx.tenantId);
  const newVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;

  // Insert the new version
  const versionId = randomUUID();
  await repo.insertVersion({
    id: versionId,
    tenantId: ctx.tenantId,
    contractId,
    versionNumber: newVersionNumber,
    content: body.content,
    createdBy: ctx.actorId,
  });

  // Compute and store redlines from previous version
  if (latestVersion) {
    const redlineChanges = computeRedlines(latestVersion.content, body.content, ctx.actorId);
    if (redlineChanges.length > 0) {
      await repo.insertRedlines(
        redlineChanges.map((rl) => ({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          contractId,
          versionNumber: newVersionNumber,
          position: rl.position,
          type: rl.type,
          content: rl.content,
          actor: rl.actor,
          timestamp: rl.timestamp,
        })),
      );
    }
  }

  await invalidateVersionList(ctx, contractId);

  return {
    id: versionId,
    versionNumber: newVersionNumber,
    status: "created",
    correlationId: ctx.correlationId,
  };
}
