import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { caseIdParam, orderIdParam, recordOrderBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

// Only judicial officers record orders.
const ORDER_WRITE_ROLES = ["judge", "court_admin", "super_admin"];
const ORDER_READ_ROLES = ["registrar", "court_admin", "judge", "court_clerk", "super_admin"];

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  // Record (draft) an order on a case.
  app.post("/v1/court/cases/:id/orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ORDER_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = recordOrderBody.parse(req.body);
    const result = await commands.recordOrder(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's orders.
  app.get("/v1/court/cases/:id/orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ORDER_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const items = await repo.listOrdersByCase(ctx.tenantId, id);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Get a single order.
  app.get("/v1/court/orders/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ORDER_READ_ROLES);
    const { id } = orderIdParam.parse(req.params);
    const order = await repo.getOrderById(ctx.tenantId, id);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", `Order ${id} not found`);
    return reply.send(order);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "order route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
