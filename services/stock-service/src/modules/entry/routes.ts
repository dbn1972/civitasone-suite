import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createEntryBody, physicalVerificationBody, ledgerQueryParams, valuationQueryParams } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import * as valuationQueries from "../valuation/queries.js";

const STOCK_ROLES  = ["stock_manager", "stock_admin", "super_admin", "procurement_officer"];
const READER_ROLES = [...STOCK_ROLES, "audit_officer", "finance_officer"];

export async function entryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/stock/entries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STOCK_ROLES);
    const body = createEntryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createEntry(ctx, body));
  });

  app.get("/v1/stock/ledger", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = ledgerQueryParams.parse(req.query);
    const ledgerOpts: { from?: string; to?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.from !== undefined) ledgerOpts.from = q.from;
    if (q.to !== undefined) ledgerOpts.to = q.to;
    const rows = await repo.findLedger(ctx.tenantId, q.itemId, ledgerOpts);
    return reply.send({ data: rows, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/stock/valuation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = valuationQueryParams.parse(req.query);
    const warehouseId = q.warehouseId ?? "00000000-0000-4000-8000-000000000000";
    const rate = await valuationQueries.getValuationRate(ctx.tenantId, q.itemId, warehouseId);
    if (!rate) throw new HttpError(404, "NOT_FOUND", "valuation rate not found");
    return reply.send({ ...rate, rateMinor: rate.rateMinor.toString() });
  });

  app.post("/v1/stock/physical-verification", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, STOCK_ROLES);
    const body = physicalVerificationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPhysicalVerification(ctx, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
