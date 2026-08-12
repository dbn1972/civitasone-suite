/**
 * Trade License routes — issue, renew, cancel, and record payments for
 * municipal trade/business licenses.
 *
 * _Requirements: SVC-TL-01_
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createTradeLicenseBody,
  renewTradeLicenseBody,
  cancelTradeLicenseBody,
  recordPaymentBody,
  uuidParam,
  paginationQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["revenue_admin", "revenue_officer", "revenue_collector", "finance_admin", "super_admin", "tenant_admin"];

export async function tradeLicenseRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: error.message } });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal server error" } });
  });

  // ── POST /v1/revenue/trade-licenses ─────────────────────────────────────────

  app.post("/v1/revenue/trade-licenses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createTradeLicenseBody.parse(req.body);
    return reply.code(202).send({ data: await commands.createTradeLicense(ctx, body as unknown as Record<string, unknown>) });
  });

  // ── GET /v1/revenue/trade-licenses ──────────────────────────────────────────

  app.get("/v1/revenue/trade-licenses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = paginationQuery.parse(req.query);
    return reply.send(await repo.listTradeLicenses(ctx.tenantId, q));
  });

  // ── GET /v1/revenue/trade-licenses/:id ──────────────────────────────────────

  app.get("/v1/revenue/trade-licenses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = uuidParam.parse(req.params);
    const license = await repo.findTradeLicense(ctx.tenantId, id);
    if (!license) throw new HttpError(404, "NOT_FOUND", "trade license not found");
    return reply.send({ data: license });
  });

  // ── POST /v1/revenue/trade-licenses/:id/renew ───────────────────────────────

  app.post("/v1/revenue/trade-licenses/:id/renew", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = renewTradeLicenseBody.parse(req.body);
    return reply.code(202).send({ data: await commands.renewTradeLicense(ctx, id, body as unknown as Record<string, unknown>) });
  });

  // ── POST /v1/revenue/trade-licenses/:id/cancel ──────────────────────────────

  app.post("/v1/revenue/trade-licenses/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = cancelTradeLicenseBody.parse(req.body);
    return reply.code(202).send({ data: await commands.cancelTradeLicense(ctx, id, body as unknown as Record<string, unknown>) });
  });

  // ── POST /v1/revenue/trade-licenses/:id/payment ─────────────────────────────

  app.post("/v1/revenue/trade-licenses/:id/payment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = uuidParam.parse(req.params);
    const body = recordPaymentBody.parse(req.body);
    return reply.code(202).send({ data: await commands.recordLicensePayment(ctx, id, body as unknown as Record<string, unknown>) });
  });
}
