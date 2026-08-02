/**
 * BPMN Visual Designer — definition CRUD and graph validation routes.
 *
 * Routes:
 *   POST   /v1/workflow/designer/definitions            — create definition → 202
 *   GET    /v1/workflow/designer/definitions            — list definitions
 *   GET    /v1/workflow/designer/definitions/:id        — get single
 *   PATCH  /v1/workflow/designer/definitions/:id        — update (optimistic locking) → 202
 *   DELETE /v1/workflow/designer/definitions/:id        — soft-delete → 202
 *   POST   /v1/workflow/designer/definitions/:id/validate — run graph validation
 *   POST   /v1/workflow/designer/definitions/:id/import — import BPMN XML → 202
 *   GET    /v1/workflow/designer/definitions/:id/export — export as BPMN 2.0 XML
 *
 * CQRS: create/update/delete/import publish a command (see commands.ts) that
 * the consumer (consumer.ts) applies async; each route validates synchronously
 * (existence, optimistic-locking version, element-count limit, BPMN parse) so
 * the caller still gets an immediate 400/404/409, then acknowledges with the
 * standard 202 `sendAccepted` envelope — matching instances/tasks. GET routes
 * (list/single/validate/export) stay synchronous reads.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { designerDefinitions, type DesignerNode, type DesignerEdge } from "./schema.js";
import { validateGraph } from "./domain.js";
import { exportBpmnXml, BpmnParseError } from "./bpmn-io.js";
import * as commands from "./commands.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

// ── Zod Schemas ───────────────────────────────────────────────────

const nodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(64),
  label: z.string().max(200).default(""),
  position: z.object({ x: z.number(), y: z.number() }),
  properties: z.record(z.unknown()).optional(),
});

const edgeSchema = z.object({
  id: z.string().min(1).max(64),
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
  condition: z.string().max(512).optional(),
  waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
});

const createBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  elements: z.array(nodeSchema).default([]),
  edges: z.array(edgeSchema).default([]),
});

const updateBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  elements: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
  version: z.number().int().positive(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

// ── Routes ────────────────────────────────────────────────────────

export async function designerRoutes(app: FastifyInstance): Promise<void> {
  /** POST /v1/workflow/designer/definitions — create new definition (CQRS) */
  app.post("/v1/workflow/designer/definitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBodySchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDefinition(ctx, {
      name: body.name,
      ...(body.description !== undefined ? { description: body.description } : {}),
      elements: body.elements as DesignerNode[],
      edges: body.edges as DesignerEdge[],
    }));
  });

  /** GET /v1/workflow/designer/definitions — list definitions */
  app.get("/v1/workflow/designer/definitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { page, pageSize } = paginationSchema.parse(req.query);
    const offset = (page - 1) * pageSize;

    const rows = await scopedRead((tx) => tx
      .select()
      .from(designerDefinitions)
      .where(
        and(
          eq(designerDefinitions.tenantId, ctx.tenantId),
          eq(designerDefinitions.status, "draft"),
        ),
      )
      .orderBy(desc(designerDefinitions.updatedAt))
      .limit(pageSize)
      .offset(offset));

    // For total count, use a simpler approach
    const allRows = await scopedRead((tx) => tx
      .select({ id: designerDefinitions.id })
      .from(designerDefinitions)
      .where(
        and(
          eq(designerDefinitions.tenantId, ctx.tenantId),
          eq(designerDefinitions.status, "draft"),
        ),
      ));

    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        status: r.status,
        version: r.version,
        elementCount: (r.elements as DesignerNode[]).length,
        edgeCount: (r.edges as DesignerEdge[]).length,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        createdBy: r.createdBy,
        updatedBy: r.updatedBy,
      })),
      meta: { page, pageSize, total: allRows.length },
    });
  });

  /** GET /v1/workflow/designer/definitions/:id — get single */
  app.get("/v1/workflow/designer/definitions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await scopedRead((tx) => tx
      .select()
      .from(designerDefinitions)
      .where(
        and(
          eq(designerDefinitions.id, id),
          eq(designerDefinitions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1));

    const row = rows[0];
    if (!row || row.status === "deleted") {
      throw new HttpError(404, "NOT_FOUND", "designer definition not found");
    }

    return reply.send({ data: row });
  });

  /** PATCH /v1/workflow/designer/definitions/:id — update (optimistic locking, CQRS) */
  app.patch("/v1/workflow/designer/definitions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateBodySchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDefinition(ctx, id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.elements !== undefined ? { elements: body.elements as DesignerNode[] } : {}),
      ...(body.edges !== undefined ? { edges: body.edges as DesignerEdge[] } : {}),
      version: body.version,
    }));
  });

  /** DELETE /v1/workflow/designer/definitions/:id — soft-delete (CQRS) */
  app.delete("/v1/workflow/designer/definitions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteDefinition(ctx, id));
  });

  /** POST /v1/workflow/designer/definitions/:id/validate — run graph validation */
  app.post("/v1/workflow/designer/definitions/:id/validate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await scopedRead((tx) => tx
      .select()
      .from(designerDefinitions)
      .where(
        and(
          eq(designerDefinitions.id, id),
          eq(designerDefinitions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1));

    const existing = rows[0];
    if (!existing || existing.status === "deleted") {
      throw new HttpError(404, "NOT_FOUND", "designer definition not found");
    }

    const result = validateGraph(
      existing.elements as DesignerNode[],
      existing.edges as DesignerEdge[],
    );

    return reply.code(200).send({ data: result });
  });

  /** POST /v1/workflow/designer/definitions/:id/import — import BPMN XML (CQRS) */
  app.post("/v1/workflow/designer/definitions/:id/import", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ xml: z.string().min(1) }).parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.importDefinition(ctx, id, body.xml));
  });

  /** GET /v1/workflow/designer/definitions/:id/export — export definition as BPMN 2.0 XML */
  app.get("/v1/workflow/designer/definitions/:id/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await scopedRead((tx) => tx
      .select()
      .from(designerDefinitions)
      .where(
        and(
          eq(designerDefinitions.id, id),
          eq(designerDefinitions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1));

    const existing = rows[0];
    if (!existing || existing.status === "deleted") {
      throw new HttpError(404, "NOT_FOUND", "designer definition not found");
    }

    const xml = exportBpmnXml({
      id: existing.id,
      name: existing.name,
      elements: existing.elements as DesignerNode[],
      edges: existing.edges as DesignerEdge[],
    });

    return reply
      .header("Content-Type", "application/xml")
      .header(
        "Content-Disposition",
        `attachment; filename="${existing.name.replace(/[^a-zA-Z0-9\-_]/g, "_")}.bpmn"`,
      )
      .send(xml);
  });

  // Error handler scoped to this plugin
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "invalid request",
          details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
          correlationId,
        },
      });
    }
    if (err instanceof BpmnParseError) {
      return reply.code(400).send({
        error: { code: err.code, message: err.message, correlationId },
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({
        error: { code: err.code, message: err.message, correlationId },
      });
    }
    req.log.error({ err }, "unhandled error in designer routes");
    return reply.code(500).send({
      error: { code: "INTERNAL", message: "internal error", correlationId },
    });
  });
}
