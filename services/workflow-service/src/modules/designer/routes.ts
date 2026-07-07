/**
 * BPMN Visual Designer — definition CRUD and graph validation routes.
 *
 * Routes:
 *   POST   /v1/workflow/designer/definitions            — create definition → 202
 *   GET    /v1/workflow/designer/definitions            — list definitions
 *   GET    /v1/workflow/designer/definitions/:id        — get single
 *   PATCH  /v1/workflow/designer/definitions/:id        — update (optimistic locking)
 *   DELETE /v1/workflow/designer/definitions/:id        — soft-delete
 *   POST   /v1/workflow/designer/definitions/:id/validate — run graph validation
 *
 * CQRS: writes publish commands → consumer persists. For this iteration the
 * consumer is inline (direct DB write within the route handler's transaction)
 * because the designer module is interactive with immediate feedback needs.
 * Future: extract async consumer when multi-user collaboration is added.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, desc, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { designerDefinitions, type DesignerNode, type DesignerEdge } from "./schema.js";
import { validateGraph } from "./domain.js";
import { parseBpmnXml, exportBpmnXml, BpmnParseError } from "./bpmn-io.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

/** Maximum total elements (nodes + edges) per definition. */
const MAX_ELEMENTS = 500;

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
  /** POST /v1/workflow/designer/definitions — create new definition */
  app.post("/v1/workflow/designer/definitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBodySchema.parse(req.body);

    // Enforce 500 element limit
    const totalElements = body.elements.length + body.edges.length;
    if (totalElements > MAX_ELEMENTS) {
      throw new HttpError(
        400,
        "ELEMENT_LIMIT_EXCEEDED",
        `Total elements (${totalElements}) exceeds maximum of ${MAX_ELEMENTS}`,
      );
    }

    const id = randomUUID();
    await db.insert(designerDefinitions).values({
      id,
      tenantId: ctx.tenantId,
      name: body.name,
      description: body.description ?? null,
      elements: body.elements as DesignerNode[],
      edges: body.edges as DesignerEdge[],
      status: "draft",
      version: 1,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });

    // Publish command for audit trail
    await queue.publish("workflow.designer.definition.created", {
      type: "workflow.designer.definition.created",
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: req.id,
      schemaVersion: "1.0",
      payload: { definitionId: id, name: body.name },
    });

    return reply.code(202).send({
      data: {
        id,
        name: body.name,
        description: body.description ?? null,
        status: "draft",
        version: 1,
        elementCount: body.elements.length,
        edgeCount: body.edges.length,
      },
    });
  });

  /** GET /v1/workflow/designer/definitions — list definitions */
  app.get("/v1/workflow/designer/definitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { page, pageSize } = paginationSchema.parse(req.query);
    const offset = (page - 1) * pageSize;

    const rows = await db
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
      .offset(offset);

    // For total count, use a simpler approach
    const allRows = await db
      .select({ id: designerDefinitions.id })
      .from(designerDefinitions)
      .where(
        and(
          eq(designerDefinitions.tenantId, ctx.tenantId),
          eq(designerDefinitions.status, "draft"),
        ),
      );

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

    const rows = await db
      .select()
      .from(designerDefinitions)
      .where(
        and(
          eq(designerDefinitions.id, id),
          eq(designerDefinitions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row || row.status === "deleted") {
      throw new HttpError(404, "NOT_FOUND", "designer definition not found");
    }

    return reply.send({ data: row });
  });

  /** PATCH /v1/workflow/designer/definitions/:id — update with optimistic locking */
  app.patch("/v1/workflow/designer/definitions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateBodySchema.parse(req.body);

    // Enforce 500 element limit on updates
    if (body.elements !== undefined || body.edges !== undefined) {
      const elemCount = body.elements?.length ?? 0;
      const edgeCount = body.edges?.length ?? 0;
      if (elemCount + edgeCount > MAX_ELEMENTS) {
        throw new HttpError(
          400,
          "ELEMENT_LIMIT_EXCEEDED",
          `Total elements (${elemCount + edgeCount}) exceeds maximum of ${MAX_ELEMENTS}`,
        );
      }
    }

    const result = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(designerDefinitions)
        .where(
          and(
            eq(designerDefinitions.id, id),
            eq(designerDefinitions.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);

      const existing = rows[0];
      if (!existing || existing.status === "deleted") {
        throw new HttpError(404, "NOT_FOUND", "designer definition not found");
      }

      // Optimistic locking: version must match
      if (existing.version !== body.version) {
        throw new HttpError(
          409,
          "VERSION_CONFLICT",
          `Version conflict: expected ${body.version}, current is ${existing.version}`,
        );
      }

      // If only partial update (elements/edges not provided), validate existing + new
      const newElements = body.elements !== undefined ? body.elements as DesignerNode[] : existing.elements as DesignerNode[];
      const newEdges = body.edges !== undefined ? body.edges as DesignerEdge[] : existing.edges as DesignerEdge[];

      // Re-check limit with actual values being stored
      if (newElements.length + newEdges.length > MAX_ELEMENTS) {
        throw new HttpError(
          400,
          "ELEMENT_LIMIT_EXCEEDED",
          `Total elements (${newElements.length + newEdges.length}) exceeds maximum of ${MAX_ELEMENTS}`,
        );
      }

      const updateData: Record<string, unknown> = {
        version: existing.version + 1,
        updatedAt: new Date(),
        updatedBy: ctx.actorId,
      };
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.elements !== undefined) updateData.elements = newElements;
      if (body.edges !== undefined) updateData.edges = newEdges;

      await tx
        .update(designerDefinitions)
        .set(updateData)
        .where(eq(designerDefinitions.id, id));

      return { ...existing, ...updateData };
    });

    return reply.send({
      data: {
        id,
        name: result.name,
        version: result.version,
        status: result.status,
        updatedAt: result.updatedAt,
      },
    });
  });

  /** DELETE /v1/workflow/designer/definitions/:id — soft-delete */
  app.delete("/v1/workflow/designer/definitions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await db
      .select()
      .from(designerDefinitions)
      .where(
        and(
          eq(designerDefinitions.id, id),
          eq(designerDefinitions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);

    const existing = rows[0];
    if (!existing || existing.status === "deleted") {
      throw new HttpError(404, "NOT_FOUND", "designer definition not found");
    }

    await db
      .update(designerDefinitions)
      .set({ status: "deleted", updatedAt: new Date(), updatedBy: ctx.actorId })
      .where(eq(designerDefinitions.id, id));

    return reply.code(204).send();
  });

  /** POST /v1/workflow/designer/definitions/:id/validate — run graph validation */
  app.post("/v1/workflow/designer/definitions/:id/validate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await db
      .select()
      .from(designerDefinitions)
      .where(
        and(
          eq(designerDefinitions.id, id),
          eq(designerDefinitions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);

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

  /** POST /v1/workflow/designer/definitions/:id/import — import BPMN XML into definition */
  app.post("/v1/workflow/designer/definitions/:id/import", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const body = z.object({
      xml: z.string().min(1),
    }).parse(req.body);

    // Look up existing definition
    const rows = await db
      .select()
      .from(designerDefinitions)
      .where(
        and(
          eq(designerDefinitions.id, id),
          eq(designerDefinitions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);

    const existing = rows[0];
    if (!existing || existing.status === "deleted") {
      throw new HttpError(404, "NOT_FOUND", "designer definition not found");
    }

    // Parse the BPMN XML (will throw BpmnParseError on invalid input)
    const parsed = parseBpmnXml(body.xml);

    // Enforce 500 element limit
    const totalElements = parsed.nodes.length + parsed.edges.length;
    if (totalElements > MAX_ELEMENTS) {
      throw new HttpError(
        400,
        "ELEMENT_LIMIT_EXCEEDED",
        `Imported BPMN contains ${totalElements} elements, exceeding maximum of ${MAX_ELEMENTS}`,
      );
    }

    // Update the definition with imported elements
    await db
      .update(designerDefinitions)
      .set({
        elements: parsed.nodes,
        edges: parsed.edges,
        version: existing.version + 1,
        updatedAt: new Date(),
        updatedBy: ctx.actorId,
      })
      .where(eq(designerDefinitions.id, id));

    return reply.code(200).send({
      data: {
        id,
        processName: parsed.processName,
        elementCount: parsed.nodes.length,
        edgeCount: parsed.edges.length,
        version: existing.version + 1,
      },
    });
  });

  /** GET /v1/workflow/designer/definitions/:id/export — export definition as BPMN 2.0 XML */
  app.get("/v1/workflow/designer/definitions/:id/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const rows = await db
      .select()
      .from(designerDefinitions)
      .where(
        and(
          eq(designerDefinitions.id, id),
          eq(designerDefinitions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);

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
