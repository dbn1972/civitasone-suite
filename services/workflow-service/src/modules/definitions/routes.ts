import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { definitions } from "./schema.js";
import * as repo from "./repo.js";
import { validateGraph } from "./graph.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

const nodeSchema = z.object({
  nodeKey: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  roleRef: z.string().max(128).optional(),
  nodeType: z.enum(["task", "split", "parallel", "join", "start", "end", "timer", "xor", "exclusive", "call", "message_catch", "message_throw", "signal_catch", "decision"]).default("task"),
  slaMinutes: z.number().int().positive().optional(),
  // SECURITY C-1b — deemed-approval dwell floor is enforced in validateGraph
  // (timer_minutes must be >= 1). We accept >= 1 here too for a clear 400.
  timerMinutes: z.number().int().positive().optional(),
  // SECURITY C-1/C-3 — explicit opt-in for deemed-approval auto-completion.
  deemedApproval: z.boolean().optional(),
  // Gap 1 — sub-workflow / call-activity.
  callDefinitionCode: z.string().min(1).max(64).optional(),
  callContextMap: z.record(z.string().max(128), z.string().max(128)).optional(),
  // Gap 4 — auto-assignment strategy.
  assignStrategy: z.enum(["none", "round_robin", "least_loaded", "hierarchy"]).optional(),
  assignRef: z.string().max(128).optional(),
  sortOrder: z.number().int().optional(),
  // Message/Signal events
  messageName: z.string().max(128).optional(),
  correlationKeyExpr: z.string().max(256).optional(),
  signalName: z.string().max(128).optional(),
  messageTopic: z.string().max(128).optional(),
  messagePayloadExpr: z.string().max(512).optional(),
  // Decision tables
  decisionTableCode: z.string().max(64).optional(),
  // Compensation
  compensationHandlerKey: z.string().max(64).optional(),
  // Multi-instance
  multiInstanceCollection: z.string().max(128).optional(),
  multiInstanceMode: z.enum(["parallel", "sequential"]).optional(),
  multiInstanceCompletion: z.string().max(32).optional(),
  // Visual designer position
  positionX: z.number().int().optional(),
  positionY: z.number().int().optional(),
});
const edgeSchema = z.object({
  fromNode: z.string().min(1).max(64),
  toNode: z.string().min(1).max(64),
  condition: z.string().max(512).optional(),
  waypoints: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  sortOrder: z.number().int().optional(),
});
const createBody = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  nodes: z.array(nodeSchema).default([]),
  edges: z.array(edgeSchema).default([]),
  layout: z.object({ width: z.number().optional(), height: z.number().optional(), zoom: z.number().optional(), gridSize: z.number().optional() }).optional(),
});

export async function definitionRoutes(app: FastifyInstance): Promise<void> {
  // Create a NEW definition, or — if a definition with this code already exists —
  // create version N+1 (archiving prior versions on deploy). DB-backed + transactional.
  app.post("/v1/workflow/definitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);

    // P0-1 — structural validation. On create we only enforce when a graph is
    // supplied (an empty draft may be filled in later), but a supplied graph
    // must be well-formed before it is persisted.
    if (body.nodes.length > 0 || body.edges.length > 0) {
      const v = validateGraph(body.nodes, body.edges);
      if (!v.valid) {
        throw new HttpError(400, "INVALID_GRAPH", `invalid workflow graph: ${v.errors.join("; ")}`);
      }
    }

    const id = randomUUID();
    const result = await db.transaction(async (tx) => {
      const latest = await repo.findLatestVersionTx(tx, ctx.tenantId, body.code);
      const version = latest ? latest.version + 1 : 1;
      await tx.insert(definitions).values({
        id,
        tenantId: ctx.tenantId,
        code: body.code,
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.layout !== undefined ? { layout: body.layout as { width?: number; height?: number; zoom?: number; gridSize?: number } } : {}),
        version,
        status: "draft",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await repo.insertGraphTx(tx, id, body.nodes, body.edges);
      return { version };
    });

    return reply.code(201).send({
      data: { id, code: body.code, name: body.name, version: result.version, status: "draft" },
    });
  });

  app.get("/v1/workflow/definitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await repo.findByTenant(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows });
  });

  app.get("/v1/workflow/definitions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const def = await repo.findById(id, ctx.tenantId);
    if (!def) throw new HttpError(404, "NOT_FOUND", "definition not found");
    const [nodes, edges] = await Promise.all([repo.listNodes(id), repo.listEdges(id)]);
    return reply.send({ data: { ...def, nodes, edges } });
  });

  // Deploy: activate this version and archive every other version of the same code.
  app.post("/v1/workflow/definitions/:id/deploy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const result = await db.transaction(async (tx) => {
      const def = await repo.findById(id, ctx.tenantId);
      if (!def) throw new HttpError(404, "NOT_FOUND", "definition not found");
      if (def.status === "active") throw new HttpError(409, "ALREADY_DEPLOYED", "definition already deployed");

      // P0-1 — strict structural validation gate on deploy. A definition with a
      // dangling edge target, no terminal, or unreachable nodes is rejected
      // (400) so it can never be activated and strand instances.
      const [nodeRows, edgeRows] = await Promise.all([repo.listNodes(id), repo.listEdges(id)]);
      const v = validateGraph(
        nodeRows.map((n) => ({
          nodeKey: n.nodeKey,
          name: n.name,
          nodeType: n.nodeType,
          timerMinutes: n.timerMinutes,
          deemedApproval: n.deemedApproval,
          callDefinitionCode: n.callDefinitionCode,
          assignStrategy: n.assignStrategy,
          sortOrder: n.sortOrder,
          messageName: n.messageName,
          correlationKeyExpr: n.correlationKeyExpr,
          signalName: n.signalName,
          messageTopic: n.messageTopic,
          decisionTableCode: n.decisionTableCode,
          multiInstanceCollection: n.multiInstanceCollection,
        })),
        edgeRows.map((e) => ({ fromNode: e.fromNode, toNode: e.toNode, condition: e.condition, sortOrder: e.sortOrder })),
      );
      if (!v.valid) {
        throw new HttpError(400, "INVALID_GRAPH", `cannot deploy: ${v.errors.join("; ")}`);
      }

      await tx.update(definitions)
        .set({ status: "active", updatedBy: ctx.actorId, updatedAt: new Date() })
        .where(eq(definitions.id, id));
      await repo.archiveOtherVersionsTx(tx, ctx.tenantId, def.code, id);
      return { def: { ...def, status: "active" }, warnings: v.warnings };
    });

    return reply.send({
      data: result.def,
      message: "definition deployed",
      ...(result.warnings.length ? { warnings: result.warnings } : {}),
    });
  });

  // Gap 7 — list platform/global templates (definitions flagged is_template).
  app.get("/v1/workflow/templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await repo.listTemplates(q.limit, q.offset);
    return reply.send({ data: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, version: r.version, isTemplate: r.isTemplate })) });
  });

  // Gap 7 — clone a template into the caller's tenant as a NEW draft definition
  // (definition + nodes + edges copied). The clone is tenant-scoped, editable,
  // and NOT a template. Optional code override (defaults to the template code);
  // versioned like any new definition for that code in the tenant.
  app.post("/v1/workflow/templates/:id/clone", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      code: z.string().min(1).max(64).optional(),
      name: z.string().min(1).max(200).optional(),
    }).parse(req.body ?? {});

    const tpl = await repo.findTemplateById(id);
    if (!tpl) throw new HttpError(404, "NOT_FOUND", "template not found");

    const code = body.code ?? tpl.code;
    const newId = randomUUID();
    const result = await db.transaction(async (tx) => {
      const latest = await repo.findLatestVersionTx(tx, ctx.tenantId, code);
      const version = latest ? latest.version + 1 : 1;
      await tx.insert(definitions).values({
        id: newId,
        tenantId: ctx.tenantId,
        code,
        name: body.name ?? tpl.name,
        ...(tpl.description !== null ? { description: tpl.description } : {}),
        version,
        status: "draft",
        isTemplate: false,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      const [srcNodes, srcEdges] = await Promise.all([repo.listNodeRows(tpl.id), repo.listEdges(tpl.id)]);
      await repo.insertGraphTx(
        tx,
        newId,
        srcNodes.map((n) => ({
          nodeKey: n.nodeKey,
          name: n.name,
          roleRef: n.roleRef,
          nodeType: n.nodeType,
          slaMinutes: n.slaMinutes,
          timerMinutes: n.timerMinutes,
          deemedApproval: n.deemedApproval,
          callDefinitionCode: n.callDefinitionCode,
          callContextMap: n.callContextMap,
          assignStrategy: n.assignStrategy,
          assignRef: n.assignRef,
          sortOrder: n.sortOrder,
        })),
        srcEdges.map((e) => ({ fromNode: e.fromNode, toNode: e.toNode, condition: e.condition, sortOrder: e.sortOrder })),
      );
      return { version };
    });

    return reply.code(201).send({
      data: { id: newId, code, name: body.name ?? tpl.name, version: result.version, status: "draft", clonedFrom: tpl.id },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
