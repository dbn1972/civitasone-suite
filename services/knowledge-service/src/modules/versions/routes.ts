import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createVersionBody, restoreVersionBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/knowledge/documents/:documentId/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { documentId } = req.params as { documentId: string };
    const q = listQuerySchema.parse(req.query);
    const data = await repo.listByDocument(ctx.tenantId, documentId, q.limit, q.offset);
    return reply.send(data);
  });

  app.get("/v1/knowledge/documents/:documentId/versions/:versionId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { documentId, versionId } = req.params as { documentId: string; versionId: string };
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
    const body = createVersionBody.parse({ ...(req.body as object), documentId });
    return sendAccepted(reply, acceptedResponseSchema, await commands.versionCreate(ctx, body));
  });

  app.post("/v1/knowledge/documents/:documentId/versions/:versionId/restore", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { documentId, versionId } = req.params as { documentId: string; versionId: string };
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    const body = restoreVersionBody.parse({ documentId, versionId, ...rawBody });
    return sendAccepted(reply, acceptedResponseSchema, await commands.versionRestore(ctx, body));
  });
}
