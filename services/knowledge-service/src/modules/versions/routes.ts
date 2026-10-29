import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createVersionBody, restoreVersionBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { clearedAccessLevels } from "../documents/clearance.js";
import { getDocumentById } from "../documents/queries.js";
import type { RequestContext } from "@civitasone/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A version is as confidential as its document. A caller below the document's
 * access level (or for a document that cannot be found) gets the same 404 as a
 * missing version, before any version row or cached list is read.
 */
async function assertDocumentVisible(ctx: RequestContext, documentId: string): Promise<void> {
  const levels = clearedAccessLevels(ctx);
  if (!levels) return;
  if (!UUID_RE.test(documentId) || !(await getDocumentById(ctx.tenantId, documentId, levels))) {
    throw new HttpError(404, "NOT_FOUND", "version not found");
  }
}

/** CLOS2-S5-02: documentId/versionId are uuid columns; reject malformed ids as 404 (not a 22P02 500). */
function requireUuid(...ids: string[]): void {
  if (ids.some((id) => !UUID_RE.test(id))) throw new HttpError(404, "NOT_FOUND", "version not found");
}

const ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/knowledge/documents/:documentId/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { documentId } = req.params as { documentId: string };
    requireUuid(documentId);
    const q = listQuerySchema.parse(req.query);
    await assertDocumentVisible(ctx, documentId);
    const data = await repo.listByDocument(ctx.tenantId, documentId, q.limit, q.offset);
    return reply.send(data);
  });

  app.get("/v1/knowledge/documents/:documentId/versions/:versionId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { documentId, versionId } = req.params as { documentId: string; versionId: string };
    requireUuid(documentId, versionId);
    await assertDocumentVisible(ctx, documentId);
    const version = await repo.getById(ctx.tenantId, versionId);
    if (!version || version.documentId !== documentId) {
      throw new HttpError(404, "NOT_FOUND", "version not found");
    }
    return reply.send(version);
  });

  app.post("/v1/knowledge/documents/:documentId/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { documentId } = req.params as { documentId: string };
    requireUuid(documentId);
    await assertDocumentVisible(ctx, documentId);
    const body = createVersionBody.parse({ ...(req.body as object), documentId });
    return sendAccepted(reply, acceptedResponseSchema, await commands.versionCreate(ctx, body));
  });

  app.post("/v1/knowledge/documents/:documentId/versions/:versionId/restore", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { documentId, versionId } = req.params as { documentId: string; versionId: string };
    requireUuid(documentId, versionId);
    await assertDocumentVisible(ctx, documentId);
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    const body = restoreVersionBody.parse({ documentId, versionId, ...rawBody });
    // UAT W6 P1: the version must exist in this tenant AND belong to the document in
    // the path (same rule as the GET above); otherwise 404, nothing is published.
    const version = await repo.getById(ctx.tenantId, versionId);
    if (!version || version.documentId !== documentId) {
      throw new HttpError(404, "NOT_FOUND", "version not found");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.versionRestore(ctx, body));
  });
}
