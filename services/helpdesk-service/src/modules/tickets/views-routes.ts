/**
 * TKT-11: Saved Views
 *
 * GET    /v1/helpdesk/tickets/views     — list user's saved views
 * POST   /v1/helpdesk/tickets/views     — create a view (command → 202)
 * PATCH  /v1/helpdesk/tickets/views/:id — update a view (command → 202)
 * DELETE /v1/helpdesk/tickets/views/:id — delete a view (command → 202)
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and, or } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { savedViews, type SavedViewRow } from "./views-schema.js";
import { VIEW_COMMANDS } from "../../topics.js";

const ALLOWED_ROLES = ["helpdesk_admin", "helpdesk_user", "super_admin", "tenant_admin"];

const createViewBody = z.object({
  name: z.string().min(1).max(200),
  filters: z.record(z.string(), z.unknown()).default({}),
  columns: z.array(z.string()).default([]),
  shared: z.boolean().optional().default(false),
});

const updateViewBody = z.object({
  name: z.string().min(1).max(200).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  columns: z.array(z.string()).optional(),
  shared: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

const viewIdParam = z.object({
  id: z.string().uuid(),
});

export async function viewsRoutes(app: FastifyInstance): Promise<void> {
  // List views: user's own views + shared views from the same tenant (direct read)
  app.get("/v1/helpdesk/tickets/views", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);

    let rows: SavedViewRow[];
    try {
      rows = await scopedRead(async (tx) => {
        return tx
          .select()
          .from(savedViews)
          .where(
            and(
              eq(savedViews.tenantId, ctx.tenantId),
              or(
                eq(savedViews.ownerId, ctx.actorId),
                eq(savedViews.shared, true),
              ),
            ),
          );
      });
    } catch {
      rows = [];
    }

    return reply.send({ data: rows });
  });

  // Create a view (command → 202)
  app.post("/v1/helpdesk/tickets/views", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const body = createViewBody.parse(req.body);
    const id = randomUUID();

    await queue.publish(VIEW_COMMANDS.create, {
      messageId: id,
      type: VIEW_COMMANDS.create,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        id,
        tenantId: ctx.tenantId,
        ownerId: ctx.actorId,
        name: body.name,
        filters: body.filters,
        columns: body.columns,
        shared: body.shared,
      },
    });

    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  // Update a view (command → 202)
  app.patch("/v1/helpdesk/tickets/views/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const { id } = viewIdParam.parse(req.params);
    const body = updateViewBody.parse(req.body);

    const commandId = randomUUID();
    await queue.publish(VIEW_COMMANDS.update, {
      messageId: commandId,
      type: VIEW_COMMANDS.update,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, actorId: ctx.actorId, ...body },
    });

    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  // Delete a view (command → 202)
  app.delete("/v1/helpdesk/tickets/views/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALLOWED_ROLES);
    const { id } = viewIdParam.parse(req.params);

    const commandId = randomUUID();
    await queue.publish(VIEW_COMMANDS.delete, {
      messageId: commandId,
      type: VIEW_COMMANDS.delete,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, actorId: ctx.actorId },
    });

    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError || (err && typeof err === "object" && "issues" in err && (err as { name?: string }).name === "ZodError")) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
