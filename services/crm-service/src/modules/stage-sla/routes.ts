/**
 * G3 — Stage SLA policy HTTP routes.
 * Writes are async-CQRS (validate → queue.publish → 202).
 * Reads are synchronous (cache-backed via repo).
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createSLAPolicyBody, updateSLAPolicyBody, listSLAPolicyQuery, idParam } from "./validators.js";
import { publishCreateSLAPolicy, publishUpdateSLAPolicy, publishDeleteSLAPolicy } from "./commands.js";
import { getSLAPolicy, listSLAPolicies } from "./queries.js";

const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];
const READ_ROLES = ["crm_user", "crm_admin", "tenant_admin", "super_admin"];

export async function stageSLARoutes(app: FastifyInstance): Promise<void> {
  /** List all SLA policies for the tenant. */
  app.get("/v1/crm/stage-sla-policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listSLAPolicyQuery.parse(req.query);
    const activeFilter = q.active === "true" ? true : q.active === "false" ? false : undefined;
    const result = await listSLAPolicies(ctx.tenantId, q.limit, q.offset, activeFilter);
    return reply.send(result);
  });

  /** Get a single SLA policy by ID. */
  app.get("/v1/crm/stage-sla-policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const policy = await getSLAPolicy(id, ctx.tenantId);
    if (!policy) {
      throw new HttpError(404, "NOT_FOUND", "stage SLA policy not found");
    }
    return reply.send({ data: policy });
  });

  /** Create a new SLA policy (async via queue → 202). */
  app.post("/v1/crm/stage-sla-policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createSLAPolicyBody.parse(req.body);
    const { id, correlationId } = await publishCreateSLAPolicy(ctx, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ id, status: "accepted", correlationId });
  });

  /** Update an existing SLA policy (async via queue → 202). */
  app.patch("/v1/crm/stage-sla-policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateSLAPolicyBody.parse(req.body);
    if (Object.keys(body).length === 0) {
      throw new HttpError(400, "EMPTY_BODY", "at least one field must be provided");
    }
    const result = await publishUpdateSLAPolicy(ctx, id, body as unknown as Record<string, unknown>);
    return reply.code(202).send({ id: result.id, status: "accepted", correlationId: result.correlationId });
  });

  /** Soft-delete an SLA policy (async via queue → 202). */
  app.delete("/v1/crm/stage-sla-policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const result = await publishDeleteSLAPolicy(ctx, id);
    return reply.code(202).send({ id: result.id, status: "accepted", correlationId: result.correlationId });
  });
}
