import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createUnitBody, updateUnitBody, bulkSyncBody, idParam, hierarchyTreeSchema, unitViewSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { cache } from "../../shared/infra.js";
import { RESOURCES } from "../../topics.js";

const HIERARCHY_ROLES = ["location_admin", "super_admin", "admin"];

export async function hierarchyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hierarchy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HIERARCHY_ROLES);
    const all = await repo.listAllByTenant(ctx.tenantId);

    // Build tree
    type TreeNode = (typeof all)[number] & { children: TreeNode[] };
    const nodeById = new Map<string, TreeNode>();
    for (const row of all) nodeById.set(row.id, { ...row, children: [] });

    const roots: TreeNode[] = [];
    for (const node of nodeById.values()) {
      const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name);
    const sortTree = (nodes: TreeNode[]) => {
      nodes.sort(byName);
      for (const n of nodes) sortTree(n.children);
    };
    sortTree(roots);

    sendValidated(reply, hierarchyTreeSchema, { data: roots });
  });

  app.get("/v1/hierarchy/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HIERARCHY_ROLES);
    const { id } = idParam.parse(req.params);
    const unit = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCES.unit, id),
      () => repo.findById(id, ctx.tenantId),
    );
    if (!unit) throw new HttpError(404, "NOT_FOUND", "administrative unit not found");
    return reply.send(unit);
  });

  app.post("/v1/hierarchy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HIERARCHY_ROLES);
    const body = createUnitBody.parse(req.body);
    if (body.parentId) {
      const parent = await repo.findById(body.parentId, ctx.tenantId);
      if (!parent) throw new HttpError(400, "INVALID_PARENT", "Parent unit does not exist in this tenant");
    }
    sendAccepted(reply, acceptedResponseSchema, await commands.unitCreate(ctx, body));
  });

  app.put("/v1/hierarchy/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HIERARCHY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateUnitBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "administrative unit not found");
    sendAccepted(reply, acceptedResponseSchema, await commands.unitUpdate(ctx, id, body));
  });

  app.post("/v1/hierarchy/bulk-sync", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HIERARCHY_ROLES);
    const body = bulkSyncBody.parse(req.body);
    return reply.code(202).send(await commands.unitBulkSync(ctx, body));
  });

  app.get("/v1/hierarchy/:id/children", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HIERARCHY_ROLES);
    const { id } = idParam.parse(req.params);
    const unit = await repo.findById(id, ctx.tenantId);
    if (!unit) throw new HttpError(404, "NOT_FOUND", "administrative unit not found");
    const children = await repo.findChildren(id, ctx.tenantId);
    return reply.send({ data: children });
  });

  app.get("/v1/hierarchy/:id/ancestors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HIERARCHY_ROLES);
    const { id } = idParam.parse(req.params);
    const ancestors = await repo.findAncestors(id, ctx.tenantId);
    return reply.send({ data: ancestors });
  });

  app.get("/v1/hierarchy/:id/descendants", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HIERARCHY_ROLES);
    const { id } = idParam.parse(req.params);
    const descendants = await repo.findDescendants(id, ctx.tenantId);
    return reply.send({ data: descendants });
  });
}
