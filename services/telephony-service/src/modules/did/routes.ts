/** DID mapping HTTP routes. zod-validated; tenant-scoped; RBAC enforced. */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { listQuerySchema } from "@civitasone/schemas/common";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDidMappingBody, idParam, didMappingsListSchema } from "./validators.js";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";

const TELEPHONY_ADMIN_ROLES = ["telephony_supervisor", "telephony_admin", "tenant_admin", "super_admin"];

export async function didRoutes(app: FastifyInstance): Promise<void> {
  /** List DID mappings for the current tenant. */
  app.get("/v1/telephony/did-mappings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ADMIN_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, didMappingsListSchema, await queries.listMappings(ctx.tenantId, q.limit, q.offset));
  });

  /** Create a new DID mapping for the current tenant. */
  app.post("/v1/telephony/did-mappings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ADMIN_ROLES);
    const body = createDidMappingBody.parse(req.body);

    const id = randomUUID();
    await repo.insert(db, {
      id,
      tenantId: ctx.tenantId,
      didNumber: body.didNumber,
      label: body.label ?? null,
      active: body.active,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });

    // Invalidate cached mappings so webhook resolution picks up the new mapping
    await cache.invalidate("global:did-mappings:active");

    return reply.code(201).send({
      data: {
        id,
        tenantId: ctx.tenantId,
        didNumber: body.didNumber,
        label: body.label ?? null,
        active: body.active,
      },
    });
  });

  /** Delete a DID mapping by ID (tenant-scoped). */
  app.delete("/v1/telephony/did-mappings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const deleted = await repo.remove(id, ctx.tenantId);
    if (deleted === 0) throw new HttpError(404, "NOT_FOUND", "DID mapping not found");

    // Invalidate cached mappings
    await cache.invalidate("global:did-mappings:active");

    return reply.code(204).send();
  });
}
