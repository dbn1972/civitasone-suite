import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { READ_ROLES, ADMIN_ROLES } from "../../shared/roles.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import {
  buildCapabilityDescriptor,
  validateEndpoint,
  validateProtocol,
} from "./domain.js";

const PROTOCOL_ENUM = z.enum(["mcp", "a2a", "openai_tools", "anthropic_tools"]);
const capabilitySchema = z.record(z.unknown());

const createBody = z.object({
  protocol: PROTOCOL_ENUM,
  endpoint: z.string().min(1).max(500),
  capabilities: z.array(capabilitySchema).max(200).optional(),
  enabled: z.boolean().optional(),
});

const updateBody = z.object({
  endpoint: z.string().min(1).max(500).optional(),
  capabilities: z.array(capabilitySchema).max(200).optional(),
  enabled: z.boolean().optional(),
  version: z.number().int().min(1),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  protocol: PROTOCOL_ENUM.optional(),
  enabled: z.enum(["true", "false"]).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function protocolRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/ai/protocols", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);
    const hash = `${q.limit}:${q.offset}:${q.protocol ?? "all"}:${q.enabled ?? "all"}`;
    const key = cache.makeKey(ctx.tenantId, "protocols", hash);
    const loaded = await cache.getOrLoad(key, async () => {
      const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
        ...(q.protocol !== undefined ? { protocol: q.protocol } : {}),
        ...(q.enabled !== undefined ? { enabled: q.enabled === "true" } : {}),
      });
      return { data: rows.map(repo.toView), total };
    });
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: loaded?.data ?? [],
      meta: { page, pageSize: q.limit, total: loaded?.total ?? 0 },
    });
  });

  app.post("/v1/ai/protocols", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    const protocolError = validateProtocol(body.protocol);
    if (protocolError) throw new HttpError(422, "PROTOCOL_INVALID", protocolError);
    const endpointError = validateEndpoint(body.endpoint);
    if (endpointError) throw new HttpError(422, "ENDPOINT_INVALID", endpointError);
    return reply.code(202).send(await commands.registerProtocol(ctx, body));
  });

  app.patch("/v1/ai/protocols/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "protocol registration not found");
    if (body.version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "protocol has been modified; retry with current version");
    }
    if (body.endpoint !== undefined) {
      const endpointError = validateEndpoint(body.endpoint);
      if (endpointError) throw new HttpError(422, "ENDPOINT_INVALID", endpointError);
    }
    return reply.code(202).send(await commands.updateProtocol(ctx, id, body));
  });

  app.get("/v1/ai/protocols/:id/capabilities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const key = cache.makeKey(ctx.tenantId, "protocol-capabilities", id);
    const loaded = await cache.getOrLoad(key, async () => {
      const row = await repo.findById(id, ctx.tenantId);
      if (!row) return null;
      return buildCapabilityDescriptor({
        protocol: row.protocol, endpoint: row.endpoint,
        enabled: row.enabled, capabilities: row.capabilities,
      });
    });
    if (!loaded) throw new HttpError(404, "NOT_FOUND", "protocol registration not found");
    return reply.send({ data: { id, ...loaded } });
  });
}
