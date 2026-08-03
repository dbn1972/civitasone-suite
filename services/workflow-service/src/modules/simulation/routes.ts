import { scopedRead } from "../../shared/db.js";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as defRepo from "../definitions/repo.js";
import { simulateProcess } from "./domain.js";
import { compareVersions } from "./compare.js";

const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

export async function simulationRoutes(app: FastifyInstance): Promise<void> {
  /** POST /v1/workflow/definitions/:id/simulate — simulate process execution */
  app.post("/v1/workflow/definitions/:id/simulate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      instances: z.number().int().min(1).max(10000).default(100),
      contextVariants: z.array(z.record(z.unknown())).max(100).optional(),
    }).parse(req.body ?? {});

    const def = await defRepo.findById(id, ctx.tenantId);
    if (!def) throw new HttpError(404, "NOT_FOUND", "definition not found");

    const [nodes, edges] = await Promise.all([defRepo.listNodes(id), defRepo.listEdges(id)]);
    if (nodes.length === 0) {
      throw new HttpError(400, "EMPTY_GRAPH", "definition has no nodes to simulate");
    }

    const result = simulateProcess({
      nodes: nodes.map((n) => ({ nodeKey: n.nodeKey, name: n.name, nodeType: n.nodeType, slaMinutes: n.slaMinutes })),
      edges: edges.map((e) => ({ fromNode: e.fromNode, toNode: e.toNode, condition: e.condition, sortOrder: e.sortOrder })),
      instances: body.instances,
      ...(body.contextVariants !== undefined ? { contextVariants: body.contextVariants } : {}),
    });

    return reply.send({ data: result });
  });

  // CAP-030 — compare two versions of a code by simulating both with identical
  // inputs and reporting the behavioural deltas (path distribution, avg steps).
  app.post("/v1/workflow/definitions/code/:code/simulate-compare", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(req.params);
    const body = z.object({
      from: z.number().int().positive(),
      to: z.number().int().positive(),
      instances: z.number().int().min(1).max(10000).default(100),
      contextVariants: z.array(z.record(z.unknown())).max(100).optional(),
    }).parse(req.body ?? {});

    const graphFor = async (version: number) => {
      const def = await scopedRead((tx) => defRepo.findByCodeVersionTx(tx as any, ctx.tenantId, code, version));
      if (!def) return null;
      const [nodes, edges] = await Promise.all([defRepo.listNodes(def.id), defRepo.listEdges(def.id)]);
      return {
        nodes: nodes.map((n) => ({ nodeKey: n.nodeKey, name: n.name, nodeType: n.nodeType, slaMinutes: n.slaMinutes })),
        edges: edges.map((e) => ({ fromNode: e.fromNode, toNode: e.toNode, condition: e.condition, sortOrder: e.sortOrder })),
      };
    };
    const [from, to] = await Promise.all([graphFor(body.from), graphFor(body.to)]);
    if (!from || !to) throw new HttpError(404, "VERSION_NOT_FOUND", "one or both versions not found");

    const result = compareVersions({
      from, to, instances: body.instances,
      ...(body.contextVariants !== undefined ? { contextVariants: body.contextVariants } : {}),
    });
    return reply.send({ data: result });
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
