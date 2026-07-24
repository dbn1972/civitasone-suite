import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, HttpError } from "../../shared/context.js";
import { isBbpsEnabled } from "./domain.js";
import * as commands from "./commands.js";
import { fetchBillBody, payBillBody } from "./validators.js";

export async function bbpsRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: error.message } });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal server error" } });
  });

  // ── POST /v1/revenue/bbps/fetch-bill ──────────────────────────────────────

  app.post("/v1/revenue/bbps/fetch-bill", async (req, reply) => {
    if (!isBbpsEnabled()) {
      throw new HttpError(403, "BBPS_DISABLED", "BBPS not enabled");
    }
    const ctx = resolveContext(req);
    const body = fetchBillBody.parse(req.body);
    const result = await commands.fetchBill(ctx, body);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/revenue/bbps/pay-bill ────────────────────────────────────────

  app.post("/v1/revenue/bbps/pay-bill", async (req, reply) => {
    if (!isBbpsEnabled()) {
      throw new HttpError(403, "BBPS_DISABLED", "BBPS not enabled");
    }
    const ctx = resolveContext(req);
    const body = payBillBody.parse(req.body);
    const result = await commands.payBill(ctx, body);
    return reply.code(202).send({ data: result });
  });
}
