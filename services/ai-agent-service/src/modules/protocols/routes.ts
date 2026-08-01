import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { READ_ROLES, ADMIN_ROLES } from "../../shared/roles.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  buildCapabilityDescriptor,
  normalizeCapabilities,
  validateEndpoint,
  validateProtocol,
} from "./domain.js";

const PROTOCOL_ENUM = z.enum(["mcp", "a2a", "openai_tools", "anthropic_tools"]);

const capabilitySchema = z.record(z.unknown());

const createBody = z.object({
  protocol: PROTOCOL_ENUM,
  // Endpoint shape is enforced by the domain so http-vs-https and loopback rules
  // live in one place and surface as a 422 business-rule violation.
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
  // GET /v1/ai/protocols — list registrations (AG-005)
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

  // POST /v1/ai/protocols — register an interop endpoint (AG-005)
  app.post("/v1/ai/protocols", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);

    const protocolError = validateProtocol(body.protocol);
    if (protocolError) {
      throw new HttpError(422, "PROTOCOL_INVALID", protocolError);
    }
    const endpointError = validateEndpoint(body.endpoint);
    if (endpointError) {
      throw new HttpError(422, "ENDPOINT_INVALID", endpointError);
    }

    const id = randomUUID();
    const capabilities = normalizeCapabilities(body.capabilities ?? []);
    const enabled = body.enabled ?? true;

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        protocol: body.protocol,
        endpoint: body.endpoint,
        capabilities: capabilities as unknown as Record<string, unknown>[],
        enabled,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.protocolRegistered,
        eventType: EVENTS.protocolRegistered,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { registrationId: id, protocol: body.protocol },
      });

      await writeAudit(tx, ctx, {
        action: "protocol.register",
        input: body.protocol,
        output: id,
        blocked: false,
        reason: null,
      });
    });

    await cache.invalidateResource(ctx.tenantId, "protocols");

    return reply.status(201).send({
      data: { id, protocol: body.protocol, endpoint: body.endpoint, capabilities, enabled, version: 1 },
    });
  });

  // PATCH /v1/ai/protocols/:id — update a registration (AG-005)
  app.patch("/v1/ai/protocols/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "protocol registration not found");
    }

    if (body.endpoint !== undefined) {
      const endpointError = validateEndpoint(body.endpoint);
      if (endpointError) {
        throw new HttpError(422, "ENDPOINT_INVALID", endpointError);
      }
    }

    const patch: Record<string, unknown> = { updatedBy: ctx.actorId };
    if (body.endpoint !== undefined) patch.endpoint = body.endpoint;
    if (body.capabilities !== undefined) patch.capabilities = normalizeCapabilities(body.capabilities);
    if (body.enabled !== undefined) patch.enabled = body.enabled;

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "registration has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.protocolUpdated,
        eventType: EVENTS.protocolUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { registrationId: id, protocol: existing.protocol, enabled: body.enabled ?? existing.enabled },
      });

      await writeAudit(tx, ctx, {
        action: "protocol.update",
        input: JSON.stringify(Object.keys(patch)),
        output: null,
        blocked: false,
        reason: null,
      });
    });

    await cache.invalidateResource(ctx.tenantId, "protocols");

    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  // GET /v1/ai/protocols/:id/capabilities — discovered capability descriptor (AG-005)
  app.get("/v1/ai/protocols/:id/capabilities", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const key = cache.makeKey(ctx.tenantId, "protocol-capabilities", id);
    const loaded = await cache.getOrLoad(key, async () => {
      const row = await repo.findById(id, ctx.tenantId);
      if (!row) return null;
      return buildCapabilityDescriptor({
        protocol: row.protocol,
        endpoint: row.endpoint,
        enabled: row.enabled,
        capabilities: row.capabilities,
      });
    });

    if (!loaded) {
      throw new HttpError(404, "NOT_FOUND", "protocol registration not found");
    }

    return reply.send({ data: { id, ...loaded } });
  });
}
