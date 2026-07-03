import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createCategoryBody, updateCategoryBody, reorderCategoryBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/knowledge/categories", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const flatList = await repo.listByTenant(ctx.tenantId);
    const tree = repo.buildTree(flatList);
    return reply.send(tree);
  });

  app.get("/v1/knowledge/categories/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const category = await repo.getById(ctx.tenantId, id);
    if (!category) throw new HttpError(404, "NOT_FOUND", "category not found");
    return reply.send(category);
  });

  app.get("/v1/knowledge/categories/:id/children", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const children = await repo.getChildren(ctx.tenantId, id);
    return reply.send(children);
  });

  app.get("/v1/knowledge/categories/:id/ancestors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const ancestors = await repo.getAncestors(ctx.tenantId, id);
    return reply.send(ancestors);
  });

  app.post("/v1/knowledge/categories", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createCategoryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCategory(ctx, body));
  });

  app.put("/v1/knowledge/categories/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const body = updateCategoryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateCategory(ctx, id, body));
  });

  app.delete("/v1/knowledge/categories/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteCategory(ctx, id));
  });

  app.post("/v1/knowledge/categories/reorder", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = reorderCategoryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reorderCategory(ctx, body));
  });
}
