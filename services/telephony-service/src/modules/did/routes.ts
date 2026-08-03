/** DID mapping HTTP routes. zod-validated; tenant-scoped; RBAC enforced. */
import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import { createDidMappingBody, idParam, didMappingsListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

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
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDidMapping(ctx, body));
  });

  /** Delete a DID mapping by ID (tenant-scoped). */
  app.delete("/v1/telephony/did-mappings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteDidMapping(ctx, id));
  });
}
