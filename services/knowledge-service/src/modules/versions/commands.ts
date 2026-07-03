import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { DocumentVersionView } from "./schema.js";
import type { CreateVersionBody, RestoreVersionBody } from "./validators.js";
import * as repo from "./repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "document-version";

export async function versionCreate(ctx: RequestContext, body: CreateVersionBody): Promise<Accepted> {
  const id = randomUUID();
  const nextVersionNo = (await repo.getLatestVersionNo(ctx.tenantId, body.documentId)) + 1;

  const projected: DocumentVersionView = {
    id,
    tenantId: ctx.tenantId,
    documentId: body.documentId,
    versionNo: nextVersionNo,
    s3Key: body.s3Key,
    sizeBytes: body.sizeBytes ?? null,
    changeNote: body.changeNote ?? "",
    createdBy: ctx.actorId,
    createdAt: new Date(),
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.versionCreate, {
    messageId: id,
    type: COMMANDS.versionCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function versionRestore(ctx: RequestContext, body: RestoreVersionBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.versionRestore, {
    messageId: id,
    type: COMMANDS.versionRestore,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      documentId: body.documentId,
      versionId: body.versionId,
      changeNote: body.changeNote,
    },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
