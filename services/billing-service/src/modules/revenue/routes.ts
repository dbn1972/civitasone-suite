import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createLedgerBody, idParam, listQuery } from "./validators.js";
import { computeTotalDays } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const REVENUE_ROLES = ["finance_officer", "finance_admin", "tenant_admin", "super_admin", "platform_admin"] as const;

export async function revenueRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/billing/revenue/ledgers — Create a revenue recognition ledger entry
   */
  app.post("/v1/billing/revenue/ledgers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...REVENUE_ROLES]);
    const body = createLedgerBody.parse(req.body);

    const totalDays = computeTotalDays(body.servicePeriodStart, body.servicePeriodEnd);
    const totalAmountPaise = BigInt(body.totalAmountPaise);

    const result = await commands.createRevenueLedger(ctx, {
      subscriptionId: body.subscriptionId,
      totalAmountPaise,
      servicePeriodStart: body.servicePeriodStart,
      servicePeriodEnd: body.servicePeriodEnd,
      totalDays,
    });

    return reply.code(202).send({ data: result });
  });

  /**
   * GET /v1/billing/revenue/ledgers — List ledger entries (paginated)
   */
  app.get("/v1/billing/revenue/ledgers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...REVENUE_ROLES]);
    const query = listQuery.parse(req.query);

    const result = await repo.listLedgers(ctx.tenantId, query.page, query.pageSize);
    return reply.send(result);
  });

  /**
   * GET /v1/billing/revenue/ledgers/:id — Get ledger with accrual summary
   */
  app.get("/v1/billing/revenue/ledgers/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...REVENUE_ROLES]);
    const { id } = idParam.parse(req.params);

    const ledger = await repo.getLedgerById(ctx.tenantId, id);
    if (!ledger) throw new HttpError(404, "NOT_FOUND", "revenue ledger not found");

    const accruals = await repo.getAccrualsForLedger(ctx.tenantId, id);

    return reply.send({
      data: {
        ...ledger,
        accruals,
        accrualCount: accruals.length,
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError || (err && (err as { name?: string }).name === "ZodError")) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
